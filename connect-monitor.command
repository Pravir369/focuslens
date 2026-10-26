#!/bin/zsh
cd "$(dirname "$0")" || exit 1
if [[ -f server.txt ]]; then
  python3 account_monitor.py --account-server "$(<server.txt)"
else
  python3 account_monitor.py
fi
printf '\nPress Return to close.\n'
read -r
