import test from 'node:test';
import assert from 'node:assert/strict';
import { duration, newestFirst, percentage, recentStats, sessionSettings, timeline } from '../src/progress.js';

test('recent sessions are newest first regardless of the API page transport order', () => {
  const rows = [{ id: 'old', endTime: 100, engagedPct: 50 }, { id: 'new', endTime: 200, engagedPct: 90 }];
  assert.deepEqual(newestFirst(rows).map(row => row.id), ['new', 'old']);
  assert.equal(rows[0].id, 'old');
  assert.equal(recentStats(rows).averageEngagement, 70);
});
test('zero is a real measurement; absent statistics and an empty history remain unknown', () => {
  assert.equal(percentage(0), '0%'); assert.equal(percentage(null), 'Not measured');
  assert.equal(duration(0), '0s'); assert.equal(duration(undefined), 'Not recorded');
  assert.deepEqual(recentStats([]), { recent: [], measuredCount: 0, averageEngagement: null });
  const result = recentStats([{ id: 'a', endTime: 1, engagedPct: null }, { id: 'b', endTime: 2, engagedPct: 0 }]);
  assert.equal(result.measuredCount, 1); assert.equal(result.averageEngagement, 0);
});
test('dashboard measures only the latest five, without turning missing values into zero', () => {
  const rows = Array.from({ length: 8 }, (_, i) => ({ id: String(i), endTime: i, engagedPct: i === 7 ? null : i * 10 }));
  assert.equal(recentStats(rows).averageEngagement, 45); assert.equal(recentStats(rows).measuredCount, 4);
});
test('timeline explicitly separates pause and unknown time, including unknown overlay within an event', () => {
  const start = 1000, session = {
    source: 'live', startTime: start, endTime: start + 100,
    events: [{ type: 'engaged', start: start + 10, end: start + 40 }, { type: 'distracted', start: start + 60, end: start + 100 }],
    activeSegments: [{ start, end: start + 40 }, { start: start + 60, end: start + 100 }],
    unclassifiedPeriods: [{ start, end: start + 10 }, { start: start + 70, end: start + 80 }],
  };
  assert.deepEqual(timeline(session).map(piece => [piece.type, piece.widthPct]), [['unclassified', 10], ['engaged', 30], ['paused', 20], ['distracted', 10], ['unclassified', 10], ['distracted', 20]]);
  assert.equal(timeline(session).reduce((sum, piece) => sum + piece.widthPct, 0), 100);
});
test('legacy summaries never receive a fabricated timeline and source arrays are unchanged', () => {
  const legacy = { source: 'legacy-summary', startTime: 1, endTime: 10, events: [], activeSegments: [] };
  assert.deepEqual(timeline(legacy), []);
  const row = { ...legacy, source: 'live', events: [{ type: 'engaged', start: 1, end: 10 }], activeSegments: [{ start: 1, end: 10 }], unclassifiedPeriods: [] };
  const before = JSON.stringify(row); assert.equal(timeline(row)[0].type, 'engaged'); assert.equal(JSON.stringify(row), before);
  assert.deepEqual(timeline({ ...row, endTime: 1 }), []);
});
test('missing imported settings never imply a phone policy, session goal, or ending', () => {
  assert.deepEqual(sessionSettings({ goalMinutes: null, phonePolicy: null, endReason: null }), { plan: 'Duration goal not recorded', policy: 'Phone policy not recorded', ending: 'Ending not recorded' });
});
