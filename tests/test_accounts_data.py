import copy
import tempfile
import time
import unittest
import uuid
from pathlib import Path

from flask_migrate import upgrade
from email_reports import MailConfig
from backend import create_app
from backend.models import db, Event, StudySession


class DataTests(unittest.TestCase):
    def setUp(self):
        self.folder=tempfile.TemporaryDirectory(); self.sent=[]
        def sender(summary,addresses): self.sent.append((summary,addresses)); return len(addresses)
        self.app=create_app(dict(TESTING=True,JWT_SECRET_KEY='test-key-'*8,BCRYPT_ROUNDS=4,AUTH_RATE_LIMIT=10000,REPORT_SENDER=sender,
            SQLALCHEMY_DATABASE_URI='sqlite:///'+str(Path(self.folder.name)/'test.db')))
        self.context=self.app.app_context(); self.context.push(); upgrade(); self.client=self.app.test_client()
        self.tokens={}
        for name,role in [('student','student'),('other','student'),('parent','parent')]:
            response=self.client.post('/auth/signup',json=dict(email=name+'@example.test',password='Test password 123',displayName=name,role=role))
            self.tokens[name]=response.get_json()['token']
        self.sid=str(uuid.uuid4())
        self.settings=dict(clientSessionId=self.sid,startTime=100000,goalMinutes=1,goalEngagementPct=80,phonePolicy='phone-free')
        self.complete=dict(endTime=106000,endReason='ended-early',events=[dict(type='distracted',start=100000,end=103000,duration=3000,triggerSource='cameraB'),dict(type='engaged',start=103000,end=106000,duration=3000)],
            activeSegments=[dict(start=100000,end=106000,eventStartIndex=0,eventEndIndex=2)],unclassifiedPeriods=[])
    def tearDown(self): db.session.remove(); db.engine.dispose(); self.context.pop(); self.folder.cleanup()
    def call(self,method,path,data=None,user='student'):
        return self.client.open(path,method=method,json=data,headers={'Authorization':'Bearer '+self.tokens[user]} if user else {})
    def create(self): return self.call('POST','/sessions',self.settings)
    def finish(self,data=None): return self.call('PATCH','/sessions/'+self.sid,data or self.complete)

    def test_session_owner_metrics_order_and_idempotent_retries(self):
        self.assertEqual(self.create().status_code,201); self.assertEqual(self.create().status_code,200)
        result=self.finish(); self.assertEqual(result.status_code,200)
        row=result.get_json(); self.assertEqual(row['engagedPct'],50); self.assertEqual(row['averageRecoveryMs'],3000)
        self.assertEqual(row['timeToFirstDistraction'],0); self.assertEqual(row['distractionCount'],1)
        self.assertEqual(self.finish().status_code,200); self.assertEqual(db.session.query(Event).count(),2)
        detail=self.call('GET','/sessions/'+self.sid).get_json()
        self.assertEqual([event['type'] for event in detail['events']],['distracted','engaged'])
        self.assertEqual(self.call('GET','/sessions').get_json()['suggestedMinutes'],5)
        changed=copy.deepcopy(self.complete); changed['events'][0]['triggerSource']='window'
        self.assertEqual(self.finish(changed).status_code,409)

    def test_missing_or_wrong_user_cannot_read_write_or_report_other_sessions(self):
        self.create(); self.finish()
        for method,path,data in [('GET','/sessions/'+self.sid,None),('PATCH','/sessions/'+self.sid,self.complete),('POST','/send-report',{'sessionId':self.sid,'recipientEmails':['me@example.test']}),('PUT','/sessions/'+self.sid+'/activity',{'revision':1,'active':True,'monitorEnabled':True,'allowedApps':[]})]:
            self.assertEqual(self.call(method,path,data,user='other').status_code,404)
            self.assertEqual(self.call(method,path,data,user=None).status_code,401)
        self.assertEqual(self.call('GET','/sessions?userId=student',user='other').get_json()['sessions'],[])
        self.assertEqual(self.call('POST','/sessions',self.settings,user='other').status_code,404)
        self.assertEqual(self.call('POST','/sessions',{**self.settings,'userId':'spoof'}).status_code,400)
        self.assertEqual(self.finish({**self.complete,'engagementPct':100}).status_code,400)

    def test_unknown_and_pause_exclusions_match_original_metrics(self):
        self.create()
        self.complete['unclassifiedPeriods']=[dict(start=101000,end=102000)]
        result=self.finish().get_json(); self.assertEqual(result['engagedPct'],60)
        self.assertIsNone(result['averageRecoveryMs']); self.assertEqual(result['longestDistractionMs'],2000)
        self.sid=str(uuid.uuid4()); self.settings['clientSessionId']=self.sid; self.create()
        data=copy.deepcopy(self.complete); data['endTime']=108000; data['events'][1].update(start=105000,end=108000)
        data['unclassifiedPeriods']=[]; data['activeSegments']=[dict(start=100000,end=103000,eventStartIndex=0,eventEndIndex=1),dict(start=105000,end=108000,eventStartIndex=1,eventEndIndex=2)]
        result=self.finish(data); self.assertEqual(result.status_code,200)
        self.assertIsNone(result.get_json()['averageRecoveryMs']); self.assertEqual(result.get_json()['activeMs'],6000)

    def test_invalid_records_never_partially_close_session(self):
        self.create()
        cases=[]
        bad=copy.deepcopy(self.complete); bad['events'][0]['duration']=42; cases.append(bad)
        bad=copy.deepcopy(self.complete); bad['events'][0]['calibration']={'yaw':5}; cases.append(bad)
        bad=copy.deepcopy(self.complete); bad['events'][1]['start']=102000; bad['events'][1]['duration']=4000; cases.append(bad)
        bad=copy.deepcopy(self.complete); bad['events'][0]['start']=100001; bad['events'][0]['duration']=2999; cases.append(bad)
        bad=copy.deepcopy(self.complete); bad['activeSegments'][0]['eventEndIndex']=1; cases.append(bad)
        bad=copy.deepcopy(self.complete); bad['unclassifiedPeriods']=[dict(start=99000,end=100000)]; cases.append(bad)
        bad=copy.deepcopy(self.complete); bad['events'][0]['type']='engaged'; cases.append(bad)
        bad=copy.deepcopy(self.complete); bad['endReason']='completed'; cases.append(bad)
        for data in cases:
            self.assertEqual(self.finish(data).status_code,400)
            self.assertIsNone(db.session.get(StudySession,self.sid).end_time); self.assertEqual(db.session.query(Event).count(),0)
        self.assertEqual(self.finish().status_code,200)

    def test_empty_and_away_endings_do_not_invent_engagement_or_recovery(self):
        self.create()
        data=dict(endTime=106000,endReason='ended-early',events=[],activeSegments=[dict(start=100000,end=106000,eventStartIndex=0,eventEndIndex=0)],unclassifiedPeriods=[dict(start=100000,end=106000)])
        result=self.finish(data).get_json();self.assertIsNone(result['engagedPct']);self.assertIsNone(result['averageRecoveryMs']);self.assertEqual(result['distractionCount'],0)
        self.sid=str(uuid.uuid4());self.settings['clientSessionId']=self.sid;self.create()
        data=copy.deepcopy(self.complete);data['events'][1]['type']='away'
        result=self.finish(data).get_json();self.assertEqual(result['engagedPct'],0);self.assertIsNone(result['averageRecoveryMs']);self.assertEqual(result['recoveryCount'],0)

    def test_family_link_roles_defaults_and_reports_derive_from_owned_events(self):
        self.assertEqual(self.call('POST','/family-link',{'studentEmail':'other@example.test'}).status_code,403)
        result=self.call('POST','/family-link',{'studentEmail':'student@example.test'},user='parent'); self.assertEqual(result.status_code,201)
        self.assertEqual(self.call('POST','/family-link',{'studentEmail':'student@example.test'},user='parent').status_code,200)
        self.assertEqual(self.call('GET','/family-link').get_json()['reportDefaults'],['student@example.test','parent@example.test'])
        self.create(); self.finish(); service=self.app.extensions['account_services']; service.mail=MailConfig(username='test',password='test',sender='test@example.test')
        response=self.call('POST','/send-report',{'sessionId':self.sid}); self.assertEqual(response.status_code,202)
        report_id=response.get_json()['reportId']
        for _ in range(100):
            result=self.call('GET','/reports/'+report_id)
            if result.get_json()['status']!='sending': break
            time.sleep(.001)
        self.assertEqual(result.get_json()['status'],'accepted'); self.assertEqual(len(self.sent),1)
        summary,addresses=self.sent[0]; self.assertEqual(addresses,['student@example.test','parent@example.test'])
        self.assertIn('3 seconds',summary['headlineStats']['recovery']); self.assertIn('phone-related',summary['patternTip'])
        self.assertEqual(self.call('GET','/reports/'+report_id,user='other').status_code,404)
        self.assertEqual(self.call('POST','/send-report',{'sessionId':self.sid,'sessionSummary':{}}).status_code,400)

    def test_paired_monitor_is_scoped_revocable_and_cannot_replay_old_segment(self):
        self.create(); state=self.app.extensions['account_services']
        pair=self.call('POST','/monitor/pair',{}).get_json()['pairCode']
        result=self.client.post('/monitor/claim',json={'pairCode':pair}); self.assertEqual(result.status_code,201)
        self.tokens['monitor']=result.get_json()['token']
        self.assertEqual(self.client.post('/monitor/claim',json={'pairCode':pair}).status_code,401)
        for route in ['/auth/me','/sessions','/family-link','/preferences']:
            self.assertEqual(self.call('GET',route,user='monitor').status_code,401)
        activity=dict(revision=1,active=True,monitorEnabled=True,allowedApps=['Preview'])
        self.assertEqual(self.call('PUT','/sessions/'+self.sid+'/activity',activity).status_code,200)
        config=self.call('GET','/monitor/config',user='monitor').get_json()
        reading=dict(sessionId=self.sid,sessionRevision=config['revision'],appName='Preview',windowTitle='',observedAt=config['serverNow'])
        self.assertEqual(self.call('POST','/active-window-status',reading,user='monitor').status_code,200)
        self.assertTrue(self.call('GET','/active-window-status?sessionId='+self.sid).get_json()['isOnTask'])
        self.assertEqual(self.call('POST','/active-window-status',reading).status_code,403)
        self.assertEqual(self.call('POST','/active-window-status',{**reading,'userId':'spoof'},user='monitor').status_code,400)
        self.call('PUT','/sessions/'+self.sid+'/activity',{**activity,'active':False,'revision':2})
        self.assertFalse(self.call('GET','/active-window-status?sessionId='+self.sid).get_json()['available'])
        self.call('PUT','/sessions/'+self.sid+'/activity',{**activity,'revision':3})
        self.assertEqual(self.call('POST','/active-window-status',reading,user='monitor').status_code,409)
        self.call('POST','/monitor/revoke',{})
        self.assertEqual(self.call('GET','/monitor/config',user='monitor').status_code,401)
