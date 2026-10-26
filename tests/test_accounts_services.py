import unittest
from types import SimpleNamespace
from unittest.mock import patch

from backend.services import Services
from email_reports import ReportDeliveryError
from account_monitor import base_url, monitor_once

SUMMARY=dict(title='FocusLens session report',completedAt='2026-10-25',headlineStats=dict(recovery='No recoveries recorded',engagement='No classified time',distractions='One distraction',longest='3 seconds'),goalFeedback='No classified time',patternTip='Phone-related',timeline=[])

class ServiceTests(unittest.TestCase):
    def test_brevo_uses_https_and_separate_messages_without_logging_provider_errors(self):
        service=Services({'REPORT_TRANSPORT':'brevo','BREVO_API_KEY':'test-only-key','REPORT_FROM_EMAIL':'sender@example.test'})
        self.assertTrue(service.configured)
        with patch('requests.post',return_value=SimpleNamespace(status_code=201)) as post:
            self.assertEqual(service.deliver(SUMMARY,['one@example.test','two@example.test']),2)
            self.assertEqual(post.call_count,2)
            args=post.call_args;self.assertEqual(args.args[0],'https://api.brevo.com/v3/smtp/email')
            self.assertFalse(args.kwargs['allow_redirects']);self.assertEqual(args.kwargs['timeout'],20)
            self.assertEqual(args.kwargs['json']['to'],[{'email':'two@example.test'}]);self.assertNotIn('test-only-key',str(args.kwargs['json']))
        with patch('requests.post',side_effect=[SimpleNamespace(status_code=201),SimpleNamespace(status_code=400)]):
            with self.assertRaises(ReportDeliveryError) as raised:service.deliver(SUMMARY,['one@example.test','two@example.test'])
            self.assertEqual(raised.exception.sent_count,1);self.assertNotIn('test-only-key',str(raised.exception))
    def test_account_companion_sends_only_app_name_and_scoped_bearer_and_reads_nothing_while_idle(self):
        calls=[];reads=[]
        def request(url,data=None,token=None):
            calls.append((url,data,token));return dict(active=True,monitorEnabled=True,sessionId='session',revision=3,serverNow=123456)
        self.assertTrue(monitor_once('https://focuslens.example','test-monitor-token',request,lambda:reads.append(True) or 'Preview'))
        self.assertEqual(calls[-1][1],dict(sessionId='session',sessionRevision=3,appName='Preview',windowTitle='',observedAt=123456))
        self.assertNotIn('profileId',calls[-1][1]);self.assertNotIn('userId',calls[-1][1]);self.assertEqual(calls[-1][2],'test-monitor-token')
        self.assertFalse(monitor_once('https://focuslens.example','test-monitor-token',lambda *a,**k:dict(active=False),lambda:reads.append(False)))
        self.assertEqual(reads,[True])
        for value in ['http://public.example','https://user:password@example.test','https://example.test/?token=x']:
            with self.assertRaises(ValueError):base_url(value)
        self.assertEqual(base_url('http://localhost:8001/'),'http://localhost:8001')

if __name__=='__main__':unittest.main()
