import test from "node:test";
import assert from "node:assert/strict";
import { StudySession, sessionMetrics, sessionTimeline, goalFeedback } from "../js/session.js";
import { DistractionNudges } from "../js/nudges.js";
import { AudioCues } from "../js/audio.js";
import { formatCountdown, formatDuration } from "../js/summary.js";

const confirm = (session, from, to, at) => session.confirm({ from, to, at });

test("session defaults and goal validation", () => {
  const session = new StudySession();
  assert.equal(session.goalMinutes, 25); assert.equal(session.goalEngagementPct, 80);
  assert.equal(session.phonePolicy, "phone-free");
  assert.equal(session.durationMs, 1500000);
  for (const goalMinutes of [0, -1, NaN, Infinity, Number.MAX_VALUE, "25"]) assert.throws(() => new StudySession({ goalMinutes }));
  for (const goalEngagementPct of [-1, 101, NaN]) assert.throws(() => new StudySession({ goalEngagementPct }));
  session.start(0);
  assert.throws(() => session.start(1), /already started/);
});

test("countdown freezes during pause and completion closes at the exact active-time deadline", () => {
  const session = new StudySession({ goalMinutes: 1 });
  session.start(0); confirm(session, null, "engaged", 1000);
  session.pause(10000, "Hidden tab");
  assert.equal(session.remainingMs(30000), 50000);
  assert.equal(session.events[0].end, 10000);
  session.resume(30000); confirm(session, null, "engaged", 31000);
  assert.equal(session.advance(79999), false);
  assert.equal(session.advance(90000), true);
  assert.equal(session.endTime, 80000);
  assert.equal(session.events.at(-1).end, 80000);
  assert.equal(session.remainingMs(90000), 0);
  assert.equal(session.elapsedMs(90000), 60000);
  assert.equal(session.endReason, "completed");
  assert.equal(session.advance(100000), false);
});

test("pause at or after deadline completes rather than creating a resumable session", () => {
  const session = new StudySession({ goalMinutes: 1 }); session.start(0);
  assert.equal(session.pause(60010), false);
  assert.equal(session.state, "ended"); assert.equal(session.endTime, 60000);
  assert.equal(session.resume(70000), false);
  assert.equal(session.end(70000), false);
});

test("only direct recoveries inside one active segment count; pause boundaries do not", () => {
  const session = new StudySession(); session.start(0);
  confirm(session, null, "engaged", 1000);
  confirm(session, "engaged", "distracted", 5000);
  confirm(session, "distracted", "engaged", 9000);
  session.pause(10000); session.resume(20000);
  confirm(session, null, "distracted", 23000);
  session.pause(25000); session.resume(30000);
  confirm(session, null, "engaged", 31000); session.end(34000);
  const metrics = sessionMetrics(session);
  assert.equal(metrics.distractionCount, 2);
  assert.equal(metrics.recoveryCount, 1);
  assert.equal(metrics.averageRecoveryMs, 4000);
  assert.equal(metrics.longestDistractionMs, 4000);
  assert.equal(metrics.totals.engaged, 8000);
  assert.equal(metrics.classifiedMs, 14000);
  assert.equal(session.elapsedMs(34000), 19000);
  assert.ok(Math.abs(metrics.engagedPct - 8000 / 14000 * 100) < 1e-9);
  assert.deepEqual(Object.keys(session.events[0]), ["type", "start", "end", "duration"]);
});

test("away excluded from denominator; drowsy included; neither ends a distraction as recovery", () => {
  const session = new StudySession(); session.start(0);
  confirm(session, null, "engaged", 1000);
  confirm(session, "engaged", "distracted", 2000);
  confirm(session, "distracted", "away", 5000);
  confirm(session, "away", "distracted", 8000);
  confirm(session, "distracted", "drowsy", 11000);
  confirm(session, "drowsy", "engaged", 12000); session.end(13000);
  const metrics = sessionMetrics(session);
  assert.equal(metrics.recoveryCount, 0); assert.equal(metrics.averageRecoveryMs, null);
  assert.equal(metrics.totals.away, 3000); assert.equal(metrics.totals.drowsy, 1000);
  assert.equal(metrics.classifiedMs, 9000); assert.equal(metrics.totals.engaged, 2000);
});

