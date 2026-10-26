"""Every data owner comes from require_auth, never from request JSON."""
import time

from flask import Blueprint, abort, current_app, g, jsonify, request
from sqlalchemy.exc import IntegrityError

from email_reports import recipients, validate_summary
from window_rules import allowed_apps, is_on_task
from .auth import json_fields, normalized_email
from .models import db, Event, FamilyLink, StudySession, User
from .report_data import report_summary
from .session_data import completion, creation, identifier, number, pacing, public_session
from .tokens import issue_token, require_auth
from .legacy import LEGACY_FIELDS, import_legacy

api=Blueprint('data',__name__)

def services(): return current_app.extensions['account_services']
def owned(session_id, lock=False):
    identifier(session_id)
    query=db.select(StudySession).where(StudySession.id==session_id,StudySession.user_id==g.user_id)
    if lock: query=query.with_for_update()
    row=db.session.execute(query).scalar_one_or_none()
    if row is None: abort(404)
    return row

def event_rows(row):
    entries=db.session.execute(db.select(Event).where(Event.session_id==row.id).order_by(Event.position,Event.start_time)).scalars()
    return [dict(type=e.type,start=e.start_time,end=e.end_time,duration=e.duration_ms,triggerSource=e.trigger_source) for e in entries]

@api.errorhandler(ValueError)
def bad_data(error):
    db.session.rollback()
    return jsonify(error=str(error)),400

@api.post('/sessions')
@require_auth
def create_session():
    clean=creation(json_fields({'clientSessionId','startTime','goalMinutes','goalEngagementPct','phonePolicy'}))
    existing=db.session.get(StudySession,clean['id'])
    if existing:
        if existing.user_id!=g.user_id: abort(404)
        if any(getattr(existing,key)!=value for key,value in clean.items()): return jsonify(error='This session already has different settings.'),409
        return jsonify(public_session(existing)),200
    row=StudySession(user_id=g.user_id,**clean); db.session.add(row)
    try: db.session.commit()
    except IntegrityError:
        db.session.rollback(); return jsonify(error='Session registration changed. Retry the same session.'),409
    return jsonify(public_session(row)),201

@api.patch('/sessions/<session_id>')
@require_auth
def finish_session(session_id):
    with services().lock:
        row=owned(session_id,lock=True)
        if row.import_source!='live': return jsonify(error='Legacy summaries cannot be replaced with invented events.'),409
        clean,values,digest=completion(row,json_fields({'endTime','endReason','events','activeSegments','unclassifiedPeriods'}))
        if row.end_time is not None:
            if row.completion_key!=digest: return jsonify(error='This session has already been completed with different records.'),409
            return jsonify(public_session(row))
        for key,value in values.items():
            if key!='totals': setattr(row,key,value)
        row.end_time=clean['endTime']; row.end_reason=clean['endReason']; row.completion_key=digest
        row.active_segments=clean['activeSegments']; row.unclassified_periods=clean['unclassifiedPeriods']
        row.first_distraction_ms=next((e['start']-row.start_time for e in clean['events'] if e['type']=='distracted'),None)
        db.session.add_all([Event(session_id=row.id,position=i,type=e['type'],start_time=e['start'],end_time=e['end'],duration_ms=e['duration'],trigger_source=e['triggerSource']) for i,e in enumerate(clean['events'])])
        db.session.commit()
        services().leases.pop((g.user_id,row.id),None); services().windows.pop((g.user_id,row.id),None)
        return jsonify(public_session(row))

@api.get('/sessions')
@require_auth
def list_sessions():
    try: offset=int(request.args.get('offset','0')); limit=int(request.args.get('limit','100'))
    except ValueError: raise ValueError('Invalid history page.') from None
    if not 0<=offset<=1000000 or not 1<=limit<=100: raise ValueError('Invalid history page.')
    query=db.select(StudySession).where(StudySession.user_id==g.user_id,StudySession.end_time.is_not(None),StudySession.import_source!='legacy-pacing').order_by(StudySession.end_time.desc(),StudySession.id)
    entries=list(db.session.execute(query.offset(offset).limit(limit+1)).scalars())
    timings=db.session.execute(db.select(StudySession.first_distraction_ms).where(StudySession.user_id==g.user_id,StudySession.end_time.is_not(None),StudySession.first_distraction_ms.is_not(None))).scalars()
    return jsonify(sessions=[public_session(row) for row in reversed(entries[:limit])],nextOffset=offset+limit if len(entries)>limit else None,suggestedMinutes=pacing(timings))

