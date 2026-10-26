import base64
from concurrent.futures import ThreadPoolExecutor
import hashlib
import json
import re
import tempfile
import time
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

import jwt
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from flask_migrate import upgrade

from backend import create_app
from backend.models import db, User

PREFIX = '/auth/google/companion'


class GoogleCompanionTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.private = rsa.generate_private_key(public_exponent=65537, key_size=2048)
        cls.public = cls.private.public_key().public_bytes(serialization.Encoding.PEM,serialization.PublicFormat.SubjectPublicKeyInfo).decode()

    def setUp(self):
        self.folder=tempfile.TemporaryDirectory()
        self.app=create_app(dict(TESTING=True,JWT_SECRET_KEY='browser-google-test-'*4,BCRYPT_ROUNDS=4,AUTH_RATE_LIMIT=1000,
            GOOGLE_CLIENT_ID='test-client.apps.googleusercontent.com',SQLALCHEMY_DATABASE_URI='sqlite:///'+str(Path(self.folder.name)/'test.db')))
        self.context=self.app.app_context();self.context.push();upgrade()
        self.phone=self.app.test_client();self.browser=self.app.test_client()
        certificate=SimpleNamespace(status_code=200,headers={},content=json.dumps({'test-key':self.public}).encode())
        self.network=patch('requests.Session.request',return_value=certificate);self.fetch=self.network.start()
        self.verifier='private-synthetic-verifier-'+'a'*40
        self.challenge=base64.urlsafe_b64encode(hashlib.sha256(self.verifier.encode()).digest()).decode().rstrip('=')
        self.flow=self.phone.post(PREFIX+'/start',json={'challenge':self.challenge,'role':'student'}).get_json()
        self.proof={'flowId':self.flow['flowId'],'verifier':self.verifier}
        self.config=self.browser.get(PREFIX+'/config',query_string={'flow':self.flow['flowId']}).get_json()

    def tearDown(self):
        self.network.stop();db.session.remove();db.engine.dispose();self.context.pop();self.folder.cleanup()

    def token(self, **changes):
        now=int(time.time())
        return jwt.encode(dict(sub='mobile-google-sub',email='mobile@example.test',email_verified=True,name='Mobile Student',
            aud=self.app.config['GOOGLE_CLIENT_ID'],iss='https://accounts.google.com',iat=now,exp=now+300,nonce=self.config['nonce'],**changes),
            self.private,algorithm='RS256',headers={'kid':'test-key'})

    def verify(self, token=None, **extra):
        return self.browser.post(PREFIX+'/verify',json={'flowId':self.flow['flowId'],'idToken':token or self.token(),**extra})

    def test_full_real_signature_flow_requires_phone_proof_and_explicit_one_use_exchange(self):
        self.assertEqual(set(self.flow),{'flowId','verificationCode','expiresIn'})
        self.assertNotIn('Set-Cookie',self.phone.post(PREFIX+'/start',json={'challenge':self.challenge,'role':'student'}).headers)
        response=self.verify();self.assertEqual(response.status_code,200);self.assertEqual(response.get_json(),{'verified':True})
        self.assertNotIn('token',str(response.get_json()))
        ready=self.phone.post(PREFIX+'/check',json=self.proof).get_json()
        self.assertEqual(ready['status'],'ready');self.assertEqual(ready['user']['email'],'mobile@example.test')
        result=self.phone.post(PREFIX+'/finish',json=self.proof);self.assertEqual(result.status_code,200)
        value=result.get_json();self.assertEqual(value['user']['id'],ready['user']['id'])
        self.assertEqual(self.phone.get('/auth/me',headers={'Authorization':'Bearer '+value['token']}).get_json()['id'],ready['user']['id'])
        self.assertEqual(self.phone.post(PREFIX+'/finish',json=self.proof).status_code,410)
        self.assertEqual(self.phone.post(PREFIX+'/check',json=self.proof).status_code,410)

    def test_flow_id_alone_cannot_read_identity_finish_or_cancel_and_client_identity_rejected(self):
        self.assertEqual(self.phone.post(PREFIX+'/finish',json=self.proof).status_code,409)
        self.verify()
        for action in ('check','finish','cancel'):
            for proof in [{'flowId':self.flow['flowId']},{**self.proof,'verifier':'b'*64},{**self.proof,'userId':'claimed'},{**self.proof,'email':'claimed@example.test'}]:
                response=self.phone.post(PREFIX+'/'+action,json=proof)
                self.assertIn(response.status_code,(400,401));self.assertNotIn('mobile@example.test',response.text)
        self.assertEqual(self.phone.post(PREFIX+'/check',json=self.proof).get_json()['status'],'ready')
        for extra in [{'userId':'claimed'},{'role':'parent'},{'nonce':self.config['nonce']}]: self.assertEqual(self.verify(**extra).status_code,400)

    def test_cookie_signature_browser_binding_and_google_claim_checks_fail_closed(self):
        self.fetch.reset_mock()
        data={'flowId':self.flow['flowId'],'idToken':self.token()}
        self.assertEqual(self.phone.post(PREFIX+'/verify',json=data).status_code,410)
        self.fetch.assert_not_called()
        original=self.browser.get('/auth/google/config');web_cookie=self.browser.get_cookie('focuslens_google_nonce',path='/auth/google').value
        self.browser.set_cookie('focuslens_companion_google_nonce',web_cookie,path=PREFIX)
        self.assertEqual(self.verify().status_code,410);self.fetch.assert_not_called()
        self.browser.get(PREFIX+'/config',query_string={'flow':self.flow['flowId']})
        cases=[{'aud':'other-client'},{'iss':'https://evil.test'},{'nonce':'wrong'},{'email_verified':False},{'email_verified':'true'},
            {'sub':''},{'email':'bad'},{'exp':int(time.time())-300,'iat':int(time.time())-600}]
        for changes in cases:
            now=int(time.time());claims=dict(sub='mobile-google-sub',email='mobile@example.test',email_verified=True,name='Student',aud=self.app.config['GOOGLE_CLIENT_ID'],iss='https://accounts.google.com',iat=now,exp=now+300,nonce=self.config['nonce']);claims.update(changes)
            token=jwt.encode(claims,self.private,algorithm='RS256',headers={'kid':'test-key'})
            self.assertEqual(self.verify(token).status_code,401)
        self.assertEqual(self.verify(self.token()+'tampered').status_code,401)
        self.assertEqual(db.session.query(User).count(),0)

    def test_linking_keeps_existing_password_proof_and_stored_role(self):
        signup=self.phone.post('/auth/signup',json=dict(email='mobile@example.test',password='Test password 123',displayName='Existing',role='parent')).get_json()
        response=self.verify();self.assertEqual(response.status_code,409);self.assertEqual(response.get_json()['code'],'password_required')
        for password in ['wrong password','short','🙂'*19]: self.assertEqual(self.verify(password=password).status_code,401)
        self.assertIsNone(db.session.get(User,signup['user']['id']).google_id)
        self.assertEqual(self.verify(password='Test password 123').status_code,200)
        ready=self.phone.post(PREFIX+'/check',json=self.proof).get_json()['user']
        self.assertEqual(ready['id'],signup['user']['id']);self.assertEqual(ready['role'],'parent')
        self.assertNotIn('Test password',str(self.app.extensions['google_companion_flows'].rows))

    def test_original_web_cookie_and_bridge_work_in_both_orders_without_mixing_challenges(self):
        web=self.browser.get('/auth/google/config').get_json()
        self.assertEqual(self.verify().status_code,200)
        self.assertIsNotNone(self.browser.get_cookie('focuslens_google_nonce',path='/auth/google'))
        now=int(time.time())
        token=jwt.encode(dict(sub='web-google-sub',email='web@example.test',email_verified=True,name='Web',aud=self.app.config['GOOGLE_CLIENT_ID'],iss='https://accounts.google.com',iat=now,exp=now+300,nonce=web['nonce']),self.private,algorithm='RS256',headers={'kid':'test-key'})
        response=self.browser.post('/auth/google',json={'idToken':token,'role':'parent'})
        self.assertEqual(response.status_code,201);self.assertEqual(response.get_json()['user']['role'],'parent')
        self.assertEqual(self.phone.post(PREFIX+'/finish',json=self.proof).status_code,200)
        self.assertEqual(self.browser.post('/auth/google',json={'idToken':token}).status_code,401)

    def test_cancel_expiry_capacity_headers_and_transport_fail_closed(self):
        self.assertEqual(self.phone.post(PREFIX+'/cancel',json=self.proof).status_code,200)
        self.assertEqual(self.verify().status_code,410)
        store=self.app.extensions['google_companion_flows'];store.rows['expired']={'expiresAt':time.monotonic()-1}
        self.assertEqual(self.phone.get(PREFIX+'/config',query_string={'flow':'expired'}).status_code,410)
        self.assertNotIn('expired',store.rows)
        store.rows={str(index):{'expiresAt':time.monotonic()+600} for index in range(1000)}
        self.assertEqual(self.phone.post(PREFIX+'/start',json={'challenge':self.challenge,'role':'student'}).status_code,503)
        with self.phone.get(PREFIX) as page:
            self.assertEqual(page.status_code,200);self.assertEqual(page.headers['Referrer-Policy'],'strict-origin-when-cross-origin')
            self.assertEqual(page.headers['Cache-Control'],'no-store');self.assertIn("frame-ancestors 'none'",page.headers['Content-Security-Policy'])
            self.assertEqual(page.headers['Permissions-Policy'],'camera=(), microphone=(), geolocation=()')
        self.assertEqual(self.phone.post(PREFIX+'/start',json={'challenge':self.challenge,'role':'student'},headers={'Origin':'https://evil.test'}).status_code,403)
        self.assertEqual(self.phone.post(PREFIX+'/start',data='x'*16385,content_type='application/json').status_code,413)

    def test_concurrent_exchange_is_atomic_and_deleted_accounts_cannot_sign_in(self):
        self.verify()
        def exchange(_): return self.app.test_client().post(PREFIX+'/finish',json=self.proof).status_code
        with ThreadPoolExecutor(max_workers=2) as pool: statuses=list(pool.map(exchange,range(2)))
        self.assertEqual(sorted(statuses),[200,410])

    def test_google_styles_use_fresh_response_nonce_without_relaxing_inline_policy(self):
        nonces=[]
        for path in ['/', '/account.html', PREFIX]:
            response=self.browser.get(path)
            self.assertEqual(response.status_code,200)
            nonce=re.search(r'name="focuslens-google-style-nonce" content="([A-Za-z0-9_-]+)"',response.text).group(1)
            nonces.append(nonce);self.assertGreaterEqual(len(nonce),32)
            csp=response.headers['Content-Security-Policy']
            self.assertIn("'nonce-"+nonce+"'",csp);self.assertNotIn('unsafe-inline',csp)
            self.assertNotIn('nonce-',csp.split('script-src ')[1].split(';')[0])
        self.assertEqual(len(set(nonces)),3)


if __name__ == '__main__': unittest.main()
