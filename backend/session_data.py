"""Strict event transport validation and the existing study metrics, server-side."""
from bisect import bisect_left, bisect_right
import hashlib
import json
import math
import uuid

MAX_ROWS = 20000
TYPES = {'engaged', 'distracted', 'drowsy', 'away'}


def fields(value, allowed):
    if not isinstance(value, dict) or set(value) - set(allowed):
        raise ValueError('Unexpected fields. Account identity and calculated statistics cannot be supplied by the client.')
    return value


def number(value, low=0, high=8640000000000000, integer=False):
    if type(value) not in (int, float) or not math.isfinite(value) or not low <= value <= high or (integer and int(value) != value):
        raise ValueError('Invalid session number or timestamp.')
    return int(value) if integer else value


def identifier(value):
    try:
        if not isinstance(value, str) or str(uuid.UUID(value)) != value: raise ValueError()
    except (ValueError, TypeError, AttributeError): raise ValueError('Invalid session identifier.') from None
    return value


def creation(data):
    fields(data, {'clientSessionId','startTime','goalMinutes','goalEngagementPct','phonePolicy'})
    policy = data.get('phonePolicy')
    if policy not in ('phone-free','phone-allowed'): raise ValueError('Choose a phone policy.')
    return dict(id=identifier(data.get('clientSessionId')), start_time=number(data.get('startTime'), integer=True),
                goal_minutes=number(data.get('goalMinutes'), 1, 1440), goal_engagement_pct=number(data.get('goalEngagementPct'),0,100), phone_policy=policy)


def rows(value):
    if not isinstance(value, list) or len(value) > MAX_ROWS: raise ValueError('Invalid session records.')
    return value


class Intervals:
    def __init__(self, periods):
        self.starts = [p['start'] for p in periods]; self.ends = [p['end'] for p in periods]
        self.prefix = [0]
        for p in periods: self.prefix.append(self.prefix[-1]+p['end']-p['start'])
    def before(self, at):
        index = bisect_right(self.ends, at)
        total = self.prefix[index]
        if index < len(self.starts): total += max(0, at-self.starts[index])
        return total
    def overlap(self, start, end): return self.before(end)-self.before(start)


