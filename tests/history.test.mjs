import test from "node:test";
import assert from "node:assert/strict";
import { HistoryStore, HISTORY_KEY, HISTORY_LIMIT, summarizeSession, validateRecord, recoveryTrend } from "../js/history.js";
import { StudySession } from "../js/session.js";

const memory = () => {
  const values = new Map();
  return { values, getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: (key) => values.delete(key) };
};
function session(start = 0, recovery = true) {
  const value = new StudySession(); value.start(start);
  value.confirm({ from: null, to: "distracted", at: start + 3000 });
  if (recovery) value.confirm({ from: "distracted", to: "engaged", at: start + 8000 });
  value.end(start + 10000);
  return value;
}
test("history is opt-in and saves only whitelisted summary fields", () => {
  const storage = memory(); const history = new HistoryStore(() => storage);
  assert.equal(history.data.enabled, false); assert.equal(history.save(session()).saved, false);
  assert.equal(storage.getItem(HISTORY_KEY), null);
  history.setEnabled(true);
  assert.equal(history.save(session()).saved, true);
  const record = history.data.records[0];
  assert.equal(record.averageRecoveryMs, 5000); assert.equal(record.recoveryCount, 1);
  assert.deepEqual(Object.keys(record), ["id", "profileId", "startTime", "endTime", "goalMinutes", "goalEngagementPct", "phonePolicy", "endReason", "activeMs", "engagedPct", "averageRecoveryMs", "distractionCount", "recoveryCount", "longestDistractionMs"]);
  for (const forbidden of ["events", "pose", "calibration", "images", "activeSegments"]) assert.equal(Object.hasOwn(record, forbidden), false);
  const loaded = new HistoryStore(() => storage);
  assert.deepEqual(loaded.data, history.data);
  assert.throws(() => summarizeSession(new StudySession()), /ended/);
});
test("missing recoveries and empty classified time stay null rather than zero", () => {
  const value = session(0, false);
  assert.equal(summarizeSession(value).averageRecoveryMs, null);
  const empty = new StudySession(); empty.start(0); empty.end(0);
  const record = summarizeSession(empty);
  assert.equal(record.engagedPct, null); assert.equal(record.averageRecoveryMs, null); assert.equal(record.distractionCount, 0);
});
test("saved metrics preserve pause and missing-observation recovery exclusions", () => {
  const value = session();
  value.unclassifiedPeriods.push({ start: 4000, end: 5000 });
  assert.equal(summarizeSession(value).averageRecoveryMs, null);
  const paused = new StudySession(); paused.start(0);
  paused.confirm({ from: null, to: "distracted", at: 3000 }); paused.pause(6000); paused.resume(10000);
  paused.confirm({ from: null, to: "engaged", at: 11000 }); paused.end(12000);
  assert.equal(summarizeSession(paused).averageRecoveryMs, null);
  assert.equal(summarizeSession(paused).activeMs, 8000);
});
test("disabling saves keeps history; clear deletes records and disables future saving", () => {
  const storage = memory(); const history = new HistoryStore(() => storage);
  history.setEnabled(true); history.save(session()); history.setEnabled(false);
  history.save(session(20000)); assert.equal(history.data.records.length, 1);
  assert.equal(history.clear(), true); assert.equal(storage.getItem(HISTORY_KEY), null);
  assert.equal(new HistoryStore(() => storage).data.enabled, false);
});
test("records are chronological, bounded, and saves reread other tabs' changes", () => {
  const storage = memory(); const first = new HistoryStore(() => storage); first.setEnabled(true);
  const second = new HistoryStore(() => storage);
  second.save(session(20000)); first.save(session(0));
  assert.deepEqual(first.data.records.map((record) => record.startTime), [0, 20000]);
  for (let i = 2; i <= HISTORY_LIMIT + 2; i++) second.save(session(i * 20000));
  assert.equal(second.data.records.length, HISTORY_LIMIT);
  assert.equal(second.data.records[0].startTime, 60000);
  first.setEnabled(false); assert.equal(second.save(session(9e6)).saved, false);
});
test("malformed or unsupported stored data is not silently overwritten", () => {
  const storage = memory();
  for (const raw of ["{", "null", '{"version":2,"enabled":true,"records":[]}', '{"version":1,"enabled":true,"records":[{}]}']) {
    storage.setItem(HISTORY_KEY, raw);
    const history = new HistoryStore(() => storage);
    assert.equal(history.available, false); assert.equal(history.setEnabled(true), false);
    assert.equal(history.save(session()).saved, false); assert.equal(storage.getItem(HISTORY_KEY), raw);
    assert.equal(history.clear(), true); assert.equal(history.available, true);
  }
});
test("untrusted records are range-checked and unexpected properties stripped", () => {
  const record = summarizeSession(session());
  for (const changes of [{ engagedPct: 101 }, { averageRecoveryMs: -1 }, { recoveryCount: 2 }, { startTime: -1 }, { activeMs: Infinity }, { endTime: 1 }, { phonePolicy: "other" }, { goalMinutes: "25" }, { averageRecoveryMs: null }]) {
    assert.equal(validateRecord({ ...record, ...changes }), null);
  }
  assert.equal(Object.hasOwn(validateRecord({ ...record, images: "secret" }), "images"), false);
});
test("blocked access, full storage, and deletion failures leave sessions usable", () => {
  const blocked = new HistoryStore(() => { throw new Error("SecurityError"); });
  assert.equal(blocked.available, false); assert.equal(blocked.save(session()).saved, false);
  assert.equal(blocked.clear(), false);
  const storage = memory(); const history = new HistoryStore(() => storage); history.setEnabled(true);
  storage.setItem = () => { throw new Error("QuotaExceededError"); };
  assert.equal(history.save(session()).saved, false);
  assert.equal(history.data.records.length, 0); assert.match(history.message, /blocked or full/);
});
test("trend compares first and latest qualifying recovery and skips null values", () => {
  const records = (values) => values.map((averageRecoveryMs) => ({ averageRecoveryMs }));
  assert.equal(recoveryTrend(records([null, 3000, null])).direction, "waiting");
  assert.deepEqual(recoveryTrend(records([6000, null, 2000, null])), { direction: "faster", count: 2, differenceMs: 4000 });
  assert.equal(recoveryTrend(records([2000, 6000])).direction, "slower");
  assert.equal(recoveryTrend(records([2000, 2020])).direction, "steady");
  assert.equal(recoveryTrend(records([1000, 0])).direction, "faster");
});
test("profile-scoped history migrates legacy summaries and preserves other profiles on save and clear", () => {
  const storage = memory();
  const legacy = summarizeSession(session(), "legacy", "one"); delete legacy.profileId;
  const other = summarizeSession(session(20000), "other", "two");
  storage.setItem(HISTORY_KEY, JSON.stringify({ version: 1, enabled: true, records: [legacy, other] }));
  const history = new HistoryStore(() => storage, "one");
  assert.deepEqual(history.data.records.map(row => [row.id, row.profileId]), [["legacy", "one"]]);
  assert.equal(history.save(session(40000)).saved, true);
  const persisted = JSON.parse(storage.getItem(HISTORY_KEY)).records;
  assert.ok(persisted.every(row => ["one", "two"].includes(row.profileId)));
  assert.equal(new HistoryStore(() => storage, "two").data.records.length, 1);
  assert.equal(history.clear(), true);
  assert.deepEqual(JSON.parse(storage.getItem(HISTORY_KEY)).records, [other]);
});
