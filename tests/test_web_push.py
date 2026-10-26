import json
import tempfile
import time
import unittest
from pathlib import Path
from unittest.mock import patch

import http_ece
import jwt
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ec
from flask_migrate import upgrade
from pywebpush import WebPushException
import requests

from backend import create_app
from backend.models import db, User, WebPushSubscription
from backend.tokens import issue_token
from backend.web_push import b64encode, endpoint


class WebPushTests(unittest.TestCase):
    def setUp(self):
        self.folder = tempfile.TemporaryDirectory(); self.sent = []
        self.signer = ec.generate_private_key(ec.SECP256R1()); self.browser_key = ec.generate_private_key(ec.SECP256R1())
        self.private = b64encode(self.signer.private_numbers().private_value.to_bytes(32, 'big'))
        self.auth = b'0123456789abcdef'
        self.sub = {'endpoint': 'https://web.push.apple.com/Q-test-only', 'keys': {'p256dh': b64encode(self.browser_key.public_key().public_bytes(serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint)), 'auth': b64encode(self.auth)}, 'expirationTime': None}
        self.app = create_app(dict(TESTING=True, JWT_SECRET_KEY='web-push-test-secret-' * 4, BCRYPT_ROUNDS=4, AUTH_RATE_LIMIT=1000,
            WEB_PUSH_PRIVATE_KEY=self.private, WEB_PUSH_SUBJECT='mailto:test@example.test', WEB_PUSH_SENDER=lambda details, payload: self.sent.append((details, payload)),
            SQLALCHEMY_DATABASE_URI='sqlite:///' + str(Path(self.folder.name) / 'test.db')))
        self.context = self.app.app_context(); self.context.push(); upgrade(); self.client = self.app.test_client()
        self.users = [self.client.post('/auth/signup', json=dict(email=name+'@example.test', password='Test password 123', displayName=name, role=role)).get_json() for name, role in [('student','student'),('parent','parent')]]
    def tearDown(self):
        db.session.remove(); db.engine.dispose(); self.context.pop(); self.folder.cleanup()
    def call(self, method, path, body=None, user=0):
        return self.client.open(path, method=method, json=body, headers={'Authorization': 'Bearer ' + self.users[user]['token']} if user is not None else {})
    def register(self, user=0, sub=None): return self.call('POST', '/web-push/subscriptions', {'subscription': sub or self.sub}, user)
    def wait(self, job_id, user=0):
        for _ in range(200):
            result = self.call('GET', '/web-push/jobs/'+job_id, user=user).get_json()
            if result['status'] != 'sending': return result
            time.sleep(.005)
        self.fail('Background push job did not finish')

    def test_companion_static_surface_never_exposes_credentials_or_source(self):
        response = self.client.get('/companion/')
        self.assertEqual(response.status_code, 200); self.assertIn('worker-src', response.headers['Content-Security-Policy'])
        self.assertEqual(response.headers['Permissions-Policy'], 'camera=(), microphone=(), geolocation=()')
        self.assertEqual(response.headers['Cache-Control'], 'no-store')
        response.close()
        for path in ['/companion/shared/session.js','/companion/shared/api.js','/companion/sw.js','/companion/manifest.webmanifest']:
            with self.client.get(path) as asset: self.assertEqual(asset.status_code, 200)
        for path in ['/companion/.env','/companion/shared/secure-session.js','/companion/package.json','/backend/web_push.py']: self.assertEqual(self.client.get(path).status_code, 404)
        with self.client.get('/companion/sw.js') as asset: worker = asset.text
        self.assertNotIn('caches.', worker); self.assertNotIn("addEventListener('fetch'", worker)
        config = self.client.get('/web-push/config').get_json()
        self.assertTrue(config['configured']); self.assertNotIn(self.private, json.dumps(config)); self.assertEqual(len(config['publicKey']),87)

    def test_registration_is_owned_by_verified_jwt_and_never_reassigns_other_accounts(self):
        self.assertEqual(self.register(user=None).status_code,401)
        result = self.register(); self.assertEqual(result.status_code,200); sid = result.get_json()['subscriptionId']
        row = db.session.get(WebPushSubscription,sid); self.assertEqual(row.user_id,self.users[0]['user']['id'])
        self.assertEqual(self.register().get_json()['subscriptionId'],sid)
        self.assertEqual(self.register(user=1).status_code,409)
        self.assertEqual(self.call('POST','/web-push/subscriptions',{'subscription':self.sub,'userId':self.users[1]['user']['id']}).status_code,400)
        self.call('DELETE','/web-push/subscriptions',{'endpoint':self.sub['endpoint']},user=1)
        self.assertIsNotNone(db.session.get(WebPushSubscription,sid))
        self.assertEqual(self.call('POST','/web-push/test',{'subscriptionId':sid},user=1).status_code,404)
        self.call('DELETE','/web-push/subscriptions',{'endpoint':self.sub['endpoint']})
        self.assertIsNone(db.session.get(WebPushSubscription,sid))

    def test_untrusted_endpoints_keys_and_client_identity_are_rejected(self):
        for target in ['http://web.push.apple.com/path','https://127.0.0.1/path','https://web.push.apple.com.evil.test/path','https://evil.test/path','https://web.push.apple.com:8443/path','https://user:pass@web.push.apple.com/path','https://web.push.apple.com/path#fragment','https://web.push.apple.com\\@evil.test/path']:
            self.assertEqual(self.register(sub={**self.sub,'endpoint':target}).status_code,400,target)
        for keys in [{'p256dh':'bad','auth':self.sub['keys']['auth']},{'p256dh':self.sub['keys']['p256dh'],'auth':'bad'},{**self.sub['keys'],'userId':'claimed'},{'p256dh':b64encode(b'\x04'+b'\0'*64),'auth':self.sub['keys']['auth']}]:
            self.assertEqual(self.register(sub={**self.sub,'keys':keys}).status_code,400)
        self.assertEqual(db.session.scalar(db.select(db.func.count()).select_from(WebPushSubscription)),0)

    def test_manual_test_is_generic_rate_limited_and_jobs_are_private(self):
        sid=self.register().get_json()['subscriptionId']
        self.assertEqual(self.call('POST','/web-push/test',{'subscriptionId':sid,'message':'private'}).status_code,400)
        response=self.call('POST','/web-push/test',{'subscriptionId':sid});self.assertEqual(response.status_code,202)
        job_id=response.get_json()['jobId'];self.assertEqual(self.wait(job_id)['status'],'accepted')
        self.assertEqual(self.sent[0][1],{'kind':'test','testId':job_id})
        self.assertEqual(self.call('GET','/web-push/jobs/'+job_id,user=1).status_code,404)
        self.assertEqual(self.call('GET','/web-push/jobs/'+job_id,user=None).status_code,401)
        self.assertEqual(self.call('POST','/web-push/test',{'subscriptionId':sid}).status_code,400)
        self.assertEqual(len(self.sent),1)
        self.assertIn(self.client.post('/notify-parent').status_code,(404,405))

    def test_expired_subscription_cleanup_and_error_messages_do_not_leak_provider_secrets(self):
        sid=self.register().get_json()['subscriptionId']
        def expired(*_):
            response=requests.Response();response.status_code=410
            raise WebPushException('private-endpoint-and-key',response=response)
        self.app.extensions['web_push'].sender=expired
        job_id=self.call('POST','/web-push/test',{'subscriptionId':sid}).get_json()['jobId']
        job=self.wait(job_id);self.assertEqual(job['status'],'failed');self.assertNotIn('private',job['error'])
        db.session.expire_all();self.assertIsNone(db.session.get(WebPushSubscription,sid))

    def test_real_library_encrypts_payload_and_signs_vapid_without_following_redirects(self):
        response=requests.Response();response.status_code=201;response._content=b''
        service=self.app.extensions['web_push']; payload={'kind':'test','testId':'synthetic'}
        with patch('requests.Session.request',return_value=response) as send:
            service.deliver(self.sub,payload)
        self.assertFalse(send.call_args.kwargs['allow_redirects'])
        encrypted=send.call_args.kwargs['data'];self.assertNotIn(b'synthetic',encrypted)
        decoded=http_ece.decrypt(encrypted,private_key=self.browser_key,auth_secret=self.auth,version='aes128gcm')
        self.assertEqual(json.loads(decoded),payload)
        authorization=send.call_args.kwargs['headers']['Authorization']
        token=authorization.split('t=')[1].split(',')[0]
        claims=jwt.decode(token,self.signer.public_key(),algorithms=['ES256'],audience='https://web.push.apple.com')
        self.assertEqual(claims['sub'],'mailto:test@example.test')

    def test_unconfigured_fails_closed_and_monitor_tokens_cannot_register_push(self):
        user=db.session.get(User,self.users[0]['user']['id']);monitor=issue_token(user,purpose='monitor',device_id='test-device')['token']
        self.assertEqual(self.client.post('/web-push/subscriptions',json={'subscription':self.sub},headers={'Authorization':'Bearer '+monitor}).status_code,401)
        self.app.extensions['web_push'].key=None
        self.assertFalse(self.client.get('/web-push/config').get_json()['configured'])
        self.assertEqual(self.register().status_code,503)

    def test_device_limit_and_user_deletion_cascade(self):
        for index in range(5): self.assertEqual(self.register(sub={**self.sub,'endpoint':self.sub['endpoint']+str(index)}).status_code,200)
        self.assertEqual(self.register().status_code,409)
        user=db.session.get(User,self.users[0]['user']['id']);db.session.delete(user);db.session.commit()
        self.assertEqual(db.session.scalar(db.select(db.func.count()).select_from(WebPushSubscription)),0)
