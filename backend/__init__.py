"""Phase 2 Flask application factory. Phase 1 remains a local-only app."""
from pathlib import Path
from io import BytesIO
import logging
import zipfile
from urllib.parse import urlsplit

from flask import Flask, jsonify, request, send_from_directory, send_file
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
    production = env.get("FOCUSLENS_ENV", "development") == "production" or env.get("RENDER") == "true"
    origin = (env.get("PUBLIC_ORIGIN") or env.get("RENDER_EXTERNAL_URL") or "http://localhost:8001").rstrip("/")
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
        MAX_CONTENT_LENGTH=2097152, AUTH_RATE_LIMIT=20, AUTH_RATE_WINDOW=60,
        GOOGLE_CLIENT_ID=env.get("GOOGLE_CLIENT_ID", ""), GOOGLE_NONCE_SECONDS=600,
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
    from .google_auth import google_auth
    app.register_blueprint(google_auth)
    from .services import Services
    from .data import api
    app.extensions["account_services"] = Services(env,app.config.get("REPORT_SENDER"))
    app.register_blueprint(api)
    from .preferences import preferences
    app.register_blueprint(preferences)
    from .web_push import PushService, api as web_push_api
    app.extensions['web_push'] = PushService(app, app.config.get('WEB_PUSH_PRIVATE_KEY', env.get('WEB_PUSH_PRIVATE_KEY', '')),
        app.config.get('WEB_PUSH_SUBJECT', env.get('WEB_PUSH_SUBJECT', '')), app.config.get('WEB_PUSH_SENDER'))
    app.register_blueprint(web_push_api)

    @app.before_request
    def transport_and_origin():
        # Preserve the small auth-body limit; history import is bounded separately.
        if request.path in ("/auth/login","/auth/signup","/auth/google") and (request.content_length or 0)>16384:
            data=request.get_json(silent=True) if request.is_json else None
            if not isinstance(data,dict) or not {"localProfileId","localSessionHistory","localPacingHistory"}.intersection(data):
                return jsonify(error="Account request is too large."),413
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
        response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin" if app.config["PRODUCTION"] else "no-referrer-when-downgrade"
        response.headers["Content-Security-Policy"] = "default-src 'none'; script-src 'self' https://accounts.google.com/gsi/client; style-src 'self' https://accounts.google.com/gsi/style; connect-src 'self' https://accounts.google.com/gsi/; frame-src https://accounts.google.com/gsi/; img-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'"
        if request.path=="/study" or request.path.startswith("/js/") or request.path=="/tests/account-study-browser.html":
            response.headers["Content-Security-Policy"] = "default-src 'none'; script-src 'self' 'wasm-unsafe-eval' https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.32/; style-src 'self'; connect-src 'self' https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.32/ https://storage.googleapis.com/mediapipe-models/; worker-src 'self' blob:; img-src 'self' data: blob:; media-src 'self' blob:; manifest-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'"
        response.headers["Cross-Origin-Opener-Policy"] = "same-origin-allow-popups"
        if request.path.startswith('/companion'):
            response.headers['Content-Security-Policy'] = "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; worker-src 'self'; manifest-src 'self'; img-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'"
            response.headers['Permissions-Policy'] = 'camera=(), microphone=(), geolocation=()'
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
        return jsonify(app="FocusLens Accounts", phase=2, checkpoint="account-study")

    @app.get("/")
    @app.get("/account.html")
    def account_page():
        return send_from_directory(ROOT, "account.html")

    @app.get("/assets/<path:name>")
    def account_assets(name):
        allowed = {path.name: ROOT / "js" for path in (ROOT/"js").glob("*.js")}
        allowed.update({"account.css": ROOT,"icon-192.png":ROOT})
        if name not in allowed: return jsonify(error="Not found."), 404
        return send_from_directory(allowed[name], name)

    @app.get("/study")
    def study_page(): return send_from_directory(ROOT,"index.html")

    @app.get('/companion')
    @app.get('/companion/')
    def companion_page(): return send_from_directory(ROOT/'companion', 'index.html')

    @app.get('/companion/<name>')
    def companion_asset(name):
        if name not in {'app.js', 'styles.css', 'manifest.webmanifest', 'push.js', 'sw.js'}: return jsonify(error='Not found.'),404
        return send_from_directory(ROOT/'companion', name)

    @app.get('/companion/shared/<name>')
    def companion_shared_asset(name):
        if name not in {'api.js', 'config.js', 'session.js', 'progress.js'}: return jsonify(error='Not found.'),404
        return send_from_directory(ROOT/'mobile'/'src',name)

    @app.get("/js/<name>")
    def study_asset(name):
        if name not in {path.name for path in (ROOT/"js").glob("*.js")}: return jsonify(error="Not found."),404
        return send_from_directory(ROOT/"js",name)

    @app.get("/<name>")
    def public_asset(name):
        if name not in {"styles.css","manifest.json","icon-192.png","icon-512.png"}: return jsonify(error="Not found."),404
        return send_from_directory(ROOT,name)

    @app.get("/downloads/FocusLens-monitor.zip")
    def monitor_download():
        buffer=BytesIO()
        with zipfile.ZipFile(buffer,"w",zipfile.ZIP_DEFLATED) as archive:
            for name in ("account_monitor.py","window_monitor.py","window_rules.py","connect-monitor.command"):
                archive.write(ROOT/name,arcname="FocusLens-monitor/"+name)
            archive.writestr("FocusLens-monitor/server.txt",app.config["PUBLIC_ORIGIN"])
        buffer.seek(0)
        return send_file(buffer,mimetype="application/zip",as_attachment=True,download_name="FocusLens-monitor.zip")

    if not app.config["PRODUCTION"]:
        @app.get("/tests/<name>")
        def local_browser_check(name):
            if name not in {"account-study-browser.html","account-study-browser.mjs"}: return jsonify(error="Not found."),404
            return send_from_directory(ROOT/"tests",name)

    return app
