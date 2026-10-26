#!/usr/bin/env python3
"""Loopback-only static app and JSON API. profileId is not authentication."""
import argparse
import json
import re
import threading
import time
import uuid
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, unquote, urlsplit

from email_reports import MailConfig, ReportDeliveryError, recipients, send_report, validate_summary
from window_rules import allowed_apps, is_on_task

ROOT = Path(__file__).resolve().parent


def profile_id(value):
    if not isinstance(value, str) or not 1 <= len(value) <= 128 or value.strip() != value or any(ord(c) < 32 or ord(c) == 127 for c in value):
        raise ValueError("A valid profileId is required.")
    return value


class AppState:
    def __init__(self, mail_config=None, sender=send_report):
        self.mail_config = mail_config or MailConfig()
        self.sender = sender
        self.reports = {}
        self.sessions = {}
        self.windows = {}
        self.lock = threading.Lock()

    def queue_report(self, owner, summary, addresses):
        report_id = str(uuid.uuid4())
        job = {"profileId": owner, "reportId": report_id, "status": "sending", "sentCount": 0, "error": "", "createdAt": time.time()}
        with self.lock:
            self.reports = {key: value for key, value in self.reports.items() if time.time() - value["createdAt"] < 3600}
            if len(self.reports) >= 100:
                raise ValueError("Too many recent reports. Try again later.")
            self.reports[report_id] = job
        def deliver():
            try:
                count = self.sender(self.mail_config, summary, addresses)
                result = {"status": "sent", "sentCount": count}
            except ReportDeliveryError as error:
                result = {"status": "failed", "sentCount": error.sent_count, "error": str(error)}
            except Exception:
                result = {"status": "failed", "error": "Email delivery was not confirmed. Check your inbox before retrying."}
            with self.lock:
                job.update(result)
        threading.Thread(target=deliver, daemon=True, name="focuslens-report").start()
        return {key: job[key] for key in ("profileId", "reportId", "status")}

    def active_session(self):
        now = time.time() * 1000
        candidates = [row for row in self.sessions.values() if row["active"] and row["monitorEnabled"] and now - row["updatedAt"] <= 10000]
        return max(candidates, key=lambda row: row["updatedAt"]) if candidates else None

    def update_session(self, data, session_id=None):
        owner = profile_id(data.get("profileId"))
        session_id = session_id or data.get("sessionId")
        if not isinstance(session_id, str) or not re.fullmatch(r"[A-Za-z0-9_-]{1,100}", session_id):
            raise ValueError("A sessionId is required.")
        if type(data.get("revision")) is not int or data["revision"] < 1 or type(data.get("active")) is not bool or type(data.get("monitorEnabled")) is not bool:
            raise ValueError("Invalid session status.")
        apps = allowed_apps(data.get("allowedApps"))
        with self.lock:
            old = self.sessions.get(session_id)
            if old and old["profileId"] != owner:
                raise ValueError("Session profile mismatch.")
            if old and old["revision"] >= data["revision"]:
                return dict(old)  # A delayed heartbeat cannot undo pause/end.
            self.sessions = {key: row for key, row in self.sessions.items() if time.time() * 1000 - row["updatedAt"] < 3600000}
            row = {"profileId": owner, "sessionId": session_id, "revision": data["revision"], "active": data["active"],
                   "monitorEnabled": data["monitorEnabled"], "allowedApps": apps, "updatedAt": time.time() * 1000}
            # A monitor read begun before pause/resume must not be stamped as
            # fresh when its slow AppleScript result arrives after resume.
            row["evidenceRevision"] = old["evidenceRevision"] if old and old["active"] == row["active"] and old["monitorEnabled"] == row["monitorEnabled"] else row["revision"]
            self.sessions[session_id] = row
            if not row["active"]:
                self.windows.pop(owner, None)
            return dict(row)