@api.get('/sessions/<session_id>')
@require_auth
def get_session(session_id):
    row=owned(session_id)
    return jsonify(**public_session(row),events=event_rows(row),activeSegments=row.active_segments,unclassifiedPeriods=row.unclassified_periods)

@api.get('/family-link')
@require_auth
def family():
    if g.user.role=='parent':
        users=db.session.execute(db.select(User).join(FamilyLink,FamilyLink.student_user_id==User.id).where(FamilyLink.parent_user_id==g.user_id)).scalars()
    else:
        users=db.session.execute(db.select(User).join(FamilyLink,FamilyLink.parent_user_id==User.id).where(FamilyLink.student_user_id==g.user_id)).scalars()
    return jsonify(links=[dict(email=user.email,displayName=user.display_name) for user in users],reportDefaults=[g.user.email]+([] if g.user.role=='parent' else [user.email for user in db.session.execute(db.select(User).join(FamilyLink,FamilyLink.parent_user_id==User.id).where(FamilyLink.student_user_id==g.user_id)).scalars()][:1]))

@api.post('/family-link')
@require_auth
def link_family():
    if g.user.role!='parent': return jsonify(error='Only a signed-in parent can link a student.'),403
    email=normalized_email(json_fields({'studentEmail'}).get('studentEmail'))
    student=db.session.execute(db.select(User).where(User.email==email,User.role=='student')).scalar_one_or_none()
    if student is None or student.id==g.user_id: return jsonify(error='No eligible student account was found.'),404
    existing=db.session.execute(db.select(FamilyLink).where(FamilyLink.parent_user_id==g.user_id,FamilyLink.student_user_id==student.id)).scalar_one_or_none()
    if not existing:
        db.session.add(FamilyLink(parent_user_id=g.user_id,student_user_id=student.id))
        try: db.session.commit()
        except IntegrityError: db.session.rollback()
    return jsonify(linked=True),200 if existing else 201

@api.get('/report-config')
@require_auth
def report_config(): return jsonify(configured=services().configured,transport=services().transport)

@api.post('/imports/local')
@require_auth
def import_local():
    try: return jsonify(import_legacy(g.user,json_fields(LEGACY_FIELDS)))
    except IntegrityError:
        db.session.rollback()
        return jsonify(error='A concurrent import changed these records. Retry the same export; your originals were kept.'),409

@api.post('/send-report')
@require_auth
def send_session_report():
    data=json_fields({'sessionId','recipientEmails'}); row=owned(data.get('sessionId'))
    if row.end_time is None or row.import_source!='live': return jsonify(error='Finish and save a study session before sending its report.'),409
    addresses=data.get('recipientEmails')
    if addresses is None: addresses=family().get_json()['reportDefaults']
    addresses=recipients(addresses)
    if not services().configured: return jsonify(error='Email delivery is not configured on this service yet.'),503
    summary=validate_summary(report_summary(row,event_rows(row)))
    return jsonify(services().queue(g.user_id,summary,addresses)),202

@api.get('/reports/<report_id>')
@require_auth
def report_status(report_id):
    with services().lock:
        job=services().reports.get(report_id)
        if not job or job['userId']!=g.user_id: abort(404)
        return jsonify(services().public_job(job))

@api.put('/sessions/<session_id>/activity')
@require_auth
def session_activity(session_id):
    row=owned(session_id)
    if row.end_time is not None: return jsonify(error='This session has ended.'),409
    data=json_fields({'revision','active','monitorEnabled','allowedApps'})
    revision=number(data.get('revision'),1,1000000000,integer=True)
    if type(data.get('active')) is not bool or type(data.get('monitorEnabled')) is not bool: raise ValueError('Invalid app-monitor lease.')
    apps=allowed_apps(data.get('allowedApps')); now=time.time()*1000; state=services(); key=(g.user_id,row.id)
    with state.lock:
        old=state.leases.get(key)
        if old and revision<=old['revision']: return jsonify(registered=True)
        changed=not old or old['active']!=data['active'] or old['monitorEnabled']!=data['monitorEnabled'] or old['allowedApps']!=apps or now-old['updatedAt']>10000
        state.leases={key:value for key,value in state.leases.items() if now-value['updatedAt']<3600000}
        if len(state.leases)>=1000 and key not in state.leases: raise ValueError('App monitoring is busy. Retry later.')
        lease=dict(sessionId=row.id,revision=revision,active=data['active'],monitorEnabled=data['monitorEnabled'],allowedApps=apps,updatedAt=now,
                   evidenceRevision=revision if changed else old['evidenceRevision'],evidenceAt=now if changed else old['evidenceAt'])
        state.leases[key]=lease
        if changed or not data['active']: state.windows.pop(key,None)
    return jsonify(registered=True)

