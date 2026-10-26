"""Google supplies identity; only our shared JWT verifier grants API access."""
import secrets

import bcrypt
import requests
from flask import Blueprint, current_app, jsonify, request
from google.auth.exceptions import GoogleAuthError, TransportError
from google.auth.transport.requests import Request
from google.oauth2 import id_token
from itsdangerous import BadSignature, URLSafeTimedSerializer
from sqlalchemy.exc import IntegrityError

from .auth import json_fields, normalized_email, password_bytes
from .models import db, User
from .tokens import issue_token

google_auth = Blueprint("google_auth", __name__, url_prefix="/auth/google")
COOKIE = "focuslens_google_nonce"


def signer():
    # A purpose-specific signature; this cookie cannot serve as an API JWT.
    return URLSafeTimedSerializer(current_app.config["JWT_SECRET_KEY"], salt="focuslens-google-nonce-v1")


class BoundedGoogleRequest(Request):
    def __call__(self, *args, **kwargs):
        kwargs["timeout"] = 10
        return super().__call__(*args, **kwargs)


@google_auth.before_request
def limit_google_attempts():
    if not current_app.extensions["auth_limiter"].allowed(request.remote_addr):
        return jsonify(error="Too many attempts. Wait a minute and try again."), 429, {"Retry-After": "60"}


@google_auth.get("/config")
def config():
    client_id = current_app.config["GOOGLE_CLIENT_ID"]
    if not client_id:
        return jsonify(error="Google sign-in is not configured on this service."), 503
    nonce = secrets.token_urlsafe(32)
    response = jsonify(clientId=client_id, nonce=nonce)
    response.set_cookie(COOKIE, signer().dumps(nonce), max_age=current_app.config["GOOGLE_NONCE_SECONDS"],
                        secure=current_app.config["PRODUCTION"], httponly=True, samesite="Strict", path="/auth/google")
    return response


@google_auth.post("")
def authenticate_google():
    if not current_app.config["GOOGLE_CLIENT_ID"]:
        return jsonify(error="Google sign-in is not configured on this service."), 503
    try:
        data = json_fields({"idToken", "role", "password"})
        token = data.get("idToken")
        if not isinstance(token, str) or not 1 <= len(token) <= 8192:
            raise ValueError("Choose your Google account again.")
        if data.get("role", "student") not in ("student", "parent"):
            raise ValueError("Choose student or parent.")
    except ValueError as error:
        return jsonify(error=str(error)), 400
    try:
        nonce = signer().loads(request.cookies.get(COOKIE, ""), max_age=current_app.config["GOOGLE_NONCE_SECONDS"])
        if not isinstance(nonce, str) or not nonce:
            raise BadSignature("Missing nonce")
    except BadSignature:
        return jsonify(error="Google sign-in expired. Retry Google sign-in.", code="google_restart"), 401
    try:
        # The library verifies Google's signature, issuer, audience and expiry.
        # Never decode without verification or accept client-submitted user info.
        with requests.Session() as session:
            claims = id_token.verify_oauth2_token(token, BoundedGoogleRequest(session=session), current_app.config["GOOGLE_CLIENT_ID"])
        if claims.get("iss") not in ("accounts.google.com", "https://accounts.google.com") or claims.get("aud") != current_app.config["GOOGLE_CLIENT_ID"]:
            raise ValueError("Invalid issuer or audience")
        if not isinstance(claims.get("nonce"), str) or not secrets.compare_digest(claims["nonce"].encode(), nonce.encode()):
            raise ValueError("Wrong browser challenge")
        subject = claims.get("sub")
        if not isinstance(subject, str) or not 1 <= len(subject) <= 255 or claims.get("email_verified") is not True:
            raise ValueError("Unverified Google identity")
        email = normalized_email(claims.get("email"))
    except TransportError:
        return jsonify(error="Google could not be reached. Please try again."), 503
    except (ValueError, GoogleAuthError):
        return jsonify(error="Google sign-in could not be verified. Retry Google sign-in.", code="google_restart"), 401

    user = db.session.execute(db.select(User).where(User.google_id == subject)).scalar_one_or_none()
    created = False
    if user is None:
        user = db.session.execute(db.select(User).where(User.email == email)).scalar_one_or_none()
        if user is not None:
            # Password signup has not verified email ownership. Blind email
            # linking could preserve an attacker's password on a victim account.
            # Require both the verified Google identity and the existing password.
            if user.google_id is not None or user.password_hash is None:
                return jsonify(error="This account cannot be linked to that Google identity."), 409
            if "password" not in data:
                return jsonify(error="Enter your existing FocusLens password to link this account.", code="password_required"), 409
            try:
                valid = bcrypt.checkpw(password_bytes(data["password"]), user.password_hash)
            except ValueError:
                valid = False
            if not valid:
                return jsonify(error="Invalid credentials."), 401
            user.google_id = subject
        else:
            name = claims.get("name")
            if not isinstance(name, str) or not name.strip(): name = "FocusLens user"
            name = "".join(c for c in name if ord(c) >= 32 and ord(c) != 127).strip()[:100] or "FocusLens user"
            user = User(email=email, google_id=subject, display_name=name, role=data.get("role", "student"))
            db.session.add(user)
            created = True
    # Existing users retain their stored name/email/role; sub is the identity.
    try:
        db.session.commit()
    except IntegrityError:
        db.session.rollback()
        return jsonify(error="Account access changed. Please sign in again."), 409
    response = jsonify(issue_token(user))
    response.status_code = 201 if created else 200
    response.delete_cookie(COOKIE, path="/auth/google", secure=current_app.config["PRODUCTION"], httponly=True, samesite="Strict")
    return response
