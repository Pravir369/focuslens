import json
import shutil
import socket
import struct
import subprocess
import sys
import tempfile
import threading
import time
import unittest
from pathlib import Path
from unittest.mock import patch

import launcher
from server import AppState, FocusLensServer

ROOT = Path(__file__).resolve().parent.parent


def free_port():
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


class LauncherTests(unittest.TestCase):
    def test_double_click_entrypoint_from_another_directory_and_cleanup(self):
        with tempfile.TemporaryDirectory(prefix="FocusLens launch with spaces ") as directory:
            root = Path(directory)
            for name in ("launcher.py", "start.command", "server.py", "email_reports.py", "window_rules.py"):
                shutil.copy2(ROOT / name, root / name)
            port = free_port()
            command = [str(root / "start.command"), "--port", str(port), "--no-browser", "--no-monitor"]
            process = subprocess.Popen(command, cwd="/", stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
            try:
                for _ in range(80):
                    if launcher.healthy(port): break
                    if process.poll() is not None: self.fail(process.stdout.read())
                    time.sleep(.05)
                else: self.fail("Launcher never became ready")
                duplicate = subprocess.run(command, cwd="/", capture_output=True, text=True, timeout=10)
                self.assertEqual(duplicate.returncode, 0)
                self.assertIn("already running", duplicate.stdout)
                self.assertTrue(launcher.healthy(port))
            finally:
                process.terminate()
                output, _ = process.communicate(timeout=8)
            self.assertEqual(process.returncode, 0, output)
            self.assertFalse(launcher.healthy(port), "Launcher left its server running")
            self.assertEqual((root / f".focuslens-{port}.pid").read_text(), "")

    def test_existing_server_is_not_terminated_and_owned_monitor_is_cleaned_up(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory); (root / "window_monitor.py").touch()
            server = FocusLensServer(("127.0.0.1", 0), AppState(), root)
            thread = threading.Thread(target=server.serve_forever, daemon=True); thread.start()
            event = threading.Event(); event.set()
            child = unittest.mock.Mock(); child.poll.return_value = None
            try:
                with patch.object(launcher.sys, "platform", "darwin"), patch.object(launcher.subprocess, "Popen", return_value=child) as popen, patch.object(launcher.os, "killpg") as killpg:
                    self.assertEqual(launcher.run(server.server_address[1], False, True, root, event), 0)
                self.assertEqual(popen.call_count, 1)
                self.assertIn("window_monitor.py", popen.call_args.args[0][1])
                killpg.assert_called_once_with(child.pid, launcher.signal.SIGTERM); child.wait.assert_called_once()
                self.assertTrue(launcher.healthy(server.server_address[1]))
            finally:
                server.shutdown(); server.server_close(); thread.join()

    def test_unrelated_server_is_not_reused_or_killed(self):
        from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
        class QuietHandler(SimpleHTTPRequestHandler):
            def log_message(self, *args): pass
        server = ThreadingHTTPServer(("127.0.0.1", 0), QuietHandler)
        thread = threading.Thread(target=server.serve_forever, daemon=True); thread.start()
        try:
            result = subprocess.run([sys.executable, str(ROOT / "launcher.py"), "--port", str(server.server_address[1]), "--no-browser", "--no-monitor"], capture_output=True, text=True, timeout=10)
            self.assertEqual(result.returncode, 1)
            self.assertIn("Close the other server", result.stdout)
            with socket.create_connection(server.server_address, timeout=2): pass
        finally:
            server.shutdown(); server.server_close(); thread.join()

    def test_manifest_has_standalone_launch_and_correct_icon_dimensions(self):
        manifest = json.loads((ROOT / "manifest.json").read_text())
        self.assertEqual(manifest["display"], "standalone")
        self.assertEqual(manifest["start_url"], "/")
        for icon in manifest["icons"]:
            raw = (ROOT / icon["src"]).read_bytes()
            self.assertEqual(raw[:8], b"\x89PNG\r\n\x1a\n")
            self.assertEqual(struct.unpack("!II", raw[16:24]), tuple(int(n) for n in icon["sizes"].split("x")))


if __name__ == "__main__": unittest.main()
