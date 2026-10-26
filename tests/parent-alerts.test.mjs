import test from 'node:test';
import assert from 'node:assert/strict';
import { ParentAlertObserver, PARENT_ALERT_MS } from '../js/parent-alerts.js';

const event = (start = 0) => ({ type: 'distracted', start, end: null, duration: null });
const session = () => ({ state: 'running', events: [event()] });
const tick = (observer, current, from, to) => { for (let at = from; at <= to; at += 100) observer.update(current, at, true); };
const flush = () => new Promise(resolve => setImmediate(resolve));

test('ten continuous minutes, one request per event, preserving existing event records', async () => {
  const sent = [], current = session(), original = structuredClone(current);
  const observer = new ParentAlertObserver(async (...args) => { sent.push(args); return { status: 'sending' }; });
  tick(observer, current, 0, PARENT_ALERT_MS - 100); await flush(); assert.equal(sent.length, 0);
  tick(observer, current, PARENT_ALERT_MS, PARENT_ALERT_MS + 5000); await flush();
  assert.equal(sent.length, 1); assert.deepEqual(sent[0][1], { eventStartMs: 0, distractionDurationMs: PARENT_ALERT_MS });
  assert.deepEqual(current, original);
  current.events[0].triggerSource = 'cameraB'; tick(observer, current, PARENT_ALERT_MS + 5100, 2 * PARENT_ALERT_MS); await flush(); assert.equal(sent.length, 1);
  current.events[0].end = 2 * PARENT_ALERT_MS; current.events.push(event(2 * PARENT_ALERT_MS));
  tick(observer, current, 2 * PARENT_ALERT_MS, 3 * PARENT_ALERT_MS); await flush(); assert.equal(sent.length, 2);
});

test('pause, away, drowsy, unknown and observation gaps cannot count as continuous distraction', async () => {
  for (const interruption of ['paused', 'away', 'drowsy', 'unknown', 'gap']) {
    const sent = [], current = session(), observer = new ParentAlertObserver(async () => sent.push(true));
    tick(observer, current, 0, 300000);
    if (interruption === 'paused') { current.state = 'paused'; observer.update(current, 300100, true); current.state = 'running'; }
    else if (interruption === 'away' || interruption === 'drowsy') { current.events.push({ ...event(300100), type: interruption }); observer.update(current, 300100, true); current.events.pop(); }
    else if (interruption === 'unknown') observer.update(current, 300100, false);
    tick(observer, current, 302000, 902000 - 100); await flush(); assert.equal(sent.length, 0, interruption);
    observer.update(current, 902000, true); await flush(); assert.equal(sent.length, 1, interruption);
  }
});

test('failures are not retried and paused or disposed pending work cannot send', async () => {
  let calls = 0; const current = session(), messages = [];
  const observer = new ParentAlertObserver(async () => { calls++; throw new Error('ambiguous timeout'); }, { notify: text => messages.push(text) });
  tick(observer, current, 0, 2 * PARENT_ALERT_MS); await flush(); assert.equal(calls, 1); assert.match(messages[0], /not be sent again/);
  for (const action of ['pause', 'dispose', 'unknown']) {
    const pending = session(), next = new ParentAlertObserver(async () => { calls++; });
    tick(next, pending, 0, PARENT_ALERT_MS);
    if (action === 'dispose') next.dispose();
    else { pending.state = action === 'pause' ? 'paused' : 'running'; next.update(pending, PARENT_ALERT_MS, false); }
    await flush(); assert.equal(calls, 1);
  }
});
