import subprocess
import unittest

from window_monitor import active_app, monitor_once
from window_rules import is_on_task
from server import AppState


class WindowTests(unittest.TestCase):
    def test_allow_list_aliases_blocklist_unknown_and_empty_list(self):
        self.assertTrue(is_on_task("Google Chrome", ["Chrome"]))
        self.assertTrue(is_on_task("notion", ["Notion"]))
        self.assertFalse(is_on_task("Steam", []))
        self.assertFalse(is_on_task("Unknown App", ["Notion"]))
        self.assertFalse(is_on_task("Google Chrome", []))

    def test_reader_uses_only_the_app_name_script_with_a_timeout(self):
        calls = []
        def fake_run(args, **kwargs):
            calls.append((args, kwargs))
            return subprocess.CompletedProcess(args, 0, "Notion\n", "")
        self.assertEqual(active_app(fake_run), "Notion")
        self.assertEqual(calls[0][0][0], "osascript")
        self.assertNotIn("window", calls[0][0][-1].lower())
        self.assertEqual(calls[0][1]["timeout"], 2)

    def test_disabled_monitor_never_reads_an_app_and_enabled_payload_has_profile_id(self):
        calls = []
        config = {"active": False}
        def request(url, data=None):
            calls.append((url, data)); return config
        def fail(): raise AssertionError("Disabled monitor must not read apps")
        self.assertFalse(monitor_once("http://127.0.0.1:8000", request, fail))
        config.update(active=True, monitorEnabled=True, profileId="one", sessionId="s", revision=1, allowedApps=["Notion"])
        self.assertTrue(monitor_once("http://127.0.0.1:8000", request, lambda: "Steam"))
        self.assertEqual(calls[-1][1], {"profileId": "one", "sessionId": "s", "sessionRevision": 1, "appName": "Steam", "windowTitle": "", "isOnTask": False})

    def test_delayed_heartbeat_cannot_reactivate_a_paused_session(self):
        state = AppState()
        base = {"profileId": "one", "sessionId": "s", "active": True, "monitorEnabled": True, "allowedApps": ["Notion"], "revision": 1}
        state.update_session(base)
        self.assertIsNotNone(state.active_session())
        state.update_session({**base, "active": False, "revision": 3})
        state.update_session({**base, "active": True, "revision": 2})
        self.assertIsNone(state.active_session())


if __name__ == "__main__": unittest.main()
