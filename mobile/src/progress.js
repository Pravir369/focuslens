export const STATE_COLORS = { engaged: '#32775a', distracted: '#b4771d', drowsy: '#80639d', away: '#79838c', paused: '#d6dce0', unclassified: '#eee7d9' };
export const STATE_LABELS = { engaged: 'Engaged', distracted: 'Distracted', drowsy: 'Drowsy', away: 'Away', paused: 'Paused', unclassified: 'Unclassified' };
export const measured = value => typeof value === 'number' && Number.isFinite(value) && value >= 0;
export const percentage = value => measured(value) ? `${Math.round(value)}%` : 'Not measured';
export function duration(value) {
  if (!measured(value)) return 'Not recorded';
  const seconds = Math.round(value / 1000);
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m${seconds % 60 ? ` ${seconds % 60}s` : ''}`;
}
export const dateTime = value => measured(value) ? new Date(value).toLocaleString(undefined, { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : 'Date not recorded';
export function sessionSettings(row) {
  return { ending: row.endReason === 'completed' ? 'Completed' : row.endReason === 'ended-early' ? 'Ended early' : 'Ending not recorded',
    policy: row.phonePolicy === 'phone-free' ? 'Phone-free' : row.phonePolicy === 'phone-allowed' ? 'Studying with phone' : 'Phone policy not recorded',
    plan: measured(row.goalMinutes) ? `${row.goalMinutes}-minute plan` : 'Duration goal not recorded' };
}
export function newestFirst(sessions) {
  if (!Array.isArray(sessions)) throw new Error('Session history could not be read. Please retry.');
  return [...sessions].sort((a, b) => (b.endTime ?? b.startTime) - (a.endTime ?? a.startTime) || a.id.localeCompare(b.id));
}
export function recentStats(sessions) {
  const recent = newestFirst(sessions).slice(0, 5), scored = recent.filter(row => measured(row.engagedPct));
  return { recent, measuredCount: scored.length, averageEngagement: scored.length ? scored.reduce((sum, row) => sum + row.engagedPct, 0) / scored.length : null };
}

// Read transport records only. Pauses and unknown time never become invented events.
export function timeline(session) {
  if (session.source === 'legacy-summary' || !Array.isArray(session.events) || !Array.isArray(session.activeSegments) || !measured(session.startTime) || !measured(session.endTime) || session.endTime <= session.startTime) return [];
  const { startTime: start, endTime: end } = session, events = session.events, active = session.activeSegments, unknown = session.unclassifiedPeriods || [];
  const boundaries = new Set([start, end]);
  for (const record of [...events, ...active, ...unknown]) for (const at of [record.start, record.end]) if (Number.isFinite(at) && at >= start && at <= end) boundaries.add(at);
  const points = [...boundaries].sort((a, b) => a - b), pieces = [];
  let a = 0, e = 0, u = 0;
  for (let i = 0; i < points.length - 1; i++) {
    const from = points[i], to = points[i + 1], midpoint = from + (to - from) / 2;
    while (a < active.length && active[a].end <= midpoint) a++;
    while (e < events.length && events[e].end <= midpoint) e++;
    while (u < unknown.length && unknown[u].end <= midpoint) u++;
    const inActive = a < active.length && active[a].start <= midpoint && active[a].end > midpoint;
    const inUnknown = u < unknown.length && unknown[u].start <= midpoint && unknown[u].end > midpoint;
    const event = e < events.length && events[e].start <= midpoint && events[e].end > midpoint ? events[e] : null;
    const type = !inActive ? 'paused' : inUnknown || !event || !STATE_LABELS[event.type] ? 'unclassified' : event.type;
    const previous = pieces.at(-1);
    if (previous?.type === type) previous.end = to;
    else pieces.push({ start: from, end: to, type });
  }
  return pieces.map(piece => ({ ...piece, widthPct: (piece.end - piece.start) / (end - start) * 100 }));
}
