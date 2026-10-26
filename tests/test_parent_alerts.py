import tempfile
import time
import unittest
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import patch

from flask_migrate import upgrade
import requests

from backend import create_app
from backend.expo_push import ProviderError, EXPO_BASE
from backend.models import db, ExpoPushToken, FamilyLink, ParentAlert, StudySession
from backend.parent_alerts import ParentAlerts


class ParentAlertTests(unittest.TestCase):
    def setUp(self):
        self.folder = tempfile.TemporaryDirectory(); self.sent = []
        self.app = create_app(dict(TESTING=True, JWT_SECRET_KEY='parent-alert-tests-' * 4, BCRYPT_ROUNDS=4, AUTH_RATE_LIMIT=1000,
            SQLALCHEMY_DATABASE_URI='sqlite:///' + str(Path(self.folder.name) / 'test.db'),
            EXPO_ALERT_SENDER=lambda token, alert: self.sent.append((token, alert)) or 'synthetic-ticket-1234'))
        self.context = self.app.app_context(); self.context.push(); upgrade(); self.client = self.app.test_client()
        self.users = {}
        for name, role in [('student', 'student'), ('other', 'student'), ('parent', 'parent'), ('unlinked', 'parent')]:
            self.users[name] = self.client.post('/auth/signup', json=dict(email=name+'@example.test', password='Test password 123', displayName=name, role=role)).get_json()
        self.start = int(time.time() * 1000) - 601000; self.sid = str(uuid.uuid4())
        self.call('POST', '/sessions', dict(clientSessionId=self.sid, startTime=self.start, goalMinutes=25, goalEngagementPct=80, phonePolicy='phone-free'))
        self.body = dict(sessionId=self.sid, eventStartMs=self.start, distractionDurationMs=600000)
        self.service = self.app.extensions['parent_alerts']

    def tearDown(self):
        db.session.remove(); db.engine.dispose(); self.context.pop(); self.folder.cleanup()

    def call(self, method, path, body=None, user='student'):
        return self.client.open(path, method=method, json=body, headers={'Authorization':'Bearer '+self.users[user]['token']} if user else {})

    def phone(self, user='parent', suffix='parent'):
        return self.call('POST', '/push-tokens', dict(token=f'ExpoPushToken[synthetic-{suffix}-token]', platform='ios'), user).get_json()['registrationId']

    def link(self):
        self.call('POST', '/family-link', {'studentEmail':'student@example.test'}, 'parent')

    def queue(self, body=None):
        with patch.object(self.service, 'queue') as enqueue:
            result = self.call('POST', '/notify-parent', body or self.body)
            self.enqueued = enqueue.call_count
            return result

    def work(self, result):
        aid = result.get_json()['alertId']; self.service.work(aid); db.session.expire_all()
        return self.call('GET', '/parent-alerts/'+aid).get_json()

    def test_identity_live_session_and_timing_are_enforced(self):
        self.assertEqual(self.call('POST', '/notify-parent', self.body, None).status_code, 401)
        self.assertEqual(self.call('POST', '/notify-parent', self.body, 'parent').status_code, 403)
        self.assertEqual(self.call('POST', '/notify-parent', self.body, 'other').status_code, 404)
        for extra in [dict(userId='other'), dict(parentUserId='parent'), dict(message='private')]:
            self.assertEqual(self.queue({**self.body, **extra}).status_code, 400)
        for changes in [dict(distractionDurationMs=599999), dict(distractionDurationMs=True), dict(eventStartMs=self.start-1),
                        dict(eventStartMs=int(time.time()*1000)+10000), dict(distractionDurationMs=800000)]:
            self.assertEqual(self.queue({**self.body, **changes}).status_code, 400)
        row = db.session.get(StudySession, self.sid); row.end_time = self.start + 601000; db.session.commit()
        self.assertEqual(self.queue().status_code, 409)
        self.assertEqual(len(self.sent), 0); self.assertEqual(db.session.query(ParentAlert).count(), 0)

    def test_linked_phones_only_and_durable_once_per_event(self):
        self.link(); self.phone(); self.phone('unlinked', 'unlinked'); self.phone('student', 'student')
        result = self.queue(); self.assertEqual(result.status_code, 202); self.assertEqual(self.enqueued, 1)
        status = self.work(result); self.assertEqual(status['status'], 'accepted'); self.assertEqual(status['acceptedCount'], 1)
        self.assertEqual(len(self.sent), 1); self.assertIn('synthetic-parent-token', self.sent[0][0])
        aid = status['alertId']
        self.assertEqual(self.call('GET', '/parent-alerts/'+aid, user='parent').status_code, 404)
        self.assertEqual(self.call('GET', '/parent-alerts/'+aid, user='other').status_code, 404)
        self.app.extensions['parent_alerts'] = ParentAlerts(self.app)
        with patch.object(self.app.extensions['parent_alerts'], 'queue') as send:
            duplicate = self.call('POST', '/notify-parent', self.body)
            self.assertEqual(duplicate.status_code, 200); send.assert_not_called()
        self.assertEqual(duplicate.get_json(), status); self.assertNotIn('token', str(status))
        self.assertEqual(self.queue({**self.body, 'eventStartMs':self.start+1}).status_code, 429)

    def test_disconnect_unlink_no_recipients_and_expired_device_cleanup(self):
        self.link(); rid = self.phone()
        result = self.queue()
        db.session.delete(db.session.get(ExpoPushToken, rid)); db.session.commit()
        self.assertEqual(self.work(result)['status'], 'noRecipients'); self.assertEqual(self.sent, [])
        row = db.session.get(ParentAlert, result.get_json()['alertId']); row.created_at = datetime.now(timezone.utc)-timedelta(minutes=11); db.session.commit()
        rid = self.phone(); newer = self.queue({**self.body, 'eventStartMs':self.start+1})
        db.session.query(FamilyLink).delete(); db.session.commit()
        self.assertEqual(self.work(newer)['status'], 'noRecipients'); self.assertEqual(self.sent, [])
        row = db.session.get(ParentAlert, newer.get_json()['alertId']); row.created_at = datetime.now(timezone.utc)-timedelta(minutes=11); db.session.commit()
        self.link()
        def expired(*_): raise ProviderError('DeviceNotRegistered')
        self.app.config['EXPO_ALERT_SENDER'] = expired
        failed = self.queue({**self.body, 'eventStartMs':self.start+2})
        self.assertEqual(self.work(failed)['status'], 'failed'); self.assertIsNone(db.session.get(ExpoPushToken, rid))

    def test_partial_timeout_and_restart_never_resend(self):
        self.link(); self.phone(); self.phone(suffix='second')
        def sender(token, aid):
            self.sent.append((token, aid))
            if 'second' in token: raise TimeoutError('possibly sent')
            return 'synthetic-ticket-1234'
        self.app.config['EXPO_ALERT_SENDER'] = sender
        result = self.queue(); status = self.work(result)
        self.assertEqual((status['status'], status['acceptedCount'], status['failedCount']), ('partial', 1, 1))
        self.assertEqual(self.queue().status_code, 200); self.assertEqual(self.enqueued, 0); self.assertEqual(len(self.sent), 2)
        row = db.session.get(ParentAlert, status['alertId']); row.status = 'sending'; row.created_at = datetime.now(timezone.utc)-timedelta(minutes=11); db.session.commit()
        self.assertEqual(self.call('GET', '/parent-alerts/'+row.id).get_json()['status'], 'interrupted')

    def test_real_transport_has_generic_fixed_content_and_no_private_data(self):
        provider = self.app.extensions['expo_push']; response = requests.Response(); response.status_code = 200
        response._content = b'{"data":{"status":"ok","id":"synthetic-ticket-1234"}}'
        with patch('backend.expo_push.requests.post', return_value=response) as send:
            provider.deliver_alert('ExpoPushToken[synthetic-parent-token]', 'private-alert-id')
        self.assertEqual(send.call_args.args, (EXPO_BASE+'send',)); self.assertFalse(send.call_args.kwargs['allow_redirects'])
        body = send.call_args.kwargs['json']; self.assertEqual(body['data'], {'kind':'study-check-in'})
        for private in [self.sid, 'private-alert-id', '@', '600000', 'events', 'engagement']:
            self.assertNotIn(private, str(body))


if __name__ == '__main__': unittest.main()
