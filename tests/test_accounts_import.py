import copy
import tempfile
import unittest
from pathlib import Path

from flask_migrate import upgrade
from backend import create_app
from backend.models import db, Event, StudySession


class ImportTests(unittest.TestCase):
    def setUp(self):
        self.folder=tempfile.TemporaryDirectory()
        self.app=create_app(dict(TESTING=True,JWT_SECRET_KEY='test-key-'*8,BCRYPT_ROUNDS=4,AUTH_RATE_LIMIT=1000,SQLALCHEMY_DATABASE_URI='sqlite:///'+str(Path(self.folder.name)/'test.db')))
        self.context=self.app.app_context();self.context.push();upgrade();self.client=self.app.test_client()
        self.payload=dict(localProfileId='old-browser',localSessionHistory=[dict(id='old-summary',profileId='old-browser',startTime=100000,endTime=106000,goalMinutes=1,goalEngagementPct=80,phonePolicy='phone-free',endReason='ended-early',activeMs=6000,engagedPct=50,averageRecoveryMs=3000,distractionCount=1,recoveryCount=1,longestDistractionMs=3000)],localPacingHistory=[dict(profileId='old-browser',date='2026-10-24T20:00:00.000Z',timeToFirstDistraction=740000),dict(profileId='old-browser',date='2026-10-25T20:00:00.000Z',timeToFirstDistraction=None)])
    def tearDown(self):db.session.remove();db.engine.dispose();self.context.pop();self.folder.cleanup()
    def signup(self,**extra):return self.client.post('/auth/signup',json=dict(email='student@example.test',password='Test password 123',displayName='Student',role='student',**extra))
    def auth(self,token):return {'Authorization':'Bearer '+token}
    def test_auth_import_preserves_summaries_and_unknowns_without_inventing_events(self):
        response=self.signup(**self.payload);self.assertEqual(response.status_code,201)
        body=response.get_json();self.assertEqual(body['migration']['status'],'complete');self.assertEqual(body['migration']['imported'],3)
        self.assertEqual(db.session.query(Event).count(),0)
        timing=db.session.query(StudySession).filter_by(import_source='legacy-pacing').first()
        self.assertIsNone(timing.goal_minutes);self.assertIsNone(timing.start_time);self.assertIsNone(timing.engagement_pct)
        history=self.client.get('/sessions',headers=self.auth(body['token'])).get_json()
        self.assertEqual(len(history['sessions']),1);self.assertEqual(history['sessions'][0]['source'],'legacy-summary')
        self.assertEqual(history['suggestedMinutes'],10)
        again=self.client.post('/imports/local',json=self.payload,headers=self.auth(body['token']))
        self.assertEqual(again.status_code,200);self.assertEqual(again.get_json()['imported'],0);self.assertEqual(db.session.query(StudySession).count(),3)
    def test_failed_auth_never_imports_and_bad_import_does_not_block_sign_in_or_partially_save(self):
        self.signup()
        result=self.client.post('/auth/login',json=dict(email='student@example.test',password='wrong password',**self.payload))
        self.assertEqual(result.status_code,401);self.assertEqual(db.session.query(StudySession).count(),0)
        broken=copy.deepcopy(self.payload);broken['localPacingHistory'][0]['timeToFirstDistraction']=-1
        result=self.client.post('/auth/login',json=dict(email='student@example.test',password='Test password 123',**broken))
        self.assertEqual(result.status_code,200);self.assertEqual(result.get_json()['migration']['status'],'failed');self.assertEqual(db.session.query(StudySession).count(),0)
        token=result.get_json()['token']
        for change in [{'userId':'claimed'},{'localSessionHistory':[dict(self.payload['localSessionHistory'][0],events=[])]},{'localPacingHistory':[dict(self.payload['localPacingHistory'][0],profileId='another')]}]:
            result=self.client.post('/imports/local',json={**self.payload,**change},headers=self.auth(token));self.assertEqual(result.status_code,400)
        self.assertEqual(db.session.query(StudySession).count(),0)
    def test_import_identity_is_the_verified_user_not_old_profile_or_query(self):
        first=self.signup().get_json()
        other=self.client.post('/auth/signup',json=dict(email='other@example.test',password='Test password 123',displayName='Other',role='student')).get_json()
        self.assertEqual(self.client.post('/imports/local',json=self.payload).status_code,401)
        result=self.client.post('/imports/local?userId='+first['user']['id'],json=self.payload,headers=self.auth(other['token']))
        self.assertEqual(result.status_code,200)
        self.assertTrue(all(row.user_id==other['user']['id'] for row in db.session.query(StudySession)))
        self.assertEqual(self.client.get('/sessions',headers=self.auth(first['token'])).get_json()['sessions'],[])
        changed=copy.deepcopy(self.payload);changed['localSessionHistory'][0]['engagedPct']=99
        self.assertEqual(self.client.post('/imports/local',json=changed,headers=self.auth(other['token'])).status_code,400)
        self.assertEqual(db.session.query(StudySession).filter_by(import_source='legacy-summary').one().engagement_pct,50)

if __name__=='__main__':unittest.main()
