import http.client
import json
import smtplib
import tempfile
import threading
import time
import unittest
from pathlib import Path

from email_reports import MailConfig, ReportDeliveryError, recipients, report_content, send_report
from server import AppState, FocusLensServer


SUMMARY = {"title": "FocusLens session report", "completedAt": "2026-10-25T12:00:00Z", "headlineStats": {
    "recovery": "No recoveries recorded", "engagement": "80% engaged", "distractions": "1 moment", "longest": "5 seconds"},
    "goalFeedback": "You hit your goal.", "patternTip": "A <script>fake</script> tip", "timeline": [{"state": "distracted · Camera B", "start": "0 s", "end": "5 s", "duration": "5 s"}]}
CONFIG = MailConfig(username="sender@example.com", password="not-a-real-password", sender="sender@example.com")


class ServerTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        root = Path(self.directory.name)
        (root / "index.html").write_text("FocusLens test")
        (root / ".env").write_text("FAKE_TEST_SECRET=not-real")
        self.sent = []
        self.state = AppState(CONFIG, lambda config, summary, addresses: self.sent.append((summary, addresses)) or len(addresses))
        self.server = FocusLensServer(("127.0.0.1", 0), self.state, root)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True); self.thread.start()

    def tearDown(self):
        self.server.shutdown(); self.server.server_close(); self.thread.join(); self.directory.cleanup()

    def request(self, method, path, body=None, headers=None):
        connection = http.client.HTTPConnection(*self.server.server_address, timeout=3)
        encoded = json.dumps(body).encode() if body is not None else None
        connection.request(method, path, encoded, headers or ({"Content-Type": "application/json"} if body is not None else {}))
        response = connection.getresponse(); raw = response.read(); status = response.status
        connection.close()
        return status, json.loads(raw) if raw and response.headers.get_content_type() == "application/json" else raw

    def test_static_health_and_private_configuration(self):
        self.assertEqual(self.request("GET", "/")[0], 200)
        self.assertEqual(self.request("GET", "/health")[1]["app"], "FocusLens")
        for path in ["/.env", "/%2eenv", "/.git/config"]:
            self.assertEqual(self.request("GET", path)[0], 404)
            self.assertEqual(self.request("HEAD", path)[0], 404)

    def test_reports_are_opt_in_async_and_profile_scoped(self):
        self.assertEqual(self.sent, [])
        status, job = self.request("POST", "/send-report", {"profileId": "one", "sessionSummary": SUMMARY, "recipientEmails": ["student@example.com", "other@example.com"]})
        self.assertEqual(status, 202); self.assertEqual(job["profileId"], "one")
        for _ in range(30):
            _, result = self.request("GET", f"/reports/{job['reportId']}?profileId=one")
            if result["status"] != "sending": break
            time.sleep(.01)
        self.assertEqual(result["status"], "sent"); self.assertEqual(result["sentCount"], 2)
        self.assertEqual(self.request("GET", f"/reports/{job['reportId']}?profileId=other")[0], 404)
        self.assertNotIn("recipientEmails", result); self.assertNotIn("sessionSummary", result)

    def test_invalid_payloads_and_missing_configuration_fail_cleanly(self):
        payload = {"profileId": "one", "sessionSummary": SUMMARY, "recipientEmails": ["student@example.com"]}
        for change in [{"profileId": ""}, {"recipientEmails": ["a@b.com\r\nBcc: bad@b.com"]}, {"sessionSummary": {}}]:
            self.assertEqual(self.request("POST", "/send-report", {**payload, **change})[0], 400)
        self.assertEqual(self.request("POST", "/send-report", payload, {"Content-Type": "text/plain"})[0], 400)
        self.assertEqual(self.request("POST", "/send-report", payload, {"Content-Type": "application/json", "Origin": "https://example.invalid"})[0], 403)
        self.state.mail_config = MailConfig()
        self.assertEqual(self.request("POST", "/send-report", payload)[0], 503)

    def test_smtp_failure_is_reported_without_stopping_server(self):
        def fail(*args): raise ReportDeliveryError("Delivery failed")
        self.state.sender = fail
        _, job = self.request("POST", "/send-report", {"profileId": "one", "sessionSummary": SUMMARY, "recipientEmails": ["student@example.com"]})
        for _ in range(30):
            _, result = self.request("GET", f"/reports/{job['reportId']}?profileId=one")
            if result["status"] != "sending": break
            time.sleep(.01)
        self.assertEqual(result["status"], "failed"); self.assertEqual(self.request("GET", "/health")[0], 200)

    def test_external_host_and_cross_site_requests_cannot_access_local_api(self):
        for method, path in [("GET", "/sessions/active"), ("HEAD", "/"), ("POST", "/sessions"), ("PUT", "/sessions/s")]:
            self.assertEqual(self.request(method, path, headers={"Host": "attacker.invalid", "Origin": "http://attacker.invalid"})[0], 403)
        self.assertEqual(self.request("GET", "/health", headers={"Sec-Fetch-Site": "cross-site"})[0], 403)

    def test_window_status_is_latest_profile_scoped_app_only_and_cleared_on_pause(self):
        session = {"profileId": "one", "sessionId": "s", "revision": 1, "active": True, "monitorEnabled": True, "allowedApps": ["Notion"]}
        self.assertEqual(self.request("POST", "/sessions", session)[0], 201)
        payload = {"profileId": "one", "sessionId": "s", "sessionRevision": 1, "appName": "Steam", "windowTitle": "", "isOnTask": True}
        status, row = self.request("POST", "/active-window-status", payload)
        self.assertEqual(status, 200); self.assertFalse(row["isOnTask"])
        self.assertEqual(self.request("GET", "/active-window-status?profileId=other")[1]["available"], False)
        self.assertEqual(self.request("POST", "/active-window-status", {**payload, "windowTitle": "Not allowed"})[0], 400)
        self.request("PUT", "/sessions/s", {**session, "revision": 2, "active": False})
        self.assertFalse(self.request("GET", "/active-window-status?profileId=one")[1]["available"])
        self.request("PUT", "/sessions/s", {**session, "revision": 3})
        self.assertEqual(self.request("POST", "/active-window-status", payload)[0], 409)
        self.assertEqual(self.request("POST", "/active-window-status", {**payload, "sessionRevision": 3})[0], 200)