def completion(session, data):
    fields(data, {'endTime','endReason','events','activeSegments','unclassifiedPeriods'})
    end = number(data.get('endTime'),session.start_time,integer=True)
    if data.get('endReason') not in ('completed','ended-early'): raise ValueError('Invalid session ending.')
    events=[]
    for item in rows(data.get('events')):
        fields(item, {'type','start','end','duration','triggerSource'})
        if item.get('type') not in TYPES: raise ValueError('Invalid confirmed state.')
        start=number(item.get('start'),session.start_time,end,integer=True)
        stop=number(item.get('end'),start,end,integer=True)
        if number(item.get('duration'),integer=True) != stop-start: raise ValueError('Event duration does not match its timestamps.')
        source=item.get('triggerSource')
        if source is not None and (item['type']!='distracted' or source not in ('cameraA','cameraB','window')): raise ValueError('Invalid distraction source.')
        if events and start<events[-1]['end']: raise ValueError('Confirmed events overlap or are out of order.')
        events.append(dict(type=item['type'],start=start,end=stop,duration=stop-start,triggerSource=source))
    segments=[]; assigned=0
    for item in rows(data.get('activeSegments')):
        fields(item, {'start','end','eventStartIndex','eventEndIndex'})
        start=number(item.get('start'),session.start_time,end,integer=True); stop=number(item.get('end'),start,end,integer=True)
        first=number(item.get('eventStartIndex'),0,len(events),integer=True); last=number(item.get('eventEndIndex'),first,len(events),integer=True)
        if first!=assigned or (segments and start<segments[-1]['end']): raise ValueError('Invalid active-segment boundaries.')
        if any(event['start']<start or event['end']>stop for event in events[first:last]): raise ValueError('An event falls outside its active segment.')
        segments.append(dict(start=start,end=stop,eventStartIndex=first,eventEndIndex=last)); assigned=last
    if not segments or assigned!=len(events) or segments[0]['start']!=session.start_time: raise ValueError('Every event needs an active segment.')
    unknown=[]; seg_index=0
    for item in rows(data.get('unclassifiedPeriods')):
        fields(item, {'start','end'})
        start=number(item.get('start'),session.start_time,end,integer=True); stop=number(item.get('end'),start,end,integer=True)
        if unknown and start<unknown[-1]['end']: raise ValueError('Unclassified periods overlap or are out of order.')
        while seg_index<len(segments)-1 and start>=segments[seg_index]['end'] and stop>segments[seg_index]['end']: seg_index+=1
        if start<segments[seg_index]['start'] or stop>segments[seg_index]['end']: raise ValueError('Unclassified time must stay inside an active segment.')
        unknown.append(dict(start=start,end=stop))
    # All active gaps must be explicitly unclassified, never scored by invention.
    coverage=sorted([(e['start'],e['end']) for e in events]+[(p['start'],p['end']) for p in unknown])
    cursor=0
    for segment in segments:
        covered=segment['start']
        while cursor<len(coverage) and coverage[cursor][0]<=segment['end'] and coverage[cursor][1]<=segment['end']:
            a,b=coverage[cursor]
            if a>covered: break
            covered=max(covered,b); cursor+=1
        if covered!=segment['end']: raise ValueError('Active gaps must be marked as unclassified.')
    active=sum(p['end']-p['start'] for p in segments)
    if active>session.goal_minutes*60000+1: raise ValueError('Active time exceeds the session length.')
    if data['endReason']=='completed' and abs(active-session.goal_minutes*60000)>1: raise ValueError('Completed sessions must reach their active-time goal.')
    clean=dict(endTime=end,endReason=data['endReason'],events=events,activeSegments=segments,unclassifiedPeriods=unknown)
    digest=hashlib.sha256(json.dumps(clean,sort_keys=True,separators=(',',':')).encode()).hexdigest()
    return clean, metrics(clean), digest


def metrics(data):
    events=data['events']; segments=data['activeSegments']; gaps=Intervals(data['unclassifiedPeriods'])
    totals={kind:0 for kind in TYPES}; recoveries=[]; distractions=0; longest=0; segment_index=0
    for i,event in enumerate(events):
        while segment_index<len(segments)-1 and i>=segments[segment_index]['eventEndIndex']: segment_index+=1
        unknown=gaps.overlap(event['start'],event['end']); observed=event['duration']-unknown
        totals[event['type']]+=observed
        if event['type']!='distracted': continue
        distractions+=1; longest=max(longest,observed)
        following=events[i+1] if i+1<len(events) else None
        if following and following['type']=='engaged' and following['start']==event['end'] and i+1<segments[segment_index]['eventEndIndex'] and unknown==0:
            recoveries.append(event['duration'])
    classified=totals['engaged']+totals['distracted']+totals['drowsy']
    return dict(totals=totals,engagement_pct=totals['engaged']/classified*100 if classified else None,
                avg_recovery_speed_ms=sum(recoveries)/len(recoveries) if recoveries else None,
                distraction_count=distractions,recovery_count=len(recoveries),longest_distraction_ms=longest,
                active_ms=sum(p['end']-p['start'] for p in segments))


def public_session(row):
    return dict(id=row.id,startTime=row.start_time,endTime=row.end_time,goalMinutes=row.goal_minutes,
                goalEngagementPct=row.goal_engagement_pct,phonePolicy=row.phone_policy,endReason=row.end_reason,
                activeMs=row.active_ms,engagedPct=row.engagement_pct,averageRecoveryMs=row.avg_recovery_speed_ms,
                distractionCount=row.distraction_count,recoveryCount=row.recovery_count,longestDistractionMs=row.longest_distraction_ms,
                timeToFirstDistraction=row.first_distraction_ms,source=row.import_source)


def pacing(values):
    times=sorted(value for value in values if value is not None)
    if not times: return None
    # JS Math.round for nonnegative values; upper middle median, as in Tier 7.
    return max(5,min(45,math.floor(times[len(times)//2]/60000/5+0.5)*5))
