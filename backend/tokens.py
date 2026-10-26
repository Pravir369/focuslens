"""One signing policy and one shared verifier for every protected route."""
from datetime import datetime, timedelta, timezone
from functools import wraps
import uuid
import jwt
from flask import current_app, g, jsonify, request
from .models import db, User


def issue_token(user):
    now = datetime.now(timezone.utc)
    expires = now + timedelta(seconds=current_app.config["JWT_LIFETIME_SECONDS"])
    token = jwt.encode({"userId": user.id, "sub": user.id, "role": user.role,
        "iat": now, "nbf": now, "exp": expires, "iss": current_app.config["JWT_ISSUER"],
        "aud": current_app.config["JWT_AUDIENCE"], "jti": str(uuid.uuid4())},
        current_app.config["JWT_SECRET_KEY"], algorithm="HS256")
    return {"token": token, "tokenType": "Bearer", "expiresAt": expires.isoformat(), "user": user.public()}


def unauthorized():
    return jsonify(error="Authentication required."), 401, {"WWW-Authenticate": "Bearer"}


def require_auth(handler):
    @wraps(handler)
    def authenticated(*args, **kwargs):
        parts = request.headers.get("Authorization", "").split()
        if len(parts) != 2 or parts[0].lower() != "bearer" or len(parts[1]) > 8192:
            return unauthorized()
        try:
            claims = jwt.decode(parts[1], current_app.config["JWT_SECRET_KEY"], algorithms=["HS256"],
                audience=current_app.config["JWT_AUDIENCE"], issuer=current_app.config["JWT_ISSUER"],
                options={"require": ["exp", "iat", "nbf", "sub", "userId", "role", "iss", "aud", "jti"]})
            user_id = claims["userId"]
            if not isinstance(user_id, str) or str(uuid.UUID(user_id)) != user_id or claims["sub"] != user_id:
                return unauthorized()
            if claims["role"] not in ("student", "parent") or not isinstance(claims["jti"], str):
                return unauthorized()
            if type(claims["exp"]) is not int or type(claims["iat"]) is not int or type(claims["nbf"]) is not int or not 0 < claims["exp"] - claims["iat"] <= current_app.config["JWT_LIFETIME_SECONDS"]:
                return unauthorized()
        except (jwt.InvalidTokenError, ValueError, TypeError, KeyError):
            return unauthorized()
        # Load the current user and role. Deleted users or changed roles do not
        # retain access just because an otherwise valid old token still exists.
        user = db.session.get(User, user_id)
        if user is None or user.role != claims["role"]: return unauthorized()
        g.user_id = user.id
        g.user = user
        return handler(*args, **kwargs)
    return authenticated
