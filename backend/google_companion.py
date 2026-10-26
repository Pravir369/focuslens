"""User-approved Expo Go browser sign-in, separate from the web cookie flow.

An opaque flow ID in the browser URL is not an authentication credential.
Only the phone's private 256-bit verifier can read/finish/cancel the flow.
The phone shows the verified account and requires confirmation before exchange.
No JWT, Google ID token, password or verifier is put in a URL or stored here.
"""
import base64
import hashlib
import re
import secrets
import threading
import time
from pathlib import Path

from flask import Blueprint, current_app, jsonify, request, send_from_directory
from google.auth.exceptions import GoogleAuthError, TransportError
from itsdangerous import BadSignature, URLSafeTimedSerializer

from .auth import json_fields
from .google_auth import GoogleAccountError, google_account, verified_google_claims
from .models import db, User
from .tokens import issue_token

api = Blueprint('google_companion', __name__, url_prefix='/auth/google/companion')
COOKIE = 'focuslens_companion_google_nonce'
ROOT = Path(__file__).resolve().parent.parent


class FlowError(Exception):
    def __init__(self, message='Google sign-in expired. Start again in the FocusLens app.', status=410):
        self.message = message; self.status = status


class BrowserFlows:
    def __init__(self): self.lock = threading.RLock(); self.rows = {}

    def prune(self):
        now = time.monotonic()
        self.rows = {key: value for key, value in self.rows.items() if value['expiresAt'] > now}

    def get(self, flow_id):
        self.prune()
        if not isinstance(flow_id, str) or not re.fullmatch(r'[A-Za-z0-9_-]{43}', flow_id): raise FlowError()
        row = self.rows.get(flow_id)
        if row is None: raise FlowError()
        return row

    def prove(self, data):
        row = self.get(data.get('flowId')); verifier = data.get('verifier')
        if not isinstance(verifier, str) or not re.fullmatch(r'[A-Za-z0-9._~-]{43,128}', verifier): raise FlowError('Google sign-in proof could not be verified. Restart in the app.', 401)
        challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).decode().rstrip('=')
        if not secrets.compare_digest(challenge, row['challenge']): raise FlowError('Google sign-in proof could not be verified. Restart in the app.', 401)
        return row


def flows(): return current_app.extensions['google_companion_flows']
def signer(): return URLSafeTimedSerializer(current_app.config['JWT_SECRET_KEY'], salt='focuslens-companion-google-v1')


@api.before_request
def guard():
    if not current_app.config['GOOGLE_CLIENT_ID']: return jsonify(error='Google sign-in is not configured on this service.'), 503
    if (request.content_length or 0) > 16384: return jsonify(error='Google sign-in request is too large.'), 413
    if not current_app.extensions['auth_limiter'].allowed(request.remote_addr):
        return jsonify(error='Too many attempts. Wait a minute and try again.'), 429, {'Retry-After':'60'}


@api.after_request
def private_headers(response):
    response.headers['Referrer-Policy'] = 'no-referrer'
    return response


@api.errorhandler(FlowError)
def expired(error): return jsonify(error=error.message), error.status


@api.errorhandler(ValueError)
def invalid(error):
    db.session.rollback(); return jsonify(error=str(error)), 400


@api.post('/start')
def start():
    data = json_fields({'challenge', 'role'}); challenge = data.get('challenge'); role = data.get('role')
    if not isinstance(challenge, str) or not re.fullmatch(r'[A-Za-z0-9_-]{43}', challenge): raise ValueError('Use a valid secure sign-in challenge.')
    if role not in ('student', 'parent'): raise ValueError('Choose student or parent.')
    with flows().lock:
        flows().prune()
        if len(flows().rows) >= 1000: raise FlowError('Sign-in is busy. Try again in a few minutes.', 503)
        flow_id = secrets.token_urlsafe(32); code = str(secrets.randbelow(1000000)).zfill(6)
        flows().rows[flow_id] = dict(flowId=flow_id, challenge=challenge, role=role, code=code,
            nonce=secrets.token_urlsafe(32), expiresAt=time.monotonic()+current_app.config['GOOGLE_NONCE_SECONDS'],
            status='pending', verifying=False, userId=None, subject=None)
    return jsonify(flowId=flow_id, verificationCode=code, expiresIn=current_app.config['GOOGLE_NONCE_SECONDS'])


