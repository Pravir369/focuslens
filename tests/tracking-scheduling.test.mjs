import test from "node:test";
import assert from "node:assert/strict";
import { startTracking } from "../js/tracking.js";
import { StateMachine } from "../js/classifier.js";
import { createPhoneBitmap } from "../js/phone-tracker.js";
import { classificationFeedback } from "../js/classification-feedback.js";

function harness() {
  let next, hidden = false, cancelled = false;
  const video = { readyState: 2, currentTime: 0 };
  const inferred = [], videoFrames = [], gaps = [], errors = [], machine = new StateMachine();
  const stop = startTracking(video, { detectForVideo(source, at) { inferred.push(at); return {}; } }, {
    onFrame(frame, at) { machine.update("engaged", at); }, onVideoFrame(at) { videoFrames.push(at); },
    onGap(info) { gaps.push(info); }, onError(error) { errors.push(error); },
  }, { now: () => 0, requestFrame(callback) { next = callback; return 1; }, cancelFrame() { cancelled = true; }, isHidden: () => hidden });
  return { inferred, videoFrames, gaps, errors, machine, stop, get cancelled() { return cancelled; },
    hidden(value) { hidden = value; }, tick(at, advance = true) { if (advance) video.currentTime = at / 1000; next(at); } };
}

test("high-refresh display leaves time for phone inference and still confirms engagement after one second", () => {
  const run = harness();
  for (let now = 0; now <= 2100; now += 5) run.tick(now);
  assert.ok(run.inferred.length <= 31, `Unexpected ${run.inferred.length} inferences on a 200Hz display`);
  assert.ok(run.inferred.length >= 28);
  assert.equal(run.videoFrames.length, 421); // Phone sampling keeps its own four-per-second budget.
  assert.equal(run.machine.currentConfirmedState, "engaged");
  assert.equal(run.gaps.length, 0);
  assert.equal(run.errors.length, 0);
  run.stop(); assert.equal(run.cancelled, true);
});

test("throttled frames are not consumed; frozen video and hidden tabs still report gaps", () => {
  const run = harness();
  run.tick(0); run.tick(20); run.tick(70, false);
  assert.deepEqual(run.inferred, [0, 70]);
  assert.deepEqual(run.videoFrames, [0, 20]); // A frozen displayed frame cannot be sampled again.
  run.tick(600, false); run.tick(650, false);
  assert.deepEqual(run.gaps.map(info => info.reason), ["frames-stalled"]);
  run.tick(700); // One observed frame after the stall must not finish old dwell.
  assert.equal(run.machine.currentConfirmedState, null);
  run.hidden(true); run.tick(800); run.tick(900);
  assert.deepEqual(run.gaps.map(info => info.reason), ["frames-stalled", "hidden"]);
  assert.deepEqual(run.inferred, [0, 70, 700]);
  run.stop();
});

test("phone transfers bound HD/portrait images without cropping or upscaling", async () => {
  const calls = [], bitmap = {};
  const capture = async (...args) => { calls.push(args); return bitmap; };
  for (const [width, height, expected] of [[3840, 2160, [640, 360]], [1080, 1920, [270, 480]]]) {
    assert.equal(await createPhoneBitmap({ videoWidth: width, videoHeight: height }, capture), bitmap);
    const options = calls.at(-1)[1];
    assert.deepEqual([options.resizeWidth, options.resizeHeight], expected);
  }
  await createPhoneBitmap({ width: 320, height: 240 }, capture);
  assert.equal(calls.at(-1).length, 1);
});

test("waiting feedback distinguishes prerequisites, confirmation dwell, and stale phone evidence", () => {
  assert.match(classificationFeedback({ calibrated: false }), /Complete calibration/);
  assert.match(classificationFeedback({ calibrated: true, running: false }), /Start Session/);
  const base = { calibrated: true, running: true, confirmed: null };
  assert.match(classificationFeedback({ ...base, raw: "distracted", progress: { state: "distracted", elapsedMs: 1500, requiredMs: 3000 } }), /1.5 \/ 3.0 seconds/);
  assert.match(classificationFeedback({ ...base, raw: null, reason: "Waiting for fresh phone detection", waitingMs: 9000 }), /phone detection.*pause and reconnect/s);
  assert.equal(classificationFeedback({ ...base, confirmed: "engaged", raw: "engaged" }), "");
});
