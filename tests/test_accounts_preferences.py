import copy
import tempfile
import time
import unittest
import uuid
from pathlib import Path

from flask_migrate import upgrade
from backend import create_app
from backend.models import db
from email_reports import MailConfig


class PreferenceTests(unittest.TestCase):
    def setUp(self):
        self.folder=tempfile.TemporaryDirectory();self.sent=[]
        def sender(summary,addresses):self.sent.append(addresses);return len(addresses)
        self.app=create_app(dict(TESTING=True,JWT_SECRET_KEY='settings-test-key-'*4,BCRYPT_ROUNDS=4,AUTH_RATE_LIMIT=1000,REPORT_SENDER=sender,
            SQLALCHEMY_DATABASE_URI='sqlite:///'+str(Path(self.folder.name)/'test.db')))
        self.context=self.app.app_context();self.context.push();upgrade();self.client=self.app.test_client()
        self.users=[self.client.post('/auth/signup',json=dict(email=name+'@example.test',password='Test password 123',displayName=name,role='student')).get_json() for name in ['one','two']]
        self.settings=dict(goalMinutes=35,goalEngagementPct=75,phonePolicy='phone-allowed',recipientEmails=[' First@gmail.com ','parent@example.test','third@gmail.com'])
    def tearDown(self):db.session.remove();db.engine.dispose();self.context.pop();self.folder.cleanup()
    def call(self,method,path,data=None,user=0):
        return self.client.open(path,method=method,json=data,headers={'Authorization':'Bearer '+self.users[user]['token']} if user is not None else {})

    def test_onboarding_persists_only_for_verified_account(self):
        self.assertEqual(self.call('GET','/preferences',user=None).status_code,401)
        self.assertFalse(self.call('GET','/preferences').get_json()['onboardingComplete'])
        self.assertEqual(self.call('GET','/preferences').get_json()['recipientEmails'],['one@example.test'])
        saved=self.call('PUT','/preferences',self.settings);self.assertEqual(saved.status_code,200)
        self.assertEqual(saved.get_json(),{**self.settings,'recipientEmails':['first@gmail.com','parent@example.test','third@gmail.com'],'onboardingComplete':True})
        self.assertEqual(self.call('GET','/preferences').get_json(),saved.get_json())
        other=self.call('GET','/preferences?userId='+self.users[0]['user']['id'],user=1).get_json()
        self.assertFalse(other['onboardingComplete']);self.assertEqual(other['recipientEmails'],['two@example.test'])
        self.assertEqual(self.call('PUT','/preferences',{**self.settings,'userId':self.users[1]['user']['id']}).status_code,400)
        # Restoring after a fresh login uses the same saved database preferences.
        login=self.client.post('/auth/login',json={'email':'one@example.test','password':'Test password 123'}).get_json()
        self.users[0]=login;self.assertEqual(self.call('GET','/preferences').get_json(),saved.get_json())

    def test_validation_is_atomic_and_recipients_can_be_removed(self):
        self.call('PUT','/preferences',self.settings);before=self.call('GET','/preferences').get_json()
        for field,value in [('recipientEmails',[]),('recipientEmails',['a@example.test']*4),('recipientEmails',['bad']),('recipientEmails',['a@gmail.com\r\nBcc: bad@example.test']),('goalMinutes',0),('goalMinutes',1441),('goalMinutes',1.5),('goalEngagementPct',101),('goalEngagementPct',True),('phonePolicy','anything')]:
            data=copy.deepcopy(self.settings);data[field]=value
            self.assertEqual(self.call('PUT','/preferences',data).status_code,400)
            self.assertEqual(self.call('GET','/preferences').get_json(),before)
        reduced={**self.settings,'recipientEmails':['new@gmail.com','NEW@gmail.com']}
        self.assertEqual(self.call('PUT','/preferences',reduced).get_json()['recipientEmails'],['new@gmail.com'])

    def test_three_saved_addresses_are_report_defaults_without_automatic_sending(self):
        self.call('PUT','/preferences',self.settings);self.assertEqual(self.sent,[])
        addresses=['first@gmail.com','parent@example.test','third@gmail.com']
        self.assertEqual(self.call('GET','/family-link').get_json()['reportDefaults'],addresses)
        sid=str(uuid.uuid4());self.call('POST','/sessions',dict(clientSessionId=sid,startTime=0,goalMinutes=1,goalEngagementPct=80,phonePolicy='phone-free'))
        self.call('PATCH','/sessions/'+sid,dict(endTime=1000,endReason='ended-early',events=[dict(type='engaged',start=0,end=1000,duration=1000)],activeSegments=[dict(start=0,end=1000,eventStartIndex=0,eventEndIndex=1)],unclassifiedPeriods=[]))
        service=self.app.extensions['account_services'];service.transport='smtp';service.mail=MailConfig(username='test',password='test',sender='test@example.test')
        result=self.call('POST','/send-report',{'sessionId':sid});self.assertEqual(result.status_code,202)
        for _ in range(100):
            job=self.call('GET','/reports/'+result.get_json()['reportId']).get_json()
            if job['status']!='sending':break
            time.sleep(.001)
        self.assertEqual(job['sentCount'],3);self.assertEqual(self.sent,[addresses])
        self.assertEqual(self.call('POST','/send-report',{'sessionId':sid,'recipientEmails':addresses+['four@example.test']}).status_code,400)
        self.assertEqual(len(self.sent),1)