@api.get('')
def page(): return send_from_directory(ROOT, 'google-companion.html')


@api.get('/config')
def config():
    with flows().lock:
        row = flows().get(request.args.get('flow'))
        if row['status'] != 'pending': raise FlowError('Google has already verified this sign-in. Return to the app to continue.')
        response = jsonify(clientId=current_app.config['GOOGLE_CLIENT_ID'], nonce=row['nonce'], role=row['role'], verificationCode=row['code'])
        response.set_cookie(COOKIE, signer().dumps({'flowId':row['flowId'], 'nonce':row['nonce']}),
            max_age=current_app.config['GOOGLE_NONCE_SECONDS'], secure=current_app.config['PRODUCTION'],
            httponly=True, samesite='Strict', path='/auth/google/companion')
        return response


@api.post('/verify')
def verify():
    data = json_fields({'flowId', 'idToken', 'password'}); token = data.get('idToken')
    if not isinstance(token, str) or not 1 <= len(token) <= 8192: raise ValueError('Choose your Google account again.')
    try: cookie = signer().loads(request.cookies.get(COOKIE, ''), max_age=current_app.config['GOOGLE_NONCE_SECONDS'])
    except BadSignature: raise FlowError() from None
    with flows().lock:
        row = flows().get(data.get('flowId'))
        if not isinstance(cookie, dict) or cookie.get('flowId') != row['flowId'] or cookie.get('nonce') != row['nonce']: raise FlowError()
        if row['status'] != 'pending' or row['verifying']: raise FlowError('This Google sign-in is already being processed. Return to the app or retry.', 409)
        row['verifying'] = True; nonce = row['nonce']; role = row['role']
    try:
        try: claims = verified_google_claims(token, nonce)
        except TransportError: return jsonify(error='Google could not be reached. Please retry.'), 503
        except (ValueError, GoogleAuthError): return jsonify(error='Google sign-in could not be verified. Retry from the app.', code='google_restart'), 401
        try: user, _ = google_account(claims, role, data)
        except GoogleAccountError as error:
            return jsonify(error=error.message, **({'code':error.code} if error.code else {})), error.status
        with flows().lock:
            if flows().get(row['flowId']) is not row: raise FlowError()
            row.update(status='ready', userId=user.id, subject=claims['sub'])
        response = jsonify(verified=True)
        response.delete_cookie(COOKIE, path='/auth/google/companion', secure=current_app.config['PRODUCTION'], httponly=True, samesite='Strict')
        return response
    finally:
        with flows().lock: row['verifying'] = False


@api.post('/check')
def check():
    data = json_fields({'flowId', 'verifier'})
    with flows().lock:
        row = flows().prove(data)
        if row['status'] != 'ready': return jsonify(status='pending')
        user = db.session.get(User, row['userId'])
        if not user or user.google_id != row['subject']: raise FlowError()
        return jsonify(status='ready', user=user.public())


@api.post('/finish')
def finish():
    data = json_fields({'flowId', 'verifier'})
    with flows().lock:
        row = flows().prove(data)
        if row['status'] != 'ready': raise FlowError('Finish Google sign-in in the browser first.', 409)
        # Consume atomically before issuing access; concurrent exchanges cannot
        # replay it. A lost response requires a fresh sign-in, never URL tokens.
        del flows().rows[row['flowId']]
        user_id = row['userId']; subject = row['subject']
    user = db.session.get(User, user_id)
    if not user or user.google_id != subject: raise FlowError()
    return jsonify(issue_token(user))


@api.post('/cancel')
def cancel():
    data = json_fields({'flowId', 'verifier'})
    with flows().lock:
        row = flows().prove(data); del flows().rows[row['flowId']]
    return jsonify(cancelled=True)