@api.get('/active-window-status')
@require_auth
def window_reading():
    session=owned(request.args.get('sessionId')); state=services(); now=time.time()*1000
    with state.lock:
        lease=state.active(g.user_id); row=state.windows.get((g.user_id,session.id))
        good=lease and lease['sessionId']==session.id and row and now-row['observedAt']<=7000 and session.end_time is None
        return jsonify(row if good else dict(userId=g.user_id,sessionId=session.id,available=False))

@api.post('/active-window-status')
@require_auth
def window_status():
    if g.auth_purpose!='monitor': return jsonify(error='Use a paired app-name companion for monitor readings.'),403
    data=json_fields({'sessionId','sessionRevision','appName','windowTitle','observedAt'})
    session=owned(data.get('sessionId')); state=services(); now=time.time()*1000
    name=data.get('appName')
    if not isinstance(name,str) or not name.strip() or len(name)>200 or any(ord(c)<32 for c in name) or data.get('windowTitle')!='': raise ValueError('Only an app name and an empty window title are accepted.')
    revision=number(data.get('sessionRevision'),1,integer=True); observed=number(data.get('observedAt'),0,now+1000)
    with state.lock:
        lease=state.active(g.user_id)
        if session.end_time is not None or not lease or lease['sessionId']!=session.id or not lease['evidenceRevision']<=revision<=lease['revision'] or observed<lease['evidenceAt'] or now-observed>7000:
            return jsonify(error='App reading is stale or the session is paused.'),409
        reading=dict(userId=g.user_id,sessionId=session.id,available=True,appName=name.strip(),windowTitle='',isOnTask=is_on_task(name,lease['allowedApps']),observedAt=observed)
        state.windows[(g.user_id,session.id)]=reading
        return jsonify(accepted=True)

@api.post('/monitor/pair')
@require_auth
def pair_monitor():
    json_fields(set())
    return jsonify(pairCode=services().pair(g.user_id),expiresIn=120),201

@api.post('/monitor/claim')
def claim_monitor():
    if not current_app.extensions['auth_limiter'].allowed(request.remote_addr): return jsonify(error='Too many attempts. Please wait.'),429
    code=json_fields({'pairCode'}).get('pairCode')
    if not isinstance(code,str) or len(code)>100: raise ValueError('Invalid pairing code.')
    state=services(); now=time.time()
    with state.lock:
        pending=state.pairs.pop(code,None)
        if not pending or pending['expires']<=now: return jsonify(error='Pairing code is invalid or expired.'),401
        user=db.session.get(User,pending['owner'])
        if user is None: return jsonify(error='Pairing code is invalid or expired.'),401
        import secrets
        device=secrets.token_urlsafe(24)
        state.devices={key:value for key,value in state.devices.items() if value['expires']>now}
        if len(state.devices)>=1000: raise ValueError('Monitor pairing is busy.')
        state.devices[device]=dict(owner=user.id,expires=now+14400)
        return jsonify(issue_token(user,purpose='monitor',device_id=device)),201

@api.get('/monitor/config')
@require_auth
def monitor_config():
    with services().lock:
        lease=services().active(g.user_id)
        return jsonify(**(lease or dict(active=False,monitorEnabled=False)),serverNow=time.time()*1000)

@api.post('/monitor/revoke')
@require_auth
def revoke_monitor():
    json_fields(set()); state=services()
    with state.lock:
        state.devices={key:value for key,value in state.devices.items() if value['owner']!=g.user_id}
        state.leases={key:value for key,value in state.leases.items() if key[0]!=g.user_id}
        state.windows={key:value for key,value in state.windows.items() if key[0]!=g.user_id}
        state.pairs={key:value for key,value in state.pairs.items() if value['owner']!=g.user_id}
    return jsonify(revoked=True)
