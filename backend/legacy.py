"""Untrusted legacy summaries and pacing: never invent events or ownership."""
from datetime import datetime
import hashlib
import json
import math

from sqlalchemy.exc import IntegrityError
from .models import db, StudySession
from .session_data import fields, number

LEGACY_FIELDS={'localProfileId','localSessionHistory','localPacingHistory'}
SUMMARY_FIELDS={'id','profileId','startTime','endTime','goalMinutes','goalEngagementPct','phonePolicy','endReason','activeMs','engagedPct','averageRecoveryMs','distractionCount','recoveryCount','longestDistractionMs'}


def digest(value): return hashlib.sha256(json.dumps(value,sort_keys=True,separators=(',',':'),ensure_ascii=True).encode()).hexdigest()
def nullable_number(value,low=0,high=8640000000000000): return None if value is None else number(value,low,high)
def millis(value): return math.floor(number(value)+.5)


def import_legacy(user,data):
    owner=data.get('localProfileId')
    if not isinstance(owner,str) or not 1<=len(owner)<=128 or owner.strip()!=owner or any(ord(c)<32 or ord(c)==127 for c in owner): raise ValueError('Invalid legacy profile metadata.')
    summaries=data.get('localSessionHistory',[]); timings=data.get('localPacingHistory',[])
    if not isinstance(summaries,list) or len(summaries)>100 or not isinstance(timings,list) or len(timings)>10000: raise ValueError('Legacy import is too large. Your original data was kept.')
    prepared=[]
    for record in summaries:
        fields(record,SUMMARY_FIELDS)
        if record.get('profileId',owner)!=owner: raise ValueError('Legacy records must match the exported local profile.')
        rid=record.get('id')
        if not isinstance(rid,str) or not 1<=len(rid)<=100: raise ValueError('Invalid legacy summary identifier.')
        start=number(record.get('startTime')); end=number(record.get('endTime'),start)
        goal=number(record.get('goalMinutes'),.000001,1440); target=number(record.get('goalEngagementPct'),0,100)
        active=number(record.get('activeMs'),0,min(end-start,goal*60000))
        count=number(record.get('distractionCount'),0,1000000,integer=True); recovered=number(record.get('recoveryCount'),0,count,integer=True)
        average=nullable_number(record.get('averageRecoveryMs'),0,active)
        if (average is None)!=(recovered==0): raise ValueError('Legacy recovery values are inconsistent.')
        if record.get('phonePolicy') not in ('phone-free','phone-allowed') or record.get('endReason') not in ('completed','ended-early'): raise ValueError('Invalid legacy session settings.')
        prepared.append(dict(legacy_key=digest(['summary',owner,rid]),import_source='legacy-summary',start_time=millis(start),end_time=millis(end),goal_minutes=goal,
            goal_engagement_pct=target,phone_policy=record['phonePolicy'],end_reason=record['endReason'],active_ms=active,
            engagement_pct=nullable_number(record.get('engagedPct'),0,100),avg_recovery_speed_ms=average,
            distraction_count=count,recovery_count=recovered,longest_distraction_ms=number(record.get('longestDistractionMs'),0,active)))
    for record in timings:
        fields(record,{'profileId','date','timeToFirstDistraction'})
        if record.get('profileId')!=owner: raise ValueError('Legacy pacing must match the exported local profile.')
        date=record.get('date')
        try:
            if not isinstance(date,str) or len(date)>100: raise ValueError()
            parsed=datetime.fromisoformat(date.replace('Z','+00:00'))
            if parsed.tzinfo is None: raise ValueError()
            stamp=millis(parsed.timestamp()*1000)
        except (ValueError,OverflowError,OSError): raise ValueError('Invalid legacy pacing date.') from None
        first=nullable_number(record.get('timeToFirstDistraction'))
        prepared.append(dict(legacy_key=digest(['pacing',owner,date,first]),import_source='legacy-pacing',end_time=stamp,first_distraction_ms=first))
    # Stage and validate the entire import before inserting anything.
    unique={}
    for row in prepared:
        if row['legacy_key'] in unique and row!=unique[row['legacy_key']]: raise ValueError('Conflicting legacy records.')
        unique[row['legacy_key']]=row
    imported=0
    for key,row in unique.items():
        old=db.session.execute(db.select(StudySession).where(StudySession.user_id==user.id,StudySession.legacy_key==key)).scalar_one_or_none()
        if old:
            if any(getattr(old,field)!=value for field,value in row.items()): raise ValueError('An imported legacy record has different values. Originals were kept.')
        else:
            db.session.add(StudySession(user_id=user.id,**row)); imported+=1
    db.session.commit()
    return dict(status='complete',imported=imported,acknowledged=len(prepared),payloadHash=digest({key:data.get(key,[]) for key in sorted(LEGACY_FIELDS)}))


def maybe_import(user,data):
    if not LEGACY_FIELDS.intersection(data): return None
    try: return import_legacy(user,data)
    except (ValueError,IntegrityError):
        db.session.rollback()
        return dict(status='failed',error='Your account is ready, but old history could not be imported. Your original browser data was kept. Retry the import from your account.')
