import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import { Button, Card, styles } from './ui';
import { useResource } from './useResource';
import { NotificationSettings } from './NotificationSettings';
import { dateTime, duration, measured, newestFirst, percentage, recentStats, sessionSettings, STATE_COLORS, STATE_LABELS, timeline } from './progress';

function LoadingOrError({ resource }) {
  if (resource.loading) return <Card><ActivityIndicator color="#28664e" /><Text style={styles.body}>Loading your progress… The service may take a moment to wake up.</Text></Card>;
  if (resource.error) return <Card><Text accessibilityRole="alert" style={styles.error}>{resource.error}</Text><Button secondary onPress={resource.reload}>Try again</Button></Card>;
  return null;
}
function SessionRow({ row, onOpen }) {
  return <Card><Text style={styles.heading}>{percentage(row.engagedPct)} engagement</Text><Text style={styles.body}>{dateTime(row.startTime)}</Text>
    <Text style={styles.caption}>{duration(row.activeMs)} active · {measured(row.distractionCount) ? `${row.distractionCount} distraction${row.distractionCount === 1 ? '' : 's'}` : 'Distraction count not recorded'}</Text>
    {row.source === 'legacy-summary' && <Text style={styles.caption}>Imported summary · original events unavailable</Text>}
    <Button secondary onPress={() => onOpen(row.id)}>View session</Button></Card>;
}
function Dashboard({ session, onOpen }) {
  const resource = useResource(session, '/sessions?limit=5');
  if (!resource.data) return <LoadingOrError resource={resource} />;
  const { recent, averageEngagement, measuredCount } = recentStats(resource.data.sessions);
  return <><Card><Text style={styles.heading}>Your recent progress</Text>
    {recent.length ? <><Text style={styles.stat}>{percentage(averageEngagement)}</Text><Text style={styles.body}>Average engagement across {measuredCount} measured session{measuredCount === 1 ? '' : 's'} in your latest {recent.length}.</Text></> : <Text style={styles.body}>Your first session is still ahead. Complete a study session on your laptop, then refresh here.</Text>}
    {measured(resource.data.suggestedMinutes) && <Text style={styles.caption}>Your pacing suggestion: {resource.data.suggestedMinutes} minutes.</Text>}
    <Button secondary onPress={resource.reload}>Refresh progress</Button></Card>
    {recent.length > 0 && <Text style={styles.sectionTitle}>Latest session</Text>}{recent.slice(0, 1).map(row => <SessionRow key={row.id} row={row} onOpen={onOpen} />)}</>;
}
function History({ session, onOpen }) {
  const [rows, setRows] = useState([]), [nextOffset, setNextOffset] = useState(null), [offset, setOffset] = useState(0), [attempt, setAttempt] = useState(0);
  const [loading, setLoading] = useState(true), [error, setError] = useState('');
  useEffect(() => {
    const abort = new AbortController(); let current = true; setLoading(true); setError('');
    session.request(`/sessions?limit=20&offset=${offset}`, { signal: abort.signal }).then(data => {
      const incoming = newestFirst(data.sessions);
      if (!current) return;
      setRows(previous => newestFirst([...new Map([...(offset === 0 ? [] : previous), ...incoming].map(row => [row.id, row])).values()]));
      setNextOffset(data.nextOffset); setLoading(false);
    }).catch(failure => { if (current) { setError(failure.message); setLoading(false); } });
    return () => { current = false; abort.abort(); };
  }, [session, offset, attempt]);
  return <><Card><Text style={styles.heading}>Your history</Text><Text style={styles.body}>Completed laptop sessions, newest first. Only your account’s sessions appear here.</Text>
    <Button secondary disabled={loading} onPress={() => { setRows([]); setNextOffset(null); setOffset(0); setAttempt(value => value + 1); }}>Refresh history</Button></Card>
    {!loading && !error && !rows.length && <Card><Text style={styles.body}>No sessions yet. Study on your laptop to start your history.</Text></Card>}
    {rows.map(row => <SessionRow key={row.id} row={row} onOpen={onOpen} />)}
    {(loading || error) && <LoadingOrError resource={{ loading, error, reload: () => setAttempt(value => value + 1) }} />}
    {!loading && !error && nextOffset !== null && <Button secondary onPress={() => setOffset(nextOffset)}>Load older sessions</Button>}</>;
}
function SessionDetail({ session, id, onBack }) {
  const resource = useResource(session, `/sessions/${encodeURIComponent(id)}`);
  if (!resource.data) return <><Button secondary onPress={onBack}>Back to history</Button><LoadingOrError resource={resource} /></>;
  const row = resource.data, pieces = timeline(row), kinds = [...new Set(pieces.map(piece => piece.type))], settings = sessionSettings(row);
  return <><Button secondary onPress={onBack}>Back to history</Button><Card><Text style={styles.heading}>Your session</Text><Text style={styles.body}>{dateTime(row.startTime)}</Text>
    <Text style={styles.stat}>{percentage(row.engagedPct)}</Text><Text style={styles.body}>Engagement · goal {percentage(row.goalEngagementPct)}</Text>
    <Text style={styles.body}>{duration(row.activeMs)} active · {settings.ending}</Text>
    <Text style={styles.caption}>{settings.policy} · {settings.plan}</Text></Card>
    <Card><Text style={styles.heading}>Distractions & recovery</Text>
      <Text style={styles.body}>{row.distractionCount === 0 ? 'No distractions this session.' : measured(row.distractionCount) ? `${row.distractionCount} distraction${row.distractionCount === 1 ? '' : 's'} recorded.` : 'Distraction count not recorded.'}</Text>
      <Text style={styles.body}>{measured(row.averageRecoveryMs) ? `Average recovery: ${duration(row.averageRecoveryMs)}.` : row.distractionCount === 0 ? 'No recovery needed.' : row.source === 'legacy-summary' ? 'Recovery duration was not recorded in this imported summary.' : 'No recoveries recorded.'}</Text>
      {measured(row.longestDistractionMs) && row.distractionCount !== 0 && <Text style={styles.body}>Longest distraction: {duration(row.longestDistractionMs)}.</Text>}
      <Text style={styles.caption}>Recovery includes only direct returns from distracted to engaged within an uninterrupted active segment.</Text></Card>
    <Card><Text style={styles.heading}>Session timeline</Text>
      {pieces.length ? <><View accessible accessibilityLabel={pieces.map(piece => `${STATE_LABELS[piece.type]} for ${duration(piece.end - piece.start)}`).join(', ')} style={styles.timeline}>
        {pieces.map(piece => <View key={piece.start} style={{ width: `${piece.widthPct}%`, height: 24, backgroundColor: STATE_COLORS[piece.type] }} />)}</View>
        <View style={styles.row}>{kinds.map(type => <Text key={type} style={styles.caption}><Text style={{ color: STATE_COLORS[type] }}>● </Text>{STATE_LABELS[type]}</Text>)}</View>
        <Text style={styles.caption}>From {dateTime(row.startTime)} to {dateTime(row.endTime)}. Pauses and unclassified gaps are shown separately.</Text>
        {row.events.filter(event => event.type === 'distracted' && event.triggerSource === 'cameraB').map(event => <Text key={event.start} style={styles.caption}>Phone caught by desk camera at {duration(event.start - row.startTime)} into the session.</Text>)}</>
        : <Text style={styles.body}>{row.source === 'legacy-summary' ? 'Imported summary only. Original events were not available, so no timeline has been invented.' : 'No timeline recorded for this session.'}</Text>}
    </Card></>;
}
export function Profile({ session, user }) {
  const family = useResource(session, '/family-link');
  return <><Card><Text style={styles.heading}>Your account</Text><Text style={styles.body}>{user.displayName}</Text><Text style={styles.body}>{user.email}</Text><Text style={styles.caption}>{user.role === 'student' ? 'Student' : 'Parent'} account</Text></Card>
    {user.role === 'student' && (family.data ? <Card><Text style={styles.heading}>Linked parents</Text>{family.data.links.length ? family.data.links.map(parent => <View key={parent.email}><Text style={styles.body}>{parent.displayName}</Text><Text style={styles.caption}>{parent.email}</Text></View>) : <Text style={styles.body}>No parent linked yet.</Text>}
      <Text style={styles.caption}>A family link is for aggregate progress. Your private session details are not shared through this companion.</Text><Button secondary onPress={family.reload}>Refresh linked parents</Button></Card> : <LoadingOrError resource={family} />)}
    <Card><Text style={styles.heading}>Companion settings</Text><Text style={styles.body}>Your laptop manages study duration, phone policy, and report recipients. This companion shows your saved progress.</Text></Card><NotificationSettings /></>;
}
export function StudentArea({ session, user, onNavigate }) {
  const [tab, setTab] = useState('dashboard'), [selected, setSelected] = useState(null);
  useEffect(() => { onNavigate(); }, [tab, selected, onNavigate]);
  return <><View style={styles.row}>{[['dashboard', 'Dashboard'], ['history', 'History'], ['profile', 'Profile']].map(([value, label]) => <Button key={value} secondary={tab !== value} onPress={() => { setSelected(null); setTab(value); }}>{label}</Button>)}</View>
    {selected ? <SessionDetail session={session} id={selected} onBack={() => { setSelected(null); setTab('history'); }} /> : tab === 'dashboard' ? <Dashboard session={session} onOpen={id => { setSelected(id); setTab('history'); }} /> : tab === 'history' ? <History session={session} onOpen={setSelected} /> : <Profile session={session} user={user} />}</>;
}