class EmailTests(unittest.TestCase):
    def test_content_escaped_and_recipients_validated(self):
        text, markup = report_content(SUMMARY)
        self.assertIn("Camera B", text); self.assertIn("&lt;script&gt;", markup); self.assertNotIn("<script>", markup)
        self.assertEqual(recipients(["a@example.com", "a@example.com"]), ["a@example.com"])
        with self.assertRaises(ValueError): recipients(["a@example.com\nBcc:x@example.com"])

    def test_fake_smtp_uses_tls_and_separate_recipient_messages(self):
        messages = []
        class FakeSMTP:
            def __init__(self, host, port, **kwargs): self.kwargs = kwargs; assert "context" in kwargs
            def __enter__(self): return self
            def __exit__(self, *args): pass
            def login(self, username, password): assert password == "not-a-real-password"
            def send_message(self, message): messages.append(message); return {}
        self.assertEqual(send_report(CONFIG, SUMMARY, ["a@example.com", "b@example.com"], FakeSMTP), 2)
        self.assertEqual([str(message["To"]) for message in messages], ["a@example.com", "b@example.com"])
        self.assertNotIn("b@example.com", str(messages[0]))

    def test_partial_delivery_does_not_claim_every_recipient_received_it(self):
        class FakeSMTP:
            def __init__(self, *args, **kwargs): self.count = 0
            def __enter__(self): return self
            def __exit__(self, *args): pass
            def login(self, *args): pass
            def send_message(self, message):
                self.count += 1
                if self.count == 2: raise smtplib.SMTPRecipientsRefused({})
                return {}
        with self.assertRaises(ReportDeliveryError) as result:
            send_report(CONFIG, SUMMARY, ["a@example.com", "b@example.com"], FakeSMTP)
        self.assertEqual(result.exception.sent_count, 1)


if __name__ == "__main__": unittest.main()
