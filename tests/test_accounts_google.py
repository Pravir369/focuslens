import json
import tempfile
import time
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

import jwt
import requests
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from flask_migrate import upgrade
from itsdangerous import SignatureExpired

from backend import create_app
from backend.models import db, User


class GoogleTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.private_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
        cls.public_key = cls.private_key.public_key().public_bytes(serialization.Encoding.PEM, serialization.PublicFormat.SubjectPublicKeyInfo).decode()

    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.app = create_app({"TESTING": True, "JWT_SECRET_KEY": "test-only-key-" * 5, "BCRYPT_ROUNDS": 4,
            "GOOGLE_CLIENT_ID": "test-client.apps.googleusercontent.com", "AUTH_RATE_LIMIT": 1000,
            "SQLALCHEMY_DATABASE_URI": "sqlite:///" + str(Path(self.directory.name) / "test.sqlite3")})
        self.context = self.app.app_context(); self.context.push(); upgrade()
        self.client = self.app.test_client()
        self.cert_response = SimpleNamespace(status_code=200, headers={}, content=json.dumps({"test-key": self.public_key}).encode())
        # Exercise google-auth's real RSA signature/audience/issuer/time verifier;
        # replace only the network fetch of Google's public signing certificates.
        self.network = patch("requests.Session.request", return_value=self.cert_response)
        self.fetch = self.network.start()
        self.nonce = self.client.get("/auth/google/config").get_json()["nonce"]

    def tearDown(self):
        self.network.stop(); db.session.remove(); db.engine.dispose(); self.context.pop(); self.directory.cleanup()

    def token(self, **changes):
        now = int(time.time())
        return jwt.encode({"sub": "test-google-sub", "email": "student@example.test", "email_verified": True,
            "name": "Google Student", "aud": self.app.config["GOOGLE_CLIENT_ID"], "iss": "https://accounts.google.com",
            "iat": now, "exp": now + 300, "nonce": self.nonce, **changes}, self.private_key, algorithm="RS256", headers={"kid": "test-key"})

    def post(self, token=None, **fields):
        return self.client.post("/auth/google", json={"idToken": token or self.token(), **fields})

    def test_real_signature_verification_creates_account_and_shared_jwt_identity(self):
        response = self.post(role="parent"); self.assertEqual(response.status_code, 201)
        result = response.get_json(); user = db.session.get(User, result["user"]["id"])
        self.assertIsNone(user.password_hash); self.assertEqual(user.google_id, "test-google-sub")
        self.assertEqual(user.role, "parent")
        self.assertEqual(self.client.get("/auth/me", headers={"Authorization": "Bearer " + result["token"]}).get_json()["id"], user.id)
        self.assertEqual(self.fetch.call_args.kwargs["timeout"], 10)
        # Clearing the browser challenge means a callback cannot be reused.
        self.assertEqual(self.post().status_code, 401)
        self.nonce = self.client.get("/auth/google/config").get_json()["nonce"]
        again = self.post(role="student", token=self.token(email="changed@example.test", name="Changed"))
        self.assertEqual(again.status_code, 200); self.assertEqual(again.get_json()["user"]["id"], user.id)
        self.assertEqual(again.get_json()["user"]["role"], "parent")
        self.assertEqual(user.email, "student@example.test")

    def test_forged_expired_wrong_audience_issuer_nonce_and_unverified_email_fail_closed(self):
        cases = [self.token(aud="other-app"), self.token(iss="https://attacker.invalid"), self.token(exp=int(time.time())-1, iat=int(time.time())-300),
            self.token(nonce="other-browser"), self.token(nonce="🙂"), self.token(email_verified=False), self.token(email_verified="true"),
            self.token(sub=""), self.token(email="bad"), self.token()+"tampered", "not-a-token"]
        for token in cases:
            self.assertEqual(self.post(token).status_code, 401)
        self.assertEqual(db.session.query(User).count(), 0)

    def test_linking_requires_existing_password_and_preserves_stored_role(self):
        signup = self.client.post("/auth/signup", json={"email": "student@example.test", "password": "Test password 123", "displayName": "Existing", "role": "parent"}).get_json()
        user = db.session.get(User, signup["user"]["id"])
        response = self.post(); self.assertEqual(response.status_code, 409)
        self.assertEqual(response.get_json()["code"], "password_required"); self.assertIsNone(user.google_id)
        for password in ["wrong password", "short", "x"*73]:
            self.assertEqual(self.post(password=password).status_code, 401); self.assertIsNone(user.google_id)
        response = self.post(password="Test password 123", role="student")
        self.assertEqual(response.status_code, 200); self.assertEqual(response.get_json()["user"]["id"], user.id)
        self.assertEqual(user.role, "parent"); self.assertEqual(user.google_id, "test-google-sub")
        self.assertEqual(db.session.query(User).count(), 1)
        self.assertEqual(self.client.post("/auth/login", json={"email": user.email, "password": "Test password 123"}).status_code, 200)

    def test_other_google_subject_cannot_take_over_matching_email(self):
        db.session.add(User(email="student@example.test", google_id="already-linked-sub", display_name="Existing", role="student")); db.session.commit()
        self.assertEqual(self.post().status_code, 409)
        self.assertEqual(db.session.query(User).one().google_id, "already-linked-sub")

    def test_missing_tampered_or_expired_browser_challenge_rejected_before_google_fetch(self):
        self.fetch.reset_mock()
        stranger = self.app.test_client()
        self.assertEqual(stranger.post("/auth/google", json={"idToken": self.token()}).status_code, 401)
        self.client.set_cookie("focuslens_google_nonce", "tampered", path="/auth/google")
        self.assertEqual(self.post().status_code, 401)
        self.client.get("/auth/google/config")
        with patch("itsdangerous.URLSafeTimedSerializer.loads", side_effect=SignatureExpired("expired")):
            self.assertEqual(self.post().status_code, 401)
        self.fetch.assert_not_called()

    def test_config_cookies_network_failure_input_and_rate_limits(self):
        response = self.client.get("/auth/google/config")
        self.assertEqual(set(response.get_json()), {"clientId", "nonce"})
        self.assertIn("HttpOnly", response.headers["Set-Cookie"]); self.assertIn("SameSite=Strict", response.headers["Set-Cookie"])
        self.assertEqual(response.headers["Cache-Control"], "no-store")
        self.assertIn("https://accounts.google.com/gsi/client", response.headers["Content-Security-Policy"])
        self.assertNotIn("unsafe-inline", response.headers["Content-Security-Policy"])
        self.assertEqual(response.headers["Cross-Origin-Opener-Policy"], "same-origin-allow-popups")
        for fields in [{"userId":"spoof"}, {"profileId":"spoof"}, {"email":"claimed@example.test"}, {"role":"admin"}]:
            self.assertEqual(self.post(**fields).status_code, 400)
        self.assertEqual(self.client.post("/auth/google", json={}).status_code, 400)
        self.assertEqual(self.client.post("/auth/google", json={}, headers={"Origin":"https://attacker.invalid"}).status_code, 403)
        self.fetch.side_effect = requests.exceptions.ConnectionError("test unavailable")
        self.assertEqual(self.post().status_code, 503); self.assertEqual(db.session.query(User).count(), 0)
        self.app.config["AUTH_RATE_LIMIT"] = 1
        self.client.get("/auth/google/config", environ_base={"REMOTE_ADDR":"127.0.0.2"})
        self.assertEqual(self.client.post("/auth/google", json={}, environ_base={"REMOTE_ADDR":"127.0.0.2"}).status_code,429)
        self.app.config["AUTH_RATE_LIMIT"] = 1000
        self.app.config["GOOGLE_CLIENT_ID"] = ""
        self.assertEqual(self.client.get("/auth/google/config").status_code,503)
        self.assertEqual(self.post().status_code,503)


if __name__ == "__main__": unittest.main()
