import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Text, TextInput, View } from 'react-native';
import { Button, Card, styles } from './ui';
import { useResource } from './useResource';
import { Profile } from './StudentArea';
import { duration, measured, percentage } from './progress';

function LoadingOrError({ resource }) {
  if (resource.loading) return <Card><ActivityIndicator color="#28664e" /><Text style={styles.body}>Loading…</Text></Card>;
  if (resource.error) return <Card><Text accessibilityRole="alert" style={styles.error}>{resource.error}</Text><Button secondary onPress={resource.reload}>Try again</Button></Card>;
  return null;
}
function StudentSummary({ session, link }) {
  const resource = useResource(session, `/family/${encodeURIComponent(link.id)}/summary`);
  const data = resource.data;
  return <Card>
    <Text style={styles.heading}>{link.displayName}</Text><Text style={styles.caption}>{link.email}</Text>
    {!data ? <LoadingOrError resource={resource} /> : <>
      <Text style={styles.stat}>{percentage(data.avgEngagementPct)}</Text>
      <Text style={styles.body}>{data.sessionsThisWeek ? `Average engagement across ${data.sessionsThisWeek} session${data.sessionsThisWeek === 1 ? '' : 's'} this week.` : 'No completed sessions this week yet.'}</Text>
      {measured(data.avgRecoverySpeedMs) && <Text style={styles.caption}>Average recovery this week: {duration(data.avgRecoverySpeedMs)}.</Text>}
      {typeof data.trendVsPriorWeek === 'number' && <Text style={styles.caption}>{data.trendVsPriorWeek >= 0 ? 'Up' : 'Down'} {Math.abs(Math.round(data.trendVsPriorWeek))} engagement points vs. last week.</Text>}
      <Button secondary onPress={resource.reload}>Refresh</Button>
    </>}
  </Card>;
}
function Dashboard({ session, onNavigateToLink }) {
  const resource = useResource(session, '/family-link');
  if (!resource.data) return <LoadingOrError resource={resource} />;
  const links = resource.data.links;
  return <>
    <Card><Text style={styles.heading}>Your students</Text>
      <Text style={styles.body}>A weekly rollup only — each student's session-by-session detail stays private to their own account.</Text>
      <Button secondary onPress={resource.reload}>Refresh</Button></Card>
    {!links.length && <Card><Text style={styles.body}>No student linked yet.</Text><Button secondary onPress={onNavigateToLink}>Link a student</Button></Card>}
    {links.map(link => <StudentSummary key={link.id} session={session} link={link} />)}
  </>;
}
function LinkStudent({ session, onLinked }) {
  const [email, setEmail] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState(''), [done, setDone] = useState(false);
  async function submit() {
    if (busy) return;
    try {
      if (!email.trim() || !email.includes('@')) throw new Error('Enter the student’s account email.');
      setBusy(true); setError(''); setDone(false);
      await session.request('/family-link', { method: 'POST', body: { studentEmail: email.trim() } });
      setDone(true); setEmail(''); onLinked();
    } catch (failure) { setError(failure.message); }
    finally { setBusy(false); }
  }
  return <Card>
    <Text style={styles.heading}>Link a student</Text>
    <Text style={styles.body}>Enter the student's FocusLens account email. This grants a weekly progress rollup only — never their private session history or event log.</Text>
    <Text style={styles.label}>Student email</Text>
    <TextInput accessibilityLabel="Student email" testID="link-student-email" editable={!busy} style={styles.input} value={email} onChangeText={setEmail}
      keyboardType="email-address" autoCapitalize="none" autoCorrect={false} autoComplete="email" maxLength={254} onSubmitEditing={submit} />
    {Boolean(error) && <Text accessibilityRole="alert" style={styles.error}>{error}</Text>}
    {done && <Text style={styles.body}>Linked. Check Dashboard for this student's weekly summary.</Text>}
    <Button testID="link-student-submit" disabled={busy} onPress={submit}>{busy ? 'Linking…' : 'Link student'}</Button>
  </Card>;
}
export function ParentArea({ session, user, onNavigate }) {
  const [tab, setTab] = useState('dashboard'), [refreshKey, setRefreshKey] = useState(0);
  useEffect(() => { onNavigate(); }, [tab, refreshKey, onNavigate]);
  return <><View style={styles.row}>{[['dashboard', 'Dashboard'], ['link', 'Link a student'], ['profile', 'Profile']].map(([value, label]) =>
    <Button key={value} secondary={tab !== value} onPress={() => setTab(value)}>{label}</Button>)}</View>
    {tab === 'dashboard' ? <Dashboard key={refreshKey} session={session} onNavigateToLink={() => setTab('link')} />
      : tab === 'link' ? <LinkStudent session={session} onLinked={() => { setRefreshKey(value => value + 1); setTab('dashboard'); }} />
      : <Profile session={session} user={user} />}</>;
}