test("unclassified readings neither inflate engagement nor produce a recovery across missing evidence", () => {
  const session = new StudySession(); session.start(0);
  session.observe(true, 100); // Still waiting for first confirmed state.
  assert.equal(sessionMetrics(session, 500).engagedPct, null);
  confirm(session, null, "engaged", 1000);
  confirm(session, "engaged", "distracted", 3000);
  session.observe(false, 5000); session.observe(false, 5500);
  session.observe(true, 7000);
  confirm(session, "distracted", "engaged", 9000); session.end(10000);
  const metrics = sessionMetrics(session);
  assert.equal(metrics.recoveryCount, 0); assert.equal(metrics.averageRecoveryMs, null);
  assert.equal(metrics.classifiedMs, 7000); assert.equal(metrics.totals.engaged, 3000);
  assert.equal(metrics.longestDistractionMs, 4000);
  assert.deepEqual(session.unclassifiedPeriods, [{ start: 0, end: 1000 }, { start: 5000, end: 7000 }]);
  assert.equal(session.events.length, 3); // Raw unknown readings add no events.
});

test("early ending closes distraction without inventing a recovery; no-data summaries stay null", () => {
  const session = new StudySession(); session.start(0); confirm(session, null, "distracted", 3000); session.end(7000);
  assert.equal(sessionMetrics(session).averageRecoveryMs, null);
  assert.equal(sessionMetrics(session).engagedPct, 0);
  assert.equal(session.events.at(-1).duration, 4000);
  const empty = new StudySession(); empty.start(0); empty.end(0);
  assert.equal(sessionMetrics(empty).engagedPct, null);
  assert.equal(sessionMetrics(empty).distractionCount, 0);
  assert.deepEqual(sessionTimeline(empty), []);
  const away = new StudySession(); away.start(0); confirm(away, null, "away", 1000); away.end(10000);
  assert.equal(sessionMetrics(away).engagedPct, null);
});

test("ending while paused does not charge paused time or reopen the final event", () => {
  const session = new StudySession(); session.start(100); confirm(session, null, "engaged", 1100);
  session.pause(5100); session.end(20100);
  assert.equal(session.events[0].end, 5100); assert.equal(session.elapsedMs(20100), 5000);
  assert.equal(sessionMetrics(session).totals.engaged, 4000);
  assert.equal(sessionTimeline(session).at(-1).type, "paused");
});

test("timeline covers wall time once and visibly separates pauses and unknown observations", () => {
  const session = new StudySession(); session.start(0); confirm(session, null, "engaged", 1000);
  session.observe(false, 2000); session.observe(true, 3000);
  session.pause(4000); session.resume(6000); confirm(session, null, "away", 7000); session.end(8000);
  const spans = sessionTimeline(session);
  assert.deepEqual(spans.map((span) => span.type), ["unclassified", "engaged", "unclassified", "engaged", "paused", "unclassified", "away"]);
  assert.equal(spans.reduce((sum, span) => sum + span.duration, 0), 8000);
  for (let i = 1; i < spans.length; i++) assert.equal(spans[i - 1].end, spans[i].start);
});

test("goal boundary: at goal passes, exactly ten points below is near, further below is below", () => {
  assert.equal(goalFeedback(80, 80).outcome, "pass");
  assert.equal(goalFeedback(100, 80).outcome, "pass");
  assert.equal(goalFeedback(70, 80).outcome, "near");
  assert.equal(goalFeedback(69.99, 80).outcome, "below");
  assert.equal(goalFeedback(null, 80).outcome, "waiting");
});

