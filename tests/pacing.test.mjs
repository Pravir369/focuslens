import test from "node:test";
import assert from "node:assert/strict";
import { LocalProfile, PROFILE_KEY } from "../js/profile.js";
import { PacingStore, PACING_KEY, firstDistractionTime, suggestedMinutes } from "../js/pacing.js";

const memory = () => { const values = new Map(); return { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) }; };
const record = (minutes, profileId = "one") => ({ profileId, date: "2026-10-25T12:00:00Z", timeToFirstDistraction: minutes === null ? null : minutes * 60000 });
const ended = (events = []) => ({ state: "ended", startTime: 1000, endTime: 3601000, events });

test("profile ID is generated once and restored using the exact storage key", () => {
  const storage = memory(); let generated = 0;
  const profile = new LocalProfile(() => storage, () => { generated++; return "local-uuid"; });
  assert.equal(profile.getId(), "local-uuid"); assert.equal(profile.getId(), "local-uuid");
  assert.equal(storage.getItem(PROFILE_KEY), "local-uuid"); assert.equal(generated, 1);
  assert.equal(new LocalProfile(() => storage, () => { throw new Error("Should not generate"); }).getId(), "local-uuid");
});
test("blocked profile storage uses one in-memory ID without blocking sessions", () => {
  const profile = new LocalProfile(() => { throw new Error("Blocked"); }, () => "ephemeral");
  assert.equal(profile.getId(), "ephemeral"); assert.equal(profile.getId(), "ephemeral");
  assert.equal(profile.persistent, false); assert.match(profile.message, /until reload/);
});
test("first distraction uses confirmation minus session start, including pauses, and never mutates the log", () => {
  const session = ended(Object.freeze([Object.freeze({ type: "away", start: 1000 }), Object.freeze({ type: "distracted", start: 901000 }), Object.freeze({ type: "distracted", start: 1801000 })]));
  assert.equal(firstDistractionTime(session), 900000);
  assert.equal(firstDistractionTime(ended([{ type: "engaged", start: 1000 }])), null);
  assert.throws(() => firstDistractionTime({ ...session, state: "running" }), /ended/);
});
test("suggestion converts milliseconds to minutes, rounds to five, clamps, and selects upper median", () => {
  assert.equal(suggestedMinutes([record(13)], "one"), 15);
  assert.equal(suggestedMinutes([record(0)], "one"), 5);
  assert.equal(suggestedMinutes([record(70)], "one"), 45);
  assert.equal(suggestedMinutes([record(5), record(25), record(10), record(20)], "one"), 20);
  assert.equal(suggestedMinutes([record(12.5)], "one"), 15);
});
test("suggestions use this profile only and exclude sessions without distraction", () => {
  assert.equal(suggestedMinutes([], "one"), null);
  assert.equal(suggestedMinutes([record(null), record(40, "other")], "one"), null);
  assert.equal(suggestedMinutes([record(null), record(40, "other"), record(10)], "one"), 10);
});
test("pacing persists only the profile-scoped three-field record, including null for no distraction", () => {
  const storage = memory(), history = new PacingStore("one", () => storage);
  assert.equal(history.save(ended([{ type: "distracted", start: 601000 }])), true);
  assert.equal(history.save(ended()), true);
  const rows = JSON.parse(storage.getItem(PACING_KEY));
  assert.deepEqual(Object.keys(rows[0]), ["profileId", "date", "timeToFirstDistraction"]);
  assert.equal(rows[0].profileId, "one"); assert.equal(rows[0].timeToFirstDistraction, 600000); assert.equal(rows[1].timeToFirstDistraction, null);
  assert.equal(new PacingStore("one", () => storage).suggestion(), 10);
});
test("malformed or full pacing storage fails without overwriting history or breaking summaries", () => {
  const storage = memory(); storage.setItem(PACING_KEY, "{");
  const history = new PacingStore("one", () => storage);
  assert.equal(history.save(ended()), false); assert.equal(storage.getItem(PACING_KEY), "{");
  const full = memory(); full.setItem = () => { throw new Error("Full"); };
  const unavailable = new PacingStore("one", () => full);
  assert.equal(unavailable.save(ended()), false); assert.match(unavailable.message, /could not be saved/);
});
