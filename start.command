#!/bin/bash
# Finder starts this script in an arbitrary directory; anchor everything here.
cd "$(dirname "$0")" || exit 1
if ! command -v python3 >/dev/null 2>&1; then
  echo "FocusLens needs Python 3. Install Python 3, then open start.command again."
  read -r -p "Press Return to close. "
  exit 1
fi
exec python3 launcher.py "$@"
