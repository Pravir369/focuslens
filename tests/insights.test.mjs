import test from "node:test";
import assert from "node:assert/strict";
import { patternTip } from "../js/insights.js";

const phone = (triggerSource = "cameraA") => ({ type: "distracted", triggerSource });
const look = { type: "distracted" }, drowsy = { type: "drowsy" };

test("pattern tip combines both phone sources and counts confirmed events, not duration", () => {
  const events = [phone(), phone("cameraB"), { ...look, duration: 1e6 }, { type: "engaged" }, { type: "away" }];
  const tip = patternTip(events);
  assert.deepEqual(tip.counts, { phone: 2, lookAway: 1, drowsy: 0, window: 0 });
  assert.equal(tip.pattern, "phone");
  assert.equal(tip.message, "Most of today's lapses were phone-related. Try leaving it in another room next session.");
});
test("drowsy and look-away dominance use the specified fixed wording", () => {
  assert.equal(patternTip([drowsy, drowsy, phone(), look]).pattern, "drowsy");
  assert.equal(patternTip([drowsy]).message, "Several drowsy moments today — this might be a session-timing issue more than a focus issue. Try studying earlier, or take a short break before you start.");
  assert.equal(patternTip([look, look, phone(), drowsy]).pattern, "lookAway");
  assert.equal(patternTip([look]).message, "Most lapses were brief look-aways, not phone use — your attention drifted but came back on its own, which your recovery-speed number below reflects.");
});
test("all tie combinations follow phone, then drowsy, then look-away", () => {
  for (const events of [[phone(), drowsy, look], [phone(), drowsy], [phone(), look]]) assert.equal(patternTip(events).pattern, "phone");
  assert.equal(patternTip([drowsy, look]).pattern, "drowsy");
});
test("empty, engaged-only, and away-only sessions get the positive message without a tip", () => {
  for (const events of [[], [{ type: "engaged" }], [{ type: "away", duration: 100000 }]]) {
    assert.deepEqual(patternTip(events), { pattern: "none", counts: { phone: 0, lookAway: 0, drowsy: 0, window: 0 }, message: "No distractions logged this session." });
  }
});
test("pattern interpretation reads a frozen log without adding sources or inventing recoveries", () => {
  const events = Object.freeze([Object.freeze({ type: "distracted", start: 0, end: 60000, duration: 60000 }), Object.freeze({ type: "away" })]);
  const before = JSON.stringify(events);
  assert.equal(patternTip(events).pattern, "lookAway");
  assert.equal(JSON.stringify(events), before);
});
