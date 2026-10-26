#!/usr/bin/env python3
"""Run the local Phase 2 checkpoint separately from the existing study app."""
import argparse
from backend import create_app


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="FocusLens local accounts server")
    parser.add_argument("--port", type=int, default=8001)
    args = parser.parse_args()
    app = create_app()
    app.config["PUBLIC_ORIGIN"] = f"http://localhost:{args.port}"
    app.run(host="127.0.0.1", port=args.port, debug=False, use_reloader=False)
