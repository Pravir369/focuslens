#!/usr/bin/env python3
"""Mac double-click launcher. Own and clean up only our child processes."""
import argparse
import fcntl
import json
import os
import signal
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent


def healthy(port):
    try:
        with urllib.request.urlopen(f"http://127.0.0.1:{port}/health", timeout=.4) as response:
            data = json.load(response)
        return data.get("app") == "FocusLens" and data.get("version") == 7
    except (OSError, ValueError, urllib.error.URLError):
        return False


def stop_child(child):
    if child is None or child.poll() is not None: return
    # Each child owns a process group, including any in-flight osascript child.
    # Closing Terminal must not leave the app-name reader running on its own.
    try: os.killpg(child.pid, signal.SIGTERM)
    except ProcessLookupError: return
    try:
        child.wait(timeout=3)
    except subprocess.TimeoutExpired:
        try: os.killpg(child.pid, signal.SIGKILL)
        except ProcessLookupError: pass
        child.wait(timeout=3)


def open_app(url):
    if sys.platform == "darwin":
        subprocess.run(["open", url], check=False)
    else:
        print(f"Open {url} in your browser.", flush=True)


def run(port=8000, browser=True, monitor=True, root=ROOT, stop_event=None):
    root = Path(root).resolve()
    stop_event = stop_event or threading.Event()
    server = script = None
    url = f"http://localhost:{port}/"
    # Keep the lock inode in place after exit; unlinking a flock file can let
    # two launchers lock different inodes. It contains a PID, never app data.
    with (root / f".focuslens-{port}.pid").open("a+") as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            for _ in range(50):
                if healthy(port):
                    if browser: open_app(url)
                    print("FocusLens is already running in another launcher window.", flush=True)
                    return 0
                if stop_event.wait(.1): return 0
            print("The other FocusLens launcher is still starting. Check its window.", flush=True)
            return 1
        lock.seek(0); lock.truncate(); lock.write(str(os.getpid())); lock.flush()
        old_handlers = {}
        if threading.current_thread() is threading.main_thread():
            for name in (signal.SIGINT, signal.SIGTERM, signal.SIGHUP):
                old_handlers[name] = signal.signal(name, lambda *_: stop_event.set())
        try:
            if not healthy(port):
                server = subprocess.Popen([sys.executable, str(root / "server.py"), "--port", str(port)], cwd=root, stdin=subprocess.DEVNULL, start_new_session=True)
                for _ in range(80):
                    if server.poll() is not None:
                        print(f"Could not start FocusLens on port {port}. Close the other server using that port and try again.", flush=True)
                        return 1
                    if healthy(port): break
                    if stop_event.wait(.1): return 0
                else:
                    print("FocusLens did not become ready. Check the server message above.", flush=True)
                    return 1
            else:
                print("Using the existing FocusLens server. This window will not stop that server.", flush=True)
            if monitor and sys.platform == "darwin" and (root / "window_monitor.py").is_file():
                script = subprocess.Popen([sys.executable, str(root / "window_monitor.py"), "--port", str(port)], cwd=root, stdin=subprocess.DEVNULL, start_new_session=True)
            if browser: open_app(url)
            print(f"FocusLens ready: {url}\nClose this Terminal window or press Ctrl+C to stop this launcher's processes.", flush=True)
            warned = False
            while not stop_event.wait(.3):
                if server and server.poll() is not None:
                    print("FocusLens server stopped. Open start.command to restart.", flush=True)
                    return 1
                if script and script.poll() is not None and not warned:
                    print("App monitoring stopped. Camera sessions can continue; check macOS permissions before restarting.", flush=True)
                    warned = True
            return 0
        finally:
            stop_child(script)
            stop_child(server)
            for name, handler in old_handlers.items(): signal.signal(name, handler)
            lock.seek(0); lock.truncate()


def main():
    parser = argparse.ArgumentParser(description="Start FocusLens locally")
    parser.add_argument("--port", type=int, default=8000)
    parser.add_argument("--no-browser", action="store_true", help="Headless development check")
    parser.add_argument("--no-monitor", action="store_true", help="Do not start the optional macOS monitor")
    args = parser.parse_args()
    return run(args.port, not args.no_browser, not args.no_monitor)


if __name__ == "__main__":
    raise SystemExit(main())
