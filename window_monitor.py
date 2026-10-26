#!/usr/bin/env python3
"""macOS companion. Only polls while a browser session explicitly enables it."""
import argparse
import json
import subprocess
import sys
import time
import urllib.error
import urllib.request

from window_rules import is_on_task

SCRIPT = 'tell application "System Events" to get name of first application process whose frontmost is true'


def active_app(run=subprocess.run):
    result = run(["osascript", "-e", SCRIPT], capture_output=True, text=True, timeout=2, check=True)
    name = result.stdout.strip()
    if not name or len(name) > 200:
        raise ValueError("No usable frontmost app name.")
    return name


def request_json(url, data=None):
    body = json.dumps(data).encode() if data is not None else None
    request = urllib.request.Request(url, data=body, headers={"Content-Type": "application/json"} if body else {})
    with urllib.request.urlopen(request, timeout=2) as response:
        return json.load(response)


def monitor_once(base_url, request=request_json, reader=active_app):
    config = request(base_url + "/sessions/active")
    if not config.get("active") or not config.get("monitorEnabled"):
        return False
    name = reader()
    request(base_url + "/active-window-status", {
        "profileId": config["profileId"], "sessionId": config["sessionId"], "sessionRevision": config["revision"],
        "appName": name, "windowTitle": "", "isOnTask": is_on_task(name, config["allowedApps"]),
    })
    return True


def main():
    parser = argparse.ArgumentParser(description="FocusLens macOS app-name monitor")
    parser.add_argument("--port", type=int, default=8000)
    args = parser.parse_args()
    if sys.platform != "darwin":
        print("App monitoring is available on macOS only. Cameras still work.", file=sys.stderr)
        return 0
    base = f"http://127.0.0.1:{args.port}"
    last_error = False
    try:
        while True:
            try:
                monitor_once(base)
                last_error = False
            except (OSError, ValueError, KeyError, subprocess.SubprocessError, urllib.error.URLError):
                if not last_error:
                    print("App monitoring unavailable. Check the local server and macOS Automation permission for System Events. Camera tracking is unaffected.", file=sys.stderr, flush=True)
                last_error = True
            time.sleep(2.5)
    except KeyboardInterrupt:
        return 0


if __name__ == "__main__":
    raise SystemExit(main())