test("nudges fire once per confirmed distraction at 15s and 45s; dismiss does not force state", () => {
  const nudges = new DistractionNudges();
  const event = { type: "distracted", start: 1000, end: null };
  assert.deepEqual(nudges.update(event, 15999), []);
  assert.deepEqual(nudges.update(event, 16000), [1]);
  assert.deepEqual(nudges.update(event, 17000), []);
  assert.deepEqual(nudges.update(event, 46000), [2]);
  assert.equal(nudges.bannerVisible, true);
  nudges.dismiss(); assert.equal(nudges.bannerVisible, false);
  assert.equal(event.type, "distracted");
  assert.deepEqual(nudges.update(event, 100000), []);
  const next = { type: "distracted", start: 100000, end: null };
  assert.deepEqual(nudges.update(next, 115000), [1]);
});

test("no cues during away/drowsy/paused/unknown readings; delayed ticks avoid stacked cues", () => {
  const nudges = new DistractionNudges();
  for (const type of ["away", "drowsy", "engaged"]) assert.deepEqual(nudges.update({ type, start: 0, end: null }, 60000), []);
  const event = { type: "distracted", start: 0, end: null };
  assert.deepEqual(nudges.update(event, 60000, false), []);
  assert.deepEqual(nudges.update(event, 60000, true, false), []);
  assert.deepEqual(nudges.update(event, 60000), [2]);
  assert.deepEqual(nudges.update(event, 60001), []);
  event.end = 61000;
  assert.deepEqual(nudges.update(event, 62000), []);
  assert.equal(nudges.bannerVisible, false);
});

function fakeContext() {
  const oscillators = []; const gains = [];
  const param = () => ({ points: [], setValueAtTime(value, at) { this.points.push([value, at]); }, linearRampToValueAtTime(value, at) { this.points.push([value, at]); } });
  return {
    state: "suspended", currentTime: 10, destination: {}, oscillators, gains,
    async resume() { this.state = "running"; }, async close() { this.state = "closed"; },
    createOscillator() { const node = { frequency: param(), starts: [], stops: [], connect() {}, disconnect() { this.disconnected = true; }, start(at) { this.starts.push(at); }, stop(at) { this.stops.push(at); } }; oscillators.push(node); return node; },
    createGain() { const node = { gain: param(), connect() {}, disconnect() { this.disconnected = true; } }; gains.push(node); return node; },
  };
}

test("audio unlocks explicitly and synthesizes the specified sine cues with gain envelopes", async () => {
  const context = fakeContext(); const cues = new AudioCues(() => context);
  assert.equal(cues.play(1), false);
  assert.equal(await cues.unlock(), true);
  assert.equal(cues.play(1), true); assert.equal(cues.play(2), true);
  assert.deepEqual(context.oscillators.map((node) => node.frequency.points[0][0]), [440, 440, 554]);
  assert.ok(context.oscillators.every((node) => node.type === "sine"));
  assert.deepEqual(context.gains.map((node) => Math.max(...node.gain.points.map(([value]) => value))), [0.08, 0.15, 0.15]);
  assert.equal(context.oscillators[2].starts[0], 10.2);
  assert.equal(context.oscillators[0].stops[0], 10.16);
  cues.cancel(); assert.equal(cues.voices.size, 0);
  assert.ok(context.oscillators.every((node) => node.disconnected));
  await cues.close(); assert.equal(context.state, "closed");
});

test("audio permission/device failures do not throw into tracking", async () => {
  const disabled = new AudioCues(() => { throw new Error("Unavailable"); });
  assert.equal(await disabled.unlock(), false); assert.equal(disabled.play(2), false);
  const context = fakeContext(); context.createOscillator = () => { throw new Error("Device lost"); };
  const cues = new AudioCues(() => context); await cues.unlock();
  assert.equal(cues.play(1), false);
});

test("duration/countdown formatting avoids early zero and preserves useful recovery precision", () => {
  assert.equal(formatCountdown(60000), "01:00"); assert.equal(formatCountdown(1), "00:01");
  assert.equal(formatCountdown(0), "00:00"); assert.equal(formatDuration(1250), "1.3 s");
  assert.equal(formatDuration(61500), "1 m 1.5 s");
});
