"""Encrypted, opt-in Web Push. This checkpoint sends only manual self-tests."""
import base64
import hashlib
import json
import re
import threading
import time
import uuid
from urllib.parse import urlsplit

import requests
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ec
from flask import Blueprint, abort, current_app, g, jsonify
from py_vapid import Vapid
from pywebpush import WebPushException, webpush
from sqlalchemy.exc import IntegrityError

from .auth import json_fields
from .models import db, WebPushSubscription
from .tokens import require_auth

api = Blueprint('web_push', __name__, url_prefix='/web-push')


def b64encode(value): return base64.urlsafe_b64encode(value).decode().rstrip('=')


def b64decode(value, size):
    if not isinstance(value, str) or not re.fullmatch(r'[A-Za-z0-9_-]+={0,2}', value) or len(value) > 128:
        raise ValueError('Invalid notification encryption key.')
    try: decoded = base64.urlsafe_b64decode(value + '=' * (-len(value) % 4))
    except (ValueError, TypeError): raise ValueError('Invalid notification encryption key.') from None
    if len(decoded) != size or b64encode(decoded) != value.rstrip('='): raise ValueError('Invalid notification encryption key.')
    return decoded


def endpoint(value):
    # These domains are controlled by browser push vendors. Never accept an
    # arbitrary URL for the delivery worker, redirects, credentials or IP hosts.
    if not isinstance(value, str) or not 1 <= len(value) <= 4096 or not value.isascii() or any(ord(c) <= 32 or ord(c) == 127 for c in value) or '\\' in value:
        raise ValueError('Invalid browser notification endpoint.')
    try:
        parsed = urlsplit(value); host = parsed.hostname or ''; port = parsed.port
        permitted = host == 'fcm.googleapis.com' or host.endswith('.push.apple.com') or host == 'updates.push.services.mozilla.com'
        if parsed.scheme != 'https' or not permitted or port not in (None, 443) or parsed.username or parsed.password or parsed.fragment or not parsed.path.startswith('/') or parsed.path == '/': raise ValueError()
    except ValueError: raise ValueError('Use a supported browser notification endpoint over HTTPS.') from None
    return parsed._replace(netloc=host).geturl()


def subscription(data):
    if not isinstance(data, dict) or set(data) - {'endpoint', 'keys', 'expirationTime'}: raise ValueError('Invalid browser notification subscription.')
    target = endpoint(data.get('endpoint')); keys = data.get('keys')
    if not isinstance(keys, dict) or set(keys) != {'p256dh', 'auth'}: raise ValueError('Invalid notification encryption keys.')
    public = b64decode(keys['p256dh'], 65); b64decode(keys['auth'], 16)
    try: ec.EllipticCurvePublicKey.from_encoded_point(ec.SECP256R1(), public)
    except ValueError: raise ValueError('Invalid notification public key.') from None
    return dict(endpoint=target, endpoint_hash=hashlib.sha256(target.encode()).hexdigest(), p256dh=keys['p256dh'], auth=keys['auth'])


class NoRedirectSession(requests.Session):
    def request(self, method, url, **kwargs):
        endpoint(url); kwargs['allow_redirects'] = False
        return super().request(method, url, **kwargs)


