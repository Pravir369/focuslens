import tempfile
import unittest
from pathlib import Path

import bcrypt
import jwt
from flask_migrate import upgrade

from backend import create_app
from backend.models import db, User


class AuthTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.key = "test-only-signing-secret-" * 3
        self.app = create_app({"TESTING": True, "JWT_SECRET_KEY": self.key, "BCRYPT_ROUNDS": 4,
            "AUTH_RATE_LIMIT": 1000, "SQLALCHEMY_DATABASE_URI": "sqlite:///" + str(Path(self.directory.name) / "test.sqlite3")})
        self.context = self.app.app_context(); self.context.push(); upgrade()
        self.client = self.app.test_client()

    def tearDown(self):
        db.session.remove(); db.engine.dispose(); self.context.pop(); self.directory.cleanup()

    def signup(self, **changes):
        return self.client.post("/auth/signup", json={"email": "Student@Example.test", "password": "Test password 123", "displayName": "Test Student", "role": "student", **changes})

    def test_signup_login_persisted_bcrypt_hash_and_signed_identity(self):
        response = self.signup(); self.assertEqual(response.status_code, 201)
        body=response.get_json(); self.assertEqual(set(body["user"]), {"id", "email", "displayName", "role"})
        user = db.session.execute(db.select(User)).scalar_one()
        self.assertEqual(user.email, "student@example.test")
        self.assertNotEqual(user.password_hash, b"Test password 123")
        self.assertTrue(bcrypt.checkpw(b"Test password 123", user.password_hash))
        claims = jwt.decode(body["token"], self.key, algorithms=["HS256"], audience="focuslens-api", issuer="focuslens")
        self.assertEqual(claims["userId"], user.id)
        self.assertEqual(claims["role"], "student")
        self.assertEqual(claims["exp"] - claims["iat"], 604800)
        response = self.client.post("/auth/login", json={"email": " STUDENT@example.test ", "password": "Test password 123"})
        self.assertEqual(response.status_code, 200); self.assertEqual(response.get_json()["user"]["id"], user.id)
        # New client/app instance uses the migrated database, not in-memory users.
        second=create_app({**self.app.config, "TESTING": True})
        self.assertEqual(second.test_client().post("/auth/login", json={"email": user.email, "password": "Test password 123"}).status_code, 200)
        with second.app_context():
            db.session.remove(); db.engine.dispose()

    def test_same_generic_error_for_wrong_email_password_google_only_and_invalid_input(self):
        self.signup()
        db.session.add(User(email="google@example.test", display_name="Google only", role="student", google_id="test-google-sub")); db.session.commit()
        for email, password in [("missing@example.test", "Test password 123"), ("student@example.test", "Wrong password 123"), ("google@example.test", "Test password 123"), ("not an email", "x"), ("student@example.test", "x" * 73)]:
            response=self.client.post("/auth/login", json={"email": email, "password": password})
            self.assertEqual(response.status_code, 401); self.assertEqual(response.get_json(), {"error": "Invalid credentials."})

    def test_password_boundaries_reject_instead_of_silent_truncation_and_use_unique_salts(self):
        for password in ["short", "x" * 73, "🙂" * 19, None, 123]:
            self.assertEqual(self.signup(password=password).status_code, 400)
        self.assertEqual(self.signup(password="12345678").status_code, 201)
        self.assertEqual(self.signup(email="other@example.test", password="12345678").status_code, 201)
        hashes=[row.password_hash for row in db.session.execute(db.select(User)).scalars()]
        self.assertNotEqual(hashes[0], hashes[1])
        self.assertEqual(self.signup(email="max@example.test", password="x" * 72).status_code, 201)

    def test_client_cannot_choose_identity_or_unrecognized_role_and_duplicates_are_atomic(self):
        for changes in [{"userId": "someone-else"}, {"profileId": "someone-else"}, {"role": "admin"}, {"email": "invalid"}, {"displayName": ""}]:
            self.assertEqual(self.signup(**changes).status_code, 400)
        self.signup(); self.assertEqual(self.signup().status_code, 409)
        self.assertEqual(db.session.query(User).count(), 1)
        self.assertEqual(self.client.post("/auth/login", json={"email": "student@example.test", "password": "Test password 123", "userId": "other"}).status_code, 400)

    def test_json_host_origin_request_size_and_rate_limits(self):
        self.assertEqual(self.client.post("/auth/login", data="{}", content_type="text/plain").status_code, 400)
        self.assertEqual(self.client.post("/auth/login", json=[]).status_code, 400)
        self.assertEqual(self.client.post("/auth/login", data="{", content_type="application/json").status_code, 400)
        self.assertEqual(self.client.post("/auth/login", json={"password": "x" * 20000}).status_code, 413)
        self.assertEqual(self.client.get("/health", headers={"Host": "attacker.invalid"}).status_code, 400)
        self.assertEqual(self.client.post("/auth/login", json={}, headers={"Origin": "https://attacker.invalid"}).status_code, 403)
        self.app.config["AUTH_RATE_LIMIT"]=2
        for _ in range(2): self.client.post("/auth/login", json={}, environ_base={"REMOTE_ADDR": "127.0.0.2"})
        response=self.client.post("/auth/login", json={}, environ_base={"REMOTE_ADDR": "127.0.0.2"})
        self.assertEqual(response.status_code, 429); self.assertIn("Retry-After", response.headers)

    def test_no_secrets_in_responses_or_static_routes(self):
        body=self.signup().get_json()
        self.assertNotIn("password", str(body)); self.assertNotIn("hash", str(body)); self.assertNotIn(self.key, str(body))
        for path in ["/.env", "/.instance/focuslens.sqlite3", "/backend/auth.py", "/assets/../.env", "/assets/account.js/../../.env"]:
            response=self.client.get(path); self.assertEqual(response.status_code, 404)
        response=self.client.get("/")
        self.assertEqual(response.status_code, 200)
        self.assertIn("frame-ancestors 'none'", response.headers["Content-Security-Policy"])
        self.assertEqual(response.headers["Cache-Control"], "no-store")
        response.close()


if __name__ == "__main__": unittest.main()
