#!/usr/bin/env python3
"""Generate a VAPID key once in ignored .env; never print private credentials."""
import argparse
import base64
import os
from pathlib import Path
from cryptography.hazmat.primitives.asymmetric import ec
from email_reports import local_environment


def configure(path, subject):
    if not subject.startswith('mailto:') or '\n' in subject or '\r' in subject: raise ValueError('Use a mailto: contact address for Web Push.')
    existing = local_environment(path)
    if existing.get('WEB_PUSH_PRIVATE_KEY'): return False
    key = ec.generate_private_key(ec.SECP256R1())
    private = base64.urlsafe_b64encode(key.private_numbers().private_value.to_bytes(32, 'big')).decode().rstrip('=')
    source = path.read_text() if path.exists() else ''
    lines = [line for line in source.splitlines() if not line.startswith(('WEB_PUSH_PRIVATE_KEY=', 'WEB_PUSH_SUBJECT='))]
    lines.extend(['', '# Home Screen companion push credentials. Keep this file private.', f'WEB_PUSH_PRIVATE_KEY={private}', f'WEB_PUSH_SUBJECT={subject}'])
    flags = os.O_WRONLY | os.O_CREAT | os.O_TRUNC
    descriptor = os.open(path, flags, 0o600)
    with os.fdopen(descriptor, 'w') as output: output.write('\n'.join(lines) + '\n')
    os.chmod(path, 0o600)
    return True


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__); parser.add_argument('--subject', required=True, help='mailto:your-app-contact@example.com')
    args = parser.parse_args()
    added = configure(Path(__file__).resolve().parent / '.env', args.subject)
    print('Web Push credentials saved privately in .env.' if added else 'Existing Web Push credentials kept. No key was replaced.')