class PushService:
    def __init__(self, app, private_key, subject, sender=None):
        self.app = app; self.subject = subject; self.sender = sender or self.deliver
        self.lock = threading.RLock(); self.jobs = {}; self.key = None; self.public_key = ''
        try:
            if private_key:
                self.key = Vapid.from_string(private_key)
                self.public_key = b64encode(self.key.public_key.public_bytes(serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint))
        except Exception:
            # Configuration errors must not include a key or its parser error.
            self.key = None; self.public_key = ''
    @property
    def configured(self):
        return bool(self.key and (re.fullmatch(r'mailto:[^\s@]+@[^\s@]+\.[^\s@]+', self.subject) or self.subject.startswith('https://')))

    def deliver(self, details, payload):
        with NoRedirectSession() as connection:
            return webpush(subscription_info=details, data=json.dumps(payload), vapid_private_key=self.key,
                vapid_claims={'sub': self.subject}, requests_session=connection, timeout=15, ttl=60, verbose=False)

    @staticmethod
    def public(job): return {key: job[key] for key in ('jobId', 'status', 'error')}

    def queue_test(self, row):
        now = time.time(); job_id = str(uuid.uuid4()); owner = row.user_id
        with self.lock:
            self.jobs = {key: value for key, value in self.jobs.items() if now - value['createdAt'] < 3600}
            if len(self.jobs) >= 100 or any(value['userId'] == owner and now - value['createdAt'] < 60 for value in self.jobs.values()): raise ValueError('Wait a minute before sending another test notification.')
            job = dict(jobId=job_id, userId=owner, createdAt=now, status='sending', error=''); self.jobs[job_id] = job
        row_id = row.id; fingerprint = row.endpoint_hash
        details = {'endpoint': row.endpoint, 'keys': {'p256dh': row.p256dh, 'auth': row.auth}}
        payload = {'kind': 'test', 'testId': job_id}
        def work():
            try:
                self.sender(details, payload)
                result = dict(status='accepted', error='')
            except Exception as error:
                status = getattr(getattr(error, 'response', None), 'status_code', None)
                if isinstance(error, WebPushException) and status in (404, 410):
                    with self.app.app_context():
                        try:
                            current = db.session.get(WebPushSubscription, row_id)
                            if current and current.user_id == owner and current.endpoint_hash == fingerprint:
                                db.session.delete(current); db.session.commit()
                        except Exception: db.session.rollback()
                result = dict(status='failed', error='The push provider did not confirm acceptance. Check notification permissions and reconnect this device.')
            with self.lock: job.update(result)
        threading.Thread(target=work, daemon=True, name='focuslens-web-push-test').start()
        return self.public(job)


def service(): return current_app.extensions['web_push']


@api.errorhandler(ValueError)
def invalid(error):
    db.session.rollback(); return jsonify(error=str(error)), 400


@api.get('/config')
def config(): return jsonify(configured=service().configured, publicKey=service().public_key if service().configured else '')


@api.post('/subscriptions')
@require_auth
def register():
    if not service().configured: return jsonify(error='Web Push has not been configured on this server yet.'), 503
    data = json_fields({'subscription'}); clean = subscription(data.get('subscription'))
    row = db.session.execute(db.select(WebPushSubscription).where(WebPushSubscription.endpoint_hash == clean['endpoint_hash'])).scalar_one_or_none()
    if row and row.user_id != g.user_id: return jsonify(error='This browser is connected to another account. Disable notifications there first.'), 409
    if row is None:
        count = db.session.scalar(db.select(db.func.count()).select_from(WebPushSubscription).where(WebPushSubscription.user_id == g.user_id))
        if count >= 5: return jsonify(error='Five devices are already connected. Disconnect an old device first.'), 409
        row = WebPushSubscription(user_id=g.user_id, **clean); db.session.add(row)
    else:
        row.p256dh = clean['p256dh']; row.auth = clean['auth']
    try: db.session.commit()
    except IntegrityError:
        db.session.rollback(); return jsonify(error='Notification registration changed. Please retry.'), 409
    return jsonify(subscriptionId=row.id), 200


@api.delete('/subscriptions')
@require_auth
def unregister():
    data = json_fields({'endpoint'}); target = endpoint(data.get('endpoint'))
    row = db.session.execute(db.select(WebPushSubscription).where(WebPushSubscription.endpoint_hash == hashlib.sha256(target.encode()).hexdigest(), WebPushSubscription.user_id == g.user_id)).scalar_one_or_none()
    if row: db.session.delete(row); db.session.commit()
    return jsonify(removed=True)


@api.post('/test')
@require_auth
def test_push():
    if not service().configured: return jsonify(error='Web Push has not been configured yet.'), 503
    data = json_fields({'subscriptionId'})
    candidate = data.get('subscriptionId')
    row = db.session.get(WebPushSubscription, candidate) if isinstance(candidate, str) and re.fullmatch(r'[a-f0-9-]{36}', candidate) else None
    if row is None or row.user_id != g.user_id: abort(404)
    return jsonify(service().queue_test(row)), 202


@api.get('/jobs/<job_id>')
@require_auth
def job_status(job_id):
    with service().lock:
        row = service().jobs.get(job_id)
        if not row or row['userId'] != g.user_id or time.time() - row['createdAt'] >= 3600: abort(404)
        return jsonify(service().public(row))
