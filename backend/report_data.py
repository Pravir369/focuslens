"""Reports derive from the owned stored session, never client-written stats."""
from datetime import datetime, timezone
from .session_data import metrics


def seconds(ms):
    value=f'{ms/1000:.1f}'.removesuffix('.0')
    return f'{value} {"second" if value=="1" else "seconds"}'


def duration(ms):
    value=max(0,ms)/1000
    tail=f'{value%60:.1f}'.removesuffix('.0')
    return f'{tail} s' if value<60 else f'{int(value//60)} m {tail} s'


def report_summary(session, events):
    data=dict(events=events,activeSegments=session.active_segments,unclassifiedPeriods=session.unclassified_periods)
    values=metrics(data); count=values['distraction_count']; average=values['avg_recovery_speed_ms']; pct=values['engagement_pct']; goal=session.goal_engagement_pct
    recovery='No distractions this session' if count==0 else 'No recoveries recorded' if average is None else f'You got back on track in about {seconds(average)} on average.'
    engagement='No classified time' if pct is None else f'You were engaged for {pct:.1f}% of classified study time, against your {goal:g}% goal.'
    feedback='Not enough classified time to compare with your goal.' if pct is None else 'You hit your goal.' if pct>=goal else f'Close — {goal-pct:.1f} percentage points below your goal.' if goal-pct<=10+1e-9 else f'Below your goal by {goal-pct:.1f} percentage points. Every session is a fresh start.'
    counts=dict(phone=0,window=0,drowsy=0,lookAway=0)
    for event in events:
        if event['type']=='drowsy': counts['drowsy']+=1
        if event['type']=='distracted': counts['phone' if event.get('triggerSource') in ('cameraA','cameraB') else 'window' if event.get('triggerSource')=='window' else 'lookAway']+=1
    winner=max(counts,key=counts.get) if any(counts.values()) else 'none'
    tips={
        'none':'No distractions logged this session.',
        'phone':"Most of today's lapses were phone-related. Try leaving it in another room next session.",
        'window':"Most of this session's lapses happened while an app outside your study list was active. Try keeping only your study apps open next session.",
        'drowsy':'Several drowsy moments today — this might be a session-timing issue more than a focus issue. Try studying earlier, or take a short break before you start.',
        'lookAway':'Most lapses were brief look-aways, not phone use — your attention drifted but came back on its own, which your recovery-speed number below reflects.'}
    boundaries=sorted({session.start_time,session.end_time}|{at for row in events+session.active_segments+session.unclassified_periods for at in (row['start'],row['end'])})
    spans=[]; ei=si=ui=0; segments=session.active_segments; unknown=session.unclassified_periods
    for start,end in zip(boundaries,boundaries[1:]):
        if start==end: continue
        while ei<len(events) and events[ei]['end']<=start: ei+=1
        while si<len(segments) and segments[si]['end']<=start: si+=1
        while ui<len(unknown) and unknown[ui]['end']<=start: ui+=1
        active=si<len(segments) and segments[si]['start']<=start<segments[si]['end']
        missing=ui<len(unknown) and unknown[ui]['start']<=start<unknown[ui]['end']
        event=events[ei] if ei<len(events) and events[ei]['start']<=start<events[ei]['end'] else None
        kind='paused' if not active else 'unclassified' if missing or not event else event['type']
        source=event.get('triggerSource') if event and kind=='distracted' else None
        label=kind+(' · '+{'cameraA':'Camera A','cameraB':'Camera B (desk)','window':'Active app'}[source] if source else '')
        if spans and spans[-1]['label']==label and spans[-1]['end']==start: spans[-1]['end']=end
        else: spans.append(dict(label=label,start=start,end=end))
    return dict(title='FocusLens session report',completedAt=datetime.fromtimestamp(session.end_time/1000,timezone.utc).isoformat(),
        headlineStats=dict(recovery=recovery,engagement=engagement,distractions=f'{count} {"moment" if count==1 else "moments"} of distraction this session.',longest=f'Your longest distraction lasted about {seconds(values["longest_distraction_ms"])}.'),
        goalFeedback=feedback,patternTip=tips[winner],timeline=[dict(state=p['label'],start=duration(p['start']-session.start_time),end=duration(p['end']-session.start_time),duration=duration(p['end']-p['start'])) for p in spans])