class FocusLensServer(ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = True

    def __init__(self, address, state=None, directory=ROOT):
        self.state = state or AppState(MailConfig.load(ROOT / ".env"))
        self.directory = Path(directory).resolve()
        super().__init__(address, Handler)


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(args[2].directory), **kwargs)

    def log_message(self, format, *args):
        pass  # Do not put profile IDs, addresses, or payloads in access logs.

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        super().end_headers()

    def json_response(self, status, value):
        body = json.dumps(value, allow_nan=False).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def json_body(self):
        origin = self.headers.get("Origin")
        if origin and origin != f"http://{self.headers.get('Host')}":
            raise ValueError("Only same-origin JSON requests are accepted.")
        if self.headers.get_content_type() != "application/json":
            raise ValueError("Use application/json.")
        length = int(self.headers.get("Content-Length", "0"))
        if length <= 0 or length > 512000:
            raise ValueError("JSON request size is invalid.")
        data = json.loads(self.rfile.read(length), parse_constant=lambda value: (_ for _ in ()).throw(ValueError("Invalid JSON number")))
        if not isinstance(data, dict):
            raise ValueError("A JSON object is required.")
        return data

    def local_request(self):
        # A loopback bind alone does not prevent DNS rebinding. Do not accept
        # arbitrary Host names, even when Origin happens to match that Host.
        port = self.server.server_address[1]
        permitted = {f"localhost:{port}", f"127.0.0.1:{port}"}
        host = self.headers.get("Host", "").lower()
        origin = self.headers.get("Origin")
        if host not in permitted or (origin and origin != f"http://{host}") or self.headers.get("Sec-Fetch-Site") == "cross-site":
            self.json_response(403, {"error": "Only local same-origin requests are accepted."})
            return False
        return True

    def do_HEAD(self):
        if self.local_request():
            super().do_HEAD()

    def do_GET(self):
        if not self.local_request(): return
        url = urlsplit(self.path)
        if url.path == "/health":
            self.json_response(200, {"app": "FocusLens", "version": 7, "smtpConfigured": self.server.state.mail_config.configured})
            return
        if url.path == "/sessions/active":
            with self.server.state.lock:
                current = self.server.state.active_session()
                result = dict(current) if current else {"profileId": None, "active": False, "monitorEnabled": False}
            self.json_response(200, result); return
        if url.path == "/active-window-status":
            try:
                owner = profile_id(parse_qs(url.query).get("profileId", [None])[0])
                with self.server.state.lock:
                    current = self.server.state.active_session()
                    row = self.server.state.windows.get(owner)
                    result = dict(row) if row and current and current["profileId"] == owner and row["sessionId"] == current["sessionId"] else {"profileId": owner, "available": False}
                self.json_response(200, result)
            except ValueError as error:
                self.json_response(400, {"error": str(error)})
            return
        if url.path.startswith("/reports/"):
            try:
                owner = profile_id(parse_qs(url.query).get("profileId", [None])[0])
            except ValueError as error:
                self.json_response(400, {"error": str(error)}); return
            with self.server.state.lock:
                job = self.server.state.reports.get(url.path.rsplit("/", 1)[-1])
                result = dict(job) if job and job["profileId"] == owner else None
            self.json_response(200 if result else 404, result or {"error": "Report not found."})
            return
        super().do_GET()

    def send_head(self):
        # Configuration and executable sources must never be served as static
        # files. Resolve symlinks and deny every dot path, including .env/.git.
        path = urlsplit(self.path).path
        parts = Path(unquote(path)).parts
        resolved = (self.server.directory / unquote(path).lstrip("/")).resolve()
        if any(part.startswith(".") for part in parts if part not in ("/", "")) or not resolved.is_relative_to(self.server.directory) or resolved.suffix in (".py", ".command"):
            self.json_response(404, {"error": "Not found."}); return None
        return super().send_head()

    def list_directory(self, path):
        self.json_response(404, {"error": "Directory listing is disabled."})
        return None

    def do_POST(self):
        if not self.local_request(): return
        route = urlsplit(self.path).path
        if route not in ("/send-report", "/sessions", "/active-window-status"):
            self.json_response(404, {"error": "Unknown API route."}); return
        try:
            data = self.json_body()
            owner = profile_id(data.get("profileId"))
            if route == "/sessions":
                self.json_response(201, self.server.state.update_session(data)); return
            if route == "/active-window-status":
                name, title = data.get("appName"), data.get("windowTitle")
                if not isinstance(name, str) or not name.strip() or len(name) > 200 or title != "" or type(data.get("isOnTask")) is not bool:
                    raise ValueError("This monitor accepts an appName, an empty windowTitle, and a boolean isOnTask only.")
                with self.server.state.lock:
                    current = self.server.state.active_session()
                    if not current or current["profileId"] != owner or current["sessionId"] != data.get("sessionId"):
                        self.json_response(409, {"profileId": owner, "error": "No matching active monitored session."}); return
                    revision = data.get("sessionRevision")
                    if type(revision) is not int or not current["evidenceRevision"] <= revision <= current["revision"]:
                        self.json_response(409, {"profileId": owner, "error": "App reading predates the current active segment."}); return
                    row = {"profileId": owner, "sessionId": current["sessionId"], "appName": name.strip(), "windowTitle": "",
                           "isOnTask": is_on_task(name, current["allowedApps"]), "observedAt": time.time() * 1000, "available": True}
                    self.server.state.windows[owner] = row
                self.json_response(200, row); return
            summary = validate_summary(data.get("sessionSummary"))
            addresses = recipients(data.get("recipientEmails"))
            if not self.server.state.mail_config.configured:
                self.json_response(503, {"profileId": owner, "error": "Email is not configured. Add SMTP credentials to .env and restart FocusLens."}); return
            job = self.server.state.queue_report(owner, summary, addresses)
            self.json_response(202, job)
        except (ValueError, TypeError, json.JSONDecodeError) as error:
            self.json_response(400, {"error": str(error)})

    def do_PUT(self):
        if not self.local_request(): return
        route = urlsplit(self.path).path
        if not re.fullmatch(r"/sessions/[A-Za-z0-9_-]{1,100}", route):
            self.json_response(404, {"error": "Unknown API route."}); return
        try:
            self.json_response(200, self.server.state.update_session(self.json_body(), route.rsplit("/", 1)[-1]))
        except (ValueError, TypeError) as error:
            self.json_response(400, {"error": str(error)})


def main():
    parser = argparse.ArgumentParser(description="FocusLens local server")
    parser.add_argument("--port", type=int, default=8000)
    args = parser.parse_args()
    server = FocusLensServer(("127.0.0.1", args.port))
    print(f"FocusLens: http://localhost:{args.port} (loopback only)", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
