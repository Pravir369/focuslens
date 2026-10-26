"""Native push checkpoint: opt-in registrations and manual self-tests only.

Tokens are device credentials: never log them or put them in URLs/responses.
Expo tickets and APNs/FCM receipts are not proof of delivery to a phone.
"""
import re
import threading
import time
import uuid

import requests
from flask import Blueprint, abort, current_app, g, jsonify
from sqlalchemy.exc import IntegrityError

from .auth import json_fields
from .models import db, ExpoPushToken
from .tokens import require_auth

api = Blueprint('expo_push', __name__)
EXPO_BASE = 'https://exp.host/--/api/v2/push/'


def push_token(value):
    if not isinstance(value, str) or not re.fullmatch(r'(?:Exponent|Expo)PushToken\[[A-Za-z0-9_-]{10,200}\]', value):
        raise ValueError('Invalid Expo notification token. Reconnect notifications on your phone.')
    return value


class ProviderError(Exception):
    def __init__(self, code='Unavailable'): self.code = code


class ExpoPushService:
    def __init__(self, app, sender=None, receipts=None):
        self.app = app; self.sender = sender or self.deliver; self.receipts = receipts or self.receipt
        self.lock = threading.RLock(); self.jobs = {}

    @staticmethod
    def post(action, body):
        # Only these fixed provider URLs are used. Never follow redirects or
        # return provider messages, which may echo credentials, to a client.
        response = requests.post(EXPO_BASE + action, json=body, timeout=15, allow_redirects=False)
        if response.status_code != 200: raise ProviderError()
        payload = response.json()
        if not isinstance(payload, dict) or payload.get('errors'): raise ProviderError()
        return payload.get('data')

    def deliver(self, token, job_id):
        data = self.post('send', {'to': token, 'title': 'FocusLens test',
            'body': 'This is a manual notification test. No study data is included.',
            'sound': 'default', 'channelId': 'focuslens', 'ttl': 60,
            'data': {'kind': 'test', 'testId': job_id}})
        if not isinstance(data, dict): raise ProviderError()
        if data.get('status') != 'ok':
            raise ProviderError((data.get('details') or {}).get('error', 'Unavailable'))
        ticket = data.get('id')
        if not isinstance(ticket, str) or not re.fullmatch(r'[A-Za-z0-9-]{10,100}', ticket): raise ProviderError()
        return ticket

    def receipt(self, ticket):
        data = self.post('getReceipts', {'ids': [ticket]})
        value = data.get(ticket) if isinstance(data, dict) else None
        if value is None: return None
        if not isinstance(value, dict): raise ProviderError()
        if value.get('status') != 'ok': raise ProviderError((value.get('details') or {}).get('error', 'Unavailable'))
        return True

    @staticmethod
    def public(job): return {key: job[key] for key in ('jobId', 'status', 'error')}

    def failed(self, job, error):
        if isinstance(error, ProviderError) and error.code == 'DeviceNotRegistered':
            with self.app.app_context():
                try:
                    row = db.session.get(ExpoPushToken, job['registrationId'])
                    if row and row.user_id == job['userId'] and row.token == job['token']:
                        db.session.delete(row); db.session.commit()
                except Exception: db.session.rollback()
        with self.lock:
            job.update(status='failed', error='Notification delivery could not be confirmed. Check phone permissions and reconnect notifications. A development build may be required for this runtime.')

    def check_receipt(self, job):
        try:
            result = self.receipts(job['ticket'])
            with self.lock: job['status'] = 'providerAccepted' if result else 'receiptPending'
        except Exception as error: self.failed(job, error)

    def queue_test(self, row):
        now = time.time(); job_id = str(uuid.uuid4())
        with self.lock:
            self.jobs = {key: value for key, value in self.jobs.items() if now - value['createdAt'] < 3600}
            if len(self.jobs) >= 100 or any(job['userId'] == row.user_id and now - job['createdAt'] < 60 for job in self.jobs.values()):
                raise ValueError('Wait a minute before sending another test notification.')
            job = dict(jobId=job_id, userId=row.user_id, registrationId=row.id, token=row.token,
                createdAt=now, status='sending', error='', ticket=None)
            self.jobs[job_id] = job
        def work():
            try:
                ticket = self.sender(job['token'], job_id)
                with self.lock: job.update(ticket=ticket, status='accepted')
                # Expo recommends checking receipts after 15 minutes. No retry
                # of the send itself: a timeout may already have delivered it.
                timer = threading.Timer(900, self.check_receipt, args=(job,)); timer.daemon = True; timer.start()
            except Exception as error: self.failed(job, error)
        threading.Thread(target=work, daemon=True, name='focuslens-expo-test').start()
        return self.public(job)


def service(): return current_app.extensions['expo_push']


@api.errorhandler(ValueError)
def invalid(error):
    db.session.rollback(); return jsonify(error=str(error)), 400


@api.post('/push-tokens')
@require_auth
def register():
    data = json_fields({'token', 'platform'}); token = push_token(data.get('token')); platform = data.get('platform')
    if platform not in ('ios', 'android'): raise ValueError('Choose an iOS or Android notification device.')
    row = db.session.execute(db.select(ExpoPushToken).where(ExpoPushToken.token == token)).scalar_one_or_none()
    if row and row.user_id != g.user_id: return jsonify(error='This phone is connected to another account. Disable notifications there before changing accounts.'), 409
    if row is None:
        count = db.session.scalar(db.select(db.func.count()).select_from(ExpoPushToken).where(ExpoPushToken.user_id == g.user_id))
        if count >= 5: return jsonify(error='Five phones are already connected. Disconnect an old phone first.'), 409
        row = ExpoPushToken(user_id=g.user_id, token=token, platform=platform); db.session.add(row)
    else: row.platform = platform
    try: db.session.commit()
    except IntegrityError:
        db.session.rollback(); return jsonify(error='Notification registration changed. Please retry.'), 409
    return jsonify(registrationId=row.id)


@api.delete('/push-tokens')
@require_auth
def unregister():
    data = json_fields({'token'}); token = push_token(data.get('token'))
    row = db.session.execute(db.select(ExpoPushToken).where(ExpoPushToken.token == token, ExpoPushToken.user_id == g.user_id)).scalar_one_or_none()
    if row: db.session.delete(row); db.session.commit()
    return jsonify(removed=True)


@api.post('/push-tokens/test')
@require_auth
def test_push():
    data = json_fields({'registrationId'}); candidate = data.get('registrationId')
    row = db.session.get(ExpoPushToken, candidate) if isinstance(candidate, str) and re.fullmatch(r'[a-f0-9-]{36}', candidate) else None
    if row is None or row.user_id != g.user_id: abort(404)
    return jsonify(service().queue_test(row)), 202


@api.get('/push-tokens/jobs/<job_id>')
@require_auth
def job_status(job_id):
    with service().lock:
        job = service().jobs.get(job_id)
        if not job or job['userId'] != g.user_id or time.time() - job['createdAt'] >= 3600: abort(404)
        return jsonify(service().public(job))
