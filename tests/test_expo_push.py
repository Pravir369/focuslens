import tempfile
import time
import unittest
from pathlib import Path
from unittest.mock import patch

import requests
from flask_migrate import upgrade

from backend import create_app
from backend.expo_push import ProviderError, EXPO_BASE
from backend.models import db, ExpoPushToken, User
from backend.tokens import issue_token


class ExpoPushTests(unittest.TestCase):
    def setUp(self):
        self.folder = tempfile.TemporaryDirectory(); self.sent = []
        self.token = 'ExponentPushToken[synthetic-device-token]'
        self.app = create_app(dict(TESTING=True, JWT_SECRET_KEY='expo-test-key-' * 4, BCRYPT_ROUNDS=4, AUTH_RATE_LIMIT=1000,
            SQLALCHEMY_DATABASE_URI='sqlite:///' + str(Path(self.folder.name) / 'test.db'),
            EXPO_PUSH_SENDER=lambda token, job: self.sent.append((token, job)) or 'synthetic-ticket-1234', EXPO_PUSH_RECEIPTS=lambda _: True))
        self.context = self.app.app_context(); self.context.push(); upgrade(); self.client = self.app.test_client()
        self.users = [self.client.post('/auth/signup', json=dict(email=name+'@example.test', password='Test password 123', displayName=name, role=role)).get_json() for name, role in [('student','student'), ('parent','parent')]]

    def tearDown(self):
        db.session.remove(); db.engine.dispose(); self.context.pop(); self.folder.cleanup()

    def call(self, method, path, body=None, user=0):
        return self.client.open(path, method=method, json=body, headers={'Authorization': 'Bearer '+self.users[user]['token']} if user is not None else {})

    def register(self, user=0, **extra):
        return self.call('POST', '/push-tokens', {'token': self.token, 'platform': 'ios', **extra}, user)

    def wait(self, job_id):
        for _ in range(200):
            value = self.call('GET', '/push-tokens/jobs/'+job_id).get_json()
            if value['status'] != 'sending': return value
            time.sleep(.005)
        self.fail('Background job did not finish')

    def test_registration_identity_limits_and_logout_cleanup(self):
        self.assertEqual(self.register(user=None).status_code, 401)
        self.assertEqual(self.register(userId=self.users[1]['user']['id']).status_code, 400)
        result = self.register(); self.assertEqual(result.status_code, 200); rid = result.get_json()['registrationId']
        row = db.session.get(ExpoPushToken, rid); self.assertEqual(row.user_id, self.users[0]['user']['id'])
        self.assertEqual(self.register().get_json()['registrationId'], rid)
        self.assertEqual(self.register(user=1).status_code, 409)
        self.call('DELETE', '/push-tokens', {'token': self.token}, user=1)
        self.assertIsNotNone(db.session.get(ExpoPushToken, rid))
        self.assertEqual(self.call('POST', '/push-tokens/test', {'registrationId': rid}, user=1).status_code, 404)
        self.call('DELETE', '/push-tokens', {'token': self.token})
        self.assertIsNone(db.session.get(ExpoPushToken, rid))
        user = db.session.get(User, self.users[0]['user']['id'])
        token = issue_token(user, purpose='monitor', device_id='synthetic-device')['token']
        self.assertEqual(self.client.post('/push-tokens', json={'token': self.token, 'platform': 'ios'}, headers={'Authorization': 'Bearer '+token}).status_code, 401)

    def test_validation_device_limit_cascade_and_no_real_alert_route(self):
        for token in [None, 'https://evil.test', 'ExpoPushToken[]', 'ExpoPushToken[bad spaces]', 'ExpoPushToken['+'a'*201+']']:
            self.assertEqual(self.register(token=token).status_code, 400)
        for platform in [None, 'web', 'macos', 2]: self.assertEqual(self.register(platform=platform).status_code, 400)
        for index in range(5): self.assertEqual(self.register(token=f'ExpoPushToken[synthetic-device-{index}]').status_code, 200)
        self.assertEqual(self.register().status_code, 409)
        user = db.session.get(User, self.users[0]['user']['id']); db.session.delete(user); db.session.commit()
        self.assertEqual(db.session.scalar(db.select(db.func.count()).select_from(ExpoPushToken)), 0)
        self.assertIn(self.client.post('/notify-parent').status_code, (404,405))

    def test_jobs_are_owned_rate_limited_and_distinguish_tickets_from_receipts(self):
        rid = self.register().get_json()['registrationId']
        self.assertEqual(self.call('POST', '/push-tokens/test', {'registrationId': rid, 'message':'private'}).status_code, 400)
        result = self.call('POST', '/push-tokens/test', {'registrationId': rid}); self.assertEqual(result.status_code, 202)
        job_id = result.get_json()['jobId']; job = self.wait(job_id)
        self.assertEqual(job['status'], 'accepted'); self.assertNotIn(self.token, str(job))
        self.assertEqual(len(self.sent), 1)
        self.assertEqual(self.call('GET', '/push-tokens/jobs/'+job_id, user=1).status_code,404)
        self.assertEqual(self.call('GET', '/push-tokens/jobs/'+job_id, user=None).status_code,401)
        self.assertEqual(self.call('POST', '/push-tokens/test', {'registrationId': rid}).status_code,400)
        service = self.app.extensions['expo_push']; service.check_receipt(service.jobs[job_id])
        self.assertEqual(self.call('GET', '/push-tokens/jobs/'+job_id).get_json()['status'], 'providerAccepted')

    def test_provider_requests_use_fixed_https_no_redirects_and_generic_payload(self):
        service = self.app.extensions['expo_push']
        response = requests.Response(); response.status_code = 200
        response._content = b'{"data":{"status":"ok","id":"synthetic-ticket-1234"}}'
        with patch('backend.expo_push.requests.post', return_value=response) as send:
            self.assertEqual(service.deliver(self.token, 'test-job'), 'synthetic-ticket-1234')
        self.assertEqual(send.call_args.args, (EXPO_BASE+'send',))
        self.assertFalse(send.call_args.kwargs['allow_redirects'])
        body = send.call_args.kwargs['json']; self.assertEqual(body['data'], {'kind':'test','testId':'test-job'})
        self.assertEqual(body['ttl'],60); self.assertNotIn('student',str(body)); self.assertNotIn('session',str(body))
        response.status_code = 302
        with patch('backend.expo_push.requests.post', return_value=response):
            with self.assertRaises(ProviderError): service.deliver(self.token, 'test-job')

    def test_expired_tokens_are_removed_and_provider_errors_never_echo_secrets(self):
        rid = self.register().get_json()['registrationId']
        service = self.app.extensions['expo_push']
        def expired(*_): raise ProviderError('DeviceNotRegistered')
        service.sender = expired
        job_id = self.call('POST', '/push-tokens/test', {'registrationId':rid}).get_json()['jobId']
        job = self.wait(job_id); self.assertEqual(job['status'],'failed'); self.assertNotIn(self.token, str(job))
        db.session.expire_all(); self.assertIsNone(db.session.get(ExpoPushToken,rid))
        service.receipts = lambda _: None
        fake = dict(status='accepted', ticket='test', userId='test', registrationId='test', token=self.token)
        service.check_receipt(fake); self.assertEqual(fake['status'],'receiptPending')


if __name__ == '__main__': unittest.main()
