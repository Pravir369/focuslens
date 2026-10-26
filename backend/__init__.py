"""Phase 2 Flask application factory. Phase 1 remains a local-only app."""
from pathlib import Path
import logging
from urllib.parse import urlsplit

from flask import Flask, jsonify, request, send_from_directory
from flask_migrate import Migrate
from werkzeug.exceptions import HTTPException
from werkzeug.middleware.proxy_fix import ProxyFix

from email_reports import local_environment
from .models import db

ROOT = Path(__file__).resolve().parent.parent
migrate = Migrate()


def create_app(test_config=None):
    env = local_environment(ROOT / ".env")
    app = Flask(__name__, static_folder=None, instance_path=str(ROOT / ".instance"))
    production = env.get("FOCUSLENS_ENV", "development") == "production"
    origin = env.get("PUBLIC_ORIGIN", "http://localhost:8001").rstrip("/")
    uri = env.get("DATABASE_URL") or f"sqlite:///{ROOT / '.instance' / 'focuslens.sqlite3'}"
    if uri.startswith("postgres://"): uri = uri.replace("postgres://", "postgresql+psycopg://", 1)
    elif uri.startswith("postgresql://"): uri = uri.replace("postgresql://", "postgresql+psycopg://", 1)
    app.config.from_mapping(
        SQLALCHEMY_DATABASE_URI=uri, SQLALCHEMY_TRACK_MODIFICATIONS=False,
        SQLALCHEMY_ENGINE_OPTIONS={"hide_parameters": True, "pool_pre_ping": True},
        JWT_SECRET_KEY=env.get("JWT_SECRET_KEY", ""), JWT_ISSUER="focuslens", JWT_AUDIENCE="focuslens-api",
        JWT_LIFETIME_SECONDS=7 * 24 * 60 * 60, BCRYPT_ROUNDS=12,
        PRODUCTION=production, PUBLIC_ORIGIN=origin, TRUST_PROXY=env.get("TRUST_PROXY") == "1",
        TRUSTED_HOSTS=[urlsplit(origin).hostname] if production else ["localhost", "127.0.0.1"],
        MAX_CONTENT_LENGTH=16384, AUTH_RATE_LIMIT=20, AUTH_RATE_WINDOW=60,
    )
    if test_config: app.config.update(test_config)
    if len(app.config["JWT_SECRET_KEY"].encode()) < 32:
        raise RuntimeError("Set JWT_SECRET_KEY to a long random secret in the local environment before starting Phase 2.")
    if app.config["PRODUCTION"]:
        public = urlsplit(app.config["PUBLIC_ORIGIN"])
        if public.scheme != "https" or not public.hostname or public.username or public.password or public.path or public.query or public.fragment:
            raise RuntimeError("Production requires an HTTPS PUBLIC_ORIGIN.")
        if app.config["SQLALCHEMY_DATABASE_URI"].startswith("sqlite:"):
            raise RuntimeError("Configure managed PostgreSQL before production deployment; local SQLite is development-only.")
    Path(app.instance_path).mkdir(mode=0o700, parents=True, exist_ok=True)
    logging.getLogger("sqlalchemy.engine").setLevel(logging.ERROR)
    if app.config["TRUST_PROXY"]:
        # Enable only behind a known single reverse proxy configured by the host.
        app.wsgi_app = ProxyFix(app.wsgi_app, x_for=1, x_proto=1)
    db.init_app(app)
    migrate.init_app(app, db, directory=str(ROOT / "migrations"))
    from .auth import register_auth
    register_auth(app)

    @app.before_request
    def transport_and_origin():
        if app.config["PRODUCTION"] and not request.is_secure:
            return jsonify(error="HTTPS is required."), 426
        origin = request.headers.get("Origin")
        permitted_origins = {app.config["PUBLIC_ORIGIN"]}
        if not app.config["PRODUCTION"]: permitted_origins.add(request.host_url.rstrip("/"))
        if (origin and origin not in permitted_origins) or request.headers.get("Sec-Fetch-Site") == "cross-site":
            return jsonify(error="Cross-origin requests are not accepted."), 403

    @app.after_request
    def security_headers(response):
        response.headers["Cache-Control"] = "no-store"
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["Referrer-Policy"] = "no-referrer"
        response.headers["Content-Security-Policy"] = "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'"
        if app.config["PRODUCTION"]: response.headers["Strict-Transport-Security"] = "max-age=31536000"
        return response

    @app.errorhandler(HTTPException)
    def http_error(error):
        return jsonify(error="Request could not be accepted.", status=error.code), error.code

    @app.errorhandler(Exception)
    def server_error(error):
        db.session.rollback()
        # Never log exceptions containing bound SQL parameters, auth payloads,
        # password hashes, connection strings, or tokens.
        return jsonify(error="The request could not be completed. Please try again."), 500

    @app.get("/health")
    def health():
        return jsonify(app="FocusLens Accounts", phase=2, checkpoint="jwt-middleware")

    @app.get("/")
    @app.get("/account.html")
    def account_page():
        return send_from_directory(ROOT, "account.html")

    @app.get("/assets/<path:name>")
    def account_assets(name):
        allowed = {"account.js": ROOT / "js", "account.css": ROOT, "icon-192.png": ROOT}
        if name not in allowed: return jsonify(error="Not found."), 404
        return send_from_directory(allowed[name], name)

    return app
