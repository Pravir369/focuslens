import tempfile
import time
import unittest
from pathlib import Path

import jwt
from flask import g, jsonify
from flask_migrate import upgrade

from backend import create_app
from backend.models import db, User
from backend.tokens import require_auth


class TokenTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.key = "test-only-signing-secret-" * 3
        self.app = create_app({"TESTING": True, "JWT_SECRET_KEY": self.key, "BCRYPT_ROUNDS": 4,
            "AUTH_RATE_LIMIT": 1000, "SQLALCHEMY_DATABASE_URI": "sqlite:///" + str(Path(self.directory.name) / "test.sqlite3")})
        self.context=self.app.app_context(); self.context.push(); upgrade()
        self.calls=0
        @self.app.post("/test-protected")
        @require_auth
        def protected():
            self.calls+=1
            return jsonify(userId=g.user_id, role=g.user.role)
        self.client=self.app.test_client()
        body=self.client.post("/auth/signup", json={"email": "student@example.test", "password": "Test password 123", "displayName": "Student", "role": "student"}).get_json()
        self.token=body["token"]; self.user_id=body["user"]["id"]
        self.claims=jwt.decode(self.token, self.key, algorithms=["HS256"], audience="focuslens-api", issuer="focuslens")

    def tearDown(self):
        db.session.remove(); db.engine.dispose(); self.context.pop(); self.directory.cleanup()

    def signed(self, **changes):
        return jwt.encode({**self.claims, **changes}, self.key, algorithm="HS256")

    def me(self, token=None, **kwargs):
        return self.client.get("/auth/me", headers={"Authorization": "Bearer " + (token or self.token)}, **kwargs)

    def test_verified_identity_overrides_client_claims_in_body_query_and_headers(self):
        result=self.me(query_string={"userId": "attacker"})
        self.assertEqual(result.status_code, 200); self.assertEqual(result.get_json()["id"], self.user_id)
        self.assertNotIn("password_hash", result.get_json())
        result=self.client.post("/test-protected", json={"userId": "attacker", "profileId": "other"}, headers={"Authorization": "Bearer " + self.token, "X-User-Id": "attacker"})
        self.assertEqual(result.get_json(), {"userId": self.user_id, "role": "student"}); self.assertEqual(self.calls, 1)

    def test_missing_forged_expired_wrong_algorithm_or_claims_never_run_handler(self):
        expired=self.signed(exp=int(time.time())-1)
        missing=dict(self.claims); del missing["exp"]
        invalid=["invalid", self.token + "tampered", jwt.encode(self.claims, "wrong-key-" * 4, algorithm="HS256"),
            expired, jwt.encode(self.claims, "", algorithm="none"), jwt.encode(self.claims, self.key, algorithm="HS384"),
            jwt.encode(missing, self.key, algorithm="HS256"), self.signed(aud="wrong"), self.signed(iss="wrong"),
            self.signed(nbf=int(time.time())+100), self.signed(sub="someone-else"), self.signed(role="parent"),
            self.signed(exp=int(time.time())+604900), self.signed(userId=[self.user_id])]
        headers=[{}, {"Authorization": "Basic abc"}, {"Authorization": "Bearer"}] + [{"Authorization": "Bearer " + token} for token in invalid]
        for header in headers:
            response=self.client.post("/test-protected", json={"userId": self.user_id}, headers=header)
            self.assertEqual(response.status_code, 401); self.assertEqual(response.get_json(), {"error": "Authentication required."})
            self.assertEqual(response.headers["WWW-Authenticate"], "Bearer")
        self.assertEqual(self.calls, 0)

    def test_deleted_user_and_changed_role_cannot_reuse_a_valid_old_token(self):
        user=db.session.get(User,self.user_id); user.role="parent"; db.session.commit()
        self.assertEqual(self.me().status_code, 401)
        user.role="student"; db.session.commit(); self.assertEqual(self.me().status_code, 200)
        db.session.delete(user); db.session.commit(); self.assertEqual(self.me().status_code, 401)

    def test_production_rejects_insecure_configuration_and_plain_http_requests(self):
        with self.assertRaises(RuntimeError): create_app({"JWT_SECRET_KEY": "short"})
        with self.assertRaises(RuntimeError): create_app({"JWT_SECRET_KEY": self.key, "PRODUCTION": True, "PUBLIC_ORIGIN": "http://accounts.example.test"})
        with self.assertRaises(RuntimeError): create_app({"JWT_SECRET_KEY": self.key, "PRODUCTION": True, "PUBLIC_ORIGIN": "https://accounts.example.test"})
        self.app.config.update(PRODUCTION=True, PUBLIC_ORIGIN="https://accounts.example.test", TRUSTED_HOSTS=["accounts.example.test"])
        response=self.client.get("/auth/me", headers={"Authorization": "Bearer " + self.token}, base_url="http://accounts.example.test")
        self.assertEqual(response.status_code, 426)
        response=self.client.get("/auth/me", headers={"Authorization": "Bearer " + self.token}, base_url="https://accounts.example.test")
        self.assertEqual(response.status_code, 200)
        self.assertIn("max-age=", response.headers["Strict-Transport-Security"])


if __name__ == "__main__": unittest.main()
