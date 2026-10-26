#!/usr/bin/env python3
"""Paired macOS helper: a memory-only, monitor-scoped token, never a profile ID."""
import argparse
import getpass
import json
import subprocess
import sys
import time
import urllib.error
import urllib.request
from urllib.parse import urlsplit

from window_monitor import active_app


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self,*args,**kwargs):
        raise urllib.error.URLError('Redirects are not allowed for paired monitor credentials.')


def base_url(value):
    parsed=urlsplit(value)
    if parsed.username or parsed.password or parsed.query or parsed.fragment or parsed.path not in ('','/') or not parsed.hostname:
        raise ValueError('Use the FocusLens service address without a path or credentials.')
    if parsed.scheme!='https' and not (parsed.scheme=='http' and parsed.hostname in ('localhost','127.0.0.1')):
        raise ValueError('Hosted monitoring requires HTTPS. HTTP is allowed only on localhost.')
    return value.rstrip('/')


def request_json(url,data=None,token=None):
    headers={'Content-Type':'application/json'}
    if token: headers['Authorization']='Bearer '+token
    body=json.dumps(data).encode() if data is not None else None
    request=urllib.request.Request(url,data=body,headers=headers)
    with urllib.request.build_opener(NoRedirect()).open(request,timeout=5) as response:
        return json.load(response)


def monitor_once(base,token,request=request_json,reader=active_app):
    config=request(base+'/monitor/config',token=token)
    if not config.get('active') or not config.get('monitorEnabled'): return False
    name=reader()
    request(base+'/active-window-status',data=dict(sessionId=config['sessionId'],sessionRevision=config['revision'],appName=name,
        windowTitle='',observedAt=config['serverNow']),token=token)
    return True


def main():
    parser=argparse.ArgumentParser(description='FocusLens paired macOS app-name monitor')
    parser.add_argument('--account-server',default='https://focuslens-accounts.onrender.com')
    args=parser.parse_args()
    if sys.platform!='darwin': print('This helper is for macOS. Camera tracking still works without it.');return 0
    try:
        base=base_url(args.account_server)
        code=getpass.getpass('Enter the two-minute pairing code from your FocusLens account (hidden): ').strip()
        data=request_json(base+'/monitor/claim',{'pairCode':code});token=data['token'];code=''
    except (OSError,ValueError,KeyError,urllib.error.URLError):
        print('Pairing failed. Generate a new code in your FocusLens account and try again.');return 1
    print('Paired for up to four hours. Only app names are read, and only during an enabled active session. Press Ctrl+C to stop.')
    last_error=False
    try:
        while True:
            try: monitor_once(base,token);last_error=False
            except urllib.error.HTTPError as error:
                if error.code==401: print('Pairing expired or was revoked. Generate a new pairing code to reconnect.');return 0
                if not last_error: print('No fresh monitored session. Camera tracking is unaffected.')
                last_error=True
            except (OSError,ValueError,KeyError,subprocess.SubprocessError,urllib.error.URLError):
                if not last_error: print('App monitoring is unavailable. Check your connection and macOS Automation permission. Camera tracking is unaffected.')
                last_error=True
            time.sleep(2.5)
    except KeyboardInterrupt: return 0


if __name__=='__main__': raise SystemExit(main())
