"""Email/password authentication. Neither passwords nor hashes are logged."""
from collections import OrderedDict, deque
import re
import secrets
import threading
import time

import bcrypt
from flask import Blueprint, current_app, g, jsonify, request
from sqlalchemy.exc import IntegrityError

from .models import db, User
from .tokens import issue_token, require_auth
from .legacy import LEGACY_FIELDS, maybe_import

auth = Blueprint("auth", __name__, url_prefix="/auth")


def authentication_result(user, data):
    result=issue_token(user)
    migration=maybe_import(user,data)
    if migration is not None: result["migration"]=migration
    return result


class AuthLimiter:
    def __init__(self):
        self.attempts = OrderedDict()
        self.lock = threading.Lock()

    def allowed(self, address):
        now = time.monotonic()
        with self.lock:
            rows = self.attempts.setdefault(address, deque())
            while rows and rows[0] <= now - current_app.config["AUTH_RATE_WINDOW"]: rows.popleft()
            self.attempts.move_to_end(address)
            while len(self.attempts) > 5000: self.attempts.popitem(last=False)
            if len(rows) >= current_app.config["AUTH_RATE_LIMIT"]: return False
            rows.append(now)
            return True


def json_fields(permitted):
    if request.mimetype != "application/json":
        raise ValueError("Use an application/json request.")
    data = request.get_json()
    if not isinstance(data, dict) or set(data) - set(permitted):
        raise ValueError("Unexpected account fields. Identity cannot be supplied by the client.")
    return data


def normalized_email(value):
    if not isinstance(value, str): raise ValueError("Enter a valid email address.")
    value = value.strip().casefold()
    if len(value) > 254 or not value.isascii() or not re.fullmatch(r"[^@\s,<>\x00-\x1f\x7f]+@[^@\s,<>\x00-\x1f\x7f]+\.[A-Za-z]{2,63}", value):
        raise ValueError("Enter a valid email address.")
    return value


def password_bytes(value):
    if not isinstance(value, str) or len(value) < 8:
        raise ValueError("Use a password with at least 8 characters.")
    try: encoded = value.encode("utf-8")
    except UnicodeError: raise ValueError("Enter a valid password.") from None
    if len(encoded) > 72:
        # bcrypt has a 72-byte input limit. Reject, never silently truncate.
        raise ValueError("Password must fit within 72 UTF-8 bytes. Choose a shorter password.")
    return encoded


@auth.before_request
def limit_attempts():
    if request.endpoint in ("auth.signup", "auth.login") and not current_app.extensions["auth_limiter"].allowed(request.remote_addr):
        return jsonify(error="Too many attempts. Wait a minute and try again."), 429, {"Retry-After": "60"}


@auth.post("/signup")
def signup():
    try:
        data = json_fields({"email", "password", "displayName", "role"} | LEGACY_FIELDS)
        email = normalized_email(data.get("email"))
        password = password_bytes(data.get("password"))
        name = data.get("displayName")
        if not isinstance(name, str) or not 1 <= len(name.strip()) <= 100 or any(ord(c) < 32 or ord(c) == 127 for c in name):
            raise ValueError("Enter a display name between 1 and 100 characters.")
        if data.get("role") not in ("student", "parent"):
            raise ValueError("Choose student or parent.")
        user = User(email=email, display_name=name.strip(), role=data["role"],
                    password_hash=bcrypt.hashpw(password, bcrypt.gensalt(current_app.config["BCRYPT_ROUNDS"])))
        db.session.add(user)
        db.session.commit()
        return jsonify(authentication_result(user,data)), 201
    except ValueError as error:
        return jsonify(error=str(error)), 400
    except IntegrityError:
        db.session.rollback()
        return jsonify(error="An account could not be created with these details. Try signing in instead."), 409


@auth.post("/login")
def login():
    try:
        data = json_fields({"email", "password"} | LEGACY_FIELDS)
    except ValueError as error:
        return jsonify(error=str(error)), 400
    try:
        email = normalized_email(data.get("email")); password = password_bytes(data.get("password"))
    except ValueError:
        return jsonify(error="Invalid credentials."), 401
    user = db.session.execute(db.select(User).where(User.email == email)).scalar_one_or_none()
    candidate = user.password_hash if user and user.password_hash else current_app.extensions["dummy_password_hash"]
    valid = bcrypt.checkpw(password, candidate)
    if not user or not user.password_hash or not valid:
        return jsonify(error="Invalid credentials."), 401
    return jsonify(authentication_result(user,data))


@auth.get("/me")
@require_auth
def me():
    return jsonify(g.user.public())


def register_auth(app):
    app.extensions["auth_limiter"] = AuthLimiter()
    app.extensions["dummy_password_hash"] = bcrypt.hashpw(secrets.token_bytes(32), bcrypt.gensalt(app.config["BCRYPT_ROUNDS"]))
    app.register_blueprint(auth)
