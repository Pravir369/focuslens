import test from "node:test";
import assert from "node:assert/strict";
import { classifyWithWindow } from "../js/window-fusion.js";
import { WindowSignal, WINDOW_FRESHNESS_MS } from "../js/window-signal.js";
import { StateMachine } from "../js/classifier.js";
import { EventLog } from "../js/event-log.js";
import { patternTip } from "../js/insights.js";

const face = { faceDetected: true, pose: { yaw: 0, pitch: 0 }, eyeClosedScore: .1 };
const zones = { screen: { yaw: 0, pitch: 0, yawTolerance: 15, pitchTolerance: 12 } };
const options = (now, present = false) => ({ phonePolicy: "phone-free", now, phoneSample: { capturedAt: now, present, boxes: [] } });

test("window fusion preserves no-face/unknown/eyes/calibration precedence and phone priority", () => {
  assert.equal(classifyWithWindow(face, zones, options(0), true).triggerSource, "window");
  assert.equal(classifyWithWindow(face, zones, options(0, true), true).triggerSource, "cameraA");
  assert.equal(classifyWithWindow({ ...face, faceDetected: false }, zones, options(0), true).state, "away");
  assert.equal(classifyWithWindow({ ...face, pose: null }, zones, options(0), true).state, null);
  assert.equal(classifyWithWindow({ ...face, eyeClosedScore: .8 }, zones, options(0), true).state, "eyes_closed");
  assert.equal(classifyWithWindow(face, null, options(0), true).state, null);
  assert.equal(classifyWithWindow(face, zones, { phonePolicy: "phone-allowed" }, true).state, "distracted");
  assert.equal(classifyWithWindow(face, zones, { phonePolicy: "phone-free", now: 0 }, true).state, "distracted");
  assert.equal(classifyWithWindow(face, zones, { phonePolicy: "phone-free", now: 0 }, false).state, null);
});
test("one existing dwell spans window/phone causes; source only tags the confirmation event", () => {
  const machine = new StateMachine(), log = new EventLog();
  for (let now = 0; now <= 3000; now += 100) {
    const observation = classifyWithWindow(face, zones, options(now, now < 1500), now >= 1500);
    const transition = machine.update(observation.state, now);
    if (transition) log.transition({ ...transition, triggerSource: observation.triggerSource });
  }
  assert.equal(log.events.length, 1); assert.equal(log.events[0].start, 3000); assert.equal(log.events[0].triggerSource, "window");
  assert.equal(patternTip(log.events).pattern, "window"); assert.doesNotMatch(patternTip(log.events).message, /phone-related/);
});
test("freshness, wrong profiles/sessions, pause/resume, and missing monitor degrade to no signal", async () => {
  let time = 1000, row;
  const calls = [];
  const signal = new WindowSignal("one", { now: () => time, setTimer: () => 1, clearTimer() {}, fetcher: async (url, options) => {
    calls.push({ url, options }); return { ok: true, json: async () => row };
  } });
  signal.sessionId = "s"; signal.enabled = signal.active = true; signal.reset();
  row = { profileId: "one", sessionId: "s", available: true, isOnTask: false, observedAt: 1000, appName: "Discord" };
  await signal.poll(); assert.equal(signal.offTask(), true);
  assert.equal(JSON.parse(calls[0].options.body).profileId, "one");
  time += WINDOW_FRESHNESS_MS; assert.equal(signal.offTask(), true); time++; assert.equal(signal.offTask(), false);
  signal.pause(); assert.equal(signal.offTask(), false);
  signal.resume(); await Promise.resolve(); await Promise.resolve();
  assert.equal(signal.offTask(), false); // Previous observation is older than reset.
  for (const changes of [{ profileId: "other" }, { sessionId: "old" }, { available: false }]) {
    row = { ...row, observedAt: time, ...changes }; await signal.poll(); assert.equal(signal.offTask(), false);
  }
  signal.dispose();
});
test("network failure and responses arriving after reset cannot pause or distract the camera classifier", async () => {
  let resolve;
  const signal = new WindowSignal("one", { now: () => 1000, setTimer: () => 1, clearTimer() {}, fetcher: async () => { throw new Error("Server unavailable"); } });
  signal.sessionId = "s"; signal.enabled = signal.active = true;
  await signal.poll(); assert.equal(signal.offTask(), false);
  signal.fetcher = () => new Promise((done) => { resolve = done; });
  const pending = signal.poll(); signal.reset();
  resolve({ ok: false }); await pending;
  assert.equal(signal.offTask(), false); signal.dispose();
});
