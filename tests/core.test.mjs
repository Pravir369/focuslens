import test from "node:test";
import assert from "node:assert/strict";
import { matrixToEulerAngles, angleDifference, meanAngle } from "../js/pose.js";
import { classifyFrame, inZone, StateMachine } from "../js/classifier.js";
import { Calibration } from "../js/calibration.js";
import { EventLog } from "../js/event-log.js";
import { readFrame } from "../js/tracking.js";

const zones = {
  screen: { yaw: 0, pitch: 0, yawTolerance: 15, pitchTolerance: 12 },
  notes: { yaw: 0, pitch: 30, yawTolerance: 15, pitchTolerance: 12 },
};
const frame = (yaw = 0, pitch = 0) => ({
  faceDetected: true, pose: { yaw, pitch, roll: 0 }, eyeClosedScore: 0.1,
});
const noFace = { faceDetected: false, pose: null, eyeClosedScore: null };
const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-6, `${actual} ≈ ${expected}`);

// Construct independent known Rz * Ry * Rx rotations, stored column-major,
// with scale and translation so extraction must ignore both correctly.
function matrix(yaw, pitch, roll, scale = 1) {
  const [y, p, r] = [yaw, pitch, roll].map((a) => a * Math.PI / 180);
  const [cy, sy, cp, sp, cr, sr] = [Math.cos(y), Math.sin(y), Math.cos(p), Math.sin(p), Math.cos(r), Math.sin(r)];
  return { rows: 4, columns: 4, data: [
    cr * cy * scale, sr * cy * scale, -sy * scale, 0,
    (cr * sy * sp - sr * cp) * scale, (sr * sy * sp + cr * cp) * scale, cy * sp * scale, 0,
    (cr * sy * cp + sr * sp) * scale, (sr * sy * cp - cr * sp) * scale, cy * cp * scale, 0,
    12, -8, -40, 1,
  ] };
}

test("pose extraction: identity, signed axes, mixed rotations, scale, translation", () => {
  for (const [yaw, pitch, roll] of [[0, 0, 0], [25, 0, 0], [-25, 0, 0], [0, 30, 0], [0, -30, 0], [0, 0, -20], [37, -24, 18]]) {
    const pose = matrixToEulerAngles(matrix(yaw, pitch, roll, 1.8));
    near(pose.yaw, yaw); near(pose.pitch, pitch); near(pose.roll, roll);
  }
  for (const yaw of [-90, 90]) {
    const pose = matrixToEulerAngles(matrix(yaw, 10, 0));
    near(pose.yaw, yaw);
    assert.ok(Object.values(pose).every(Number.isFinite));
  }
  assert.equal(matrixToEulerAngles(null), null);
  assert.equal(matrixToEulerAngles({ rows: 4, columns: 4, data: Array(16).fill(0) }), null);
  const invalid = matrix(0, 0, 0); invalid.data[1] = NaN;
  assert.equal(matrixToEulerAngles(invalid), null);
});

test("rectangular study zones include boundaries and wrap angles", () => {
  assert.equal(inZone({ yaw: 15, pitch: 12 }, zones.screen), true);
  assert.equal(inZone({ yaw: 15.01, pitch: 12 }, zones.screen), false);
  assert.equal(inZone({ yaw: 15, pitch: 12.01 }, zones.screen), false);
  assert.equal(inZone({ yaw: -179, pitch: 0 }, { ...zones.screen, yaw: 179 }), true);
  near(angleDifference(-179, 179), 2);
  near(Math.abs(meanAngle([179, -179])), 180);
});

test("raw priority: no face, closed eyes, either study zone, distraction", () => {
  assert.equal(classifyFrame(noFace, zones), "away");
  assert.equal(classifyFrame({ ...frame(40), eyeClosedScore: 0.61 }, zones), "eyes_closed");
  assert.equal(classifyFrame({ ...frame(), eyeClosedScore: 0.6 }, zones), "engaged");
  assert.equal(classifyFrame(frame(), zones), "engaged");
  assert.equal(classifyFrame(frame(0, 30), zones), "engaged");
  assert.equal(classifyFrame(frame(40), zones), "distracted");
  assert.equal(classifyFrame(frame(), null), null);
  assert.equal(classifyFrame({ ...frame(), pose: null }, zones), null);
  assert.equal(classifyFrame({ ...frame(), eyeClosedScore: null }, zones), null);
});

function hold(machine, raw, start, duration, interval = 100) {
  const transitions = [];
  for (let now = start; now <= start + duration; now += interval) {
    const transition = machine.update(raw, now);
    if (transition) transitions.push(transition);
  }
  return transitions;
}

test("initial waiting and asymmetric dwell commit at confirmation time", () => {
  const machine = new StateMachine();
  assert.equal(machine.currentConfirmedState, null);
  assert.deepEqual(hold(machine, "engaged", 0, 900), []);
  assert.deepEqual(machine.update("engaged", 1000), { from: null, to: "engaged", at: 1000 });
  assert.deepEqual(hold(machine, "distracted", 1100, 2900), []);
  assert.equal(machine.currentConfirmedState, "engaged");
  assert.deepEqual(machine.update("distracted", 4100), { from: "engaged", to: "distracted", at: 4100 });
  assert.deepEqual(hold(machine, "engaged", 4200, 900), []);
  assert.deepEqual(machine.update("engaged", 5200), { from: "distracted", to: "engaged", at: 5200 });
});

test("brief blink, glance, and dropout never commit; any change restarts dwell", () => {
  const machine = new StateMachine(); hold(machine, "engaged", 0, 1000);
  hold(machine, "distracted", 1100, 2000);
  machine.update("eyes_closed", 3200);
  hold(machine, "distracted", 3300, 2900);
  assert.equal(machine.currentConfirmedState, "engaged");
  machine.update("engaged", 6300);
  hold(machine, "away", 6400, 800);
  machine.update("engaged", 7300);
  hold(machine, "eyes_closed", 7400, 800);
  machine.update("engaged", 8300);
  assert.equal(machine.currentConfirmedState, "engaged");
  assert.equal(machine.candidateState, null);
});

test("away and drowsy entry/exit use each destination's threshold", () => {
  const machine = new StateMachine(); hold(machine, "engaged", 0, 1000);
  assert.equal(hold(machine, "away", 1100, 1000).at(-1).to, "away");
  assert.deepEqual(hold(machine, "distracted", 2200, 2900), []);
  assert.equal(machine.update("distracted", 5200).to, "distracted");
  assert.equal(hold(machine, "eyes_closed", 5300, 1000).at(-1).to, "drowsy");
  assert.equal(hold(machine, "away", 6400, 1000).at(-1).to, "away");
  assert.equal(hold(machine, "eyes_closed", 7500, 1000).at(-1).to, "drowsy");
  assert.equal(hold(machine, "engaged", 8600, 1000).at(-1).to, "engaged");
});

test("suspension, stalled frames, and unusable readings cannot satisfy dwell", () => {
  const machine = new StateMachine();
  hold(machine, "engaged", 0, 900);
  assert.equal(machine.update("engaged", 6000), null);
  assert.equal(machine.candidateStateSince, 6000);
  assert.equal(hold(machine, "engaged", 6100, 900).at(-1).at, 7000);
  hold(machine, "distracted", 7100, 2000);
  machine.resetCandidate(); // visibilitychange handler
  assert.equal(machine.update("distracted", 9200), null);
  assert.equal(machine.candidateStateSince, 9200);
  machine.update(null, 9300);
  assert.equal(machine.candidateState, null);
  assert.equal(machine.currentConfirmedState, "engaged");
});

function captureStep(calibration, now, poseFrame, invalidCount = 0) {
  const duration = calibration.progress(now).durationMs;
  let update;
  for (let i = 0; i <= duration / 100; i++) {
    update = calibration.addFrame(i < invalidCount ? noFace : poseFrame, now + i * 100);
  }
  return { update, next: now + duration + 100 };
}

test("three calibration steps average valid poses, validate side glance, and stay in memory", () => {
  const calibration = new Calibration(); calibration.start();
  let now = captureStep(calibration, 0, frame(), 5).next; // 46/51 valid > 90%
  now = captureStep(calibration, now, frame(0, 30), 5).next;
  const { update } = captureStep(calibration, now, frame(40), 3); // 28/31 > 90%
  assert.equal(update.complete, true);
  near(calibration.result.screen.yaw, 0);
  near(calibration.result.notes.pitch, 30);
  assert.equal(calibration.result.screen.yawTolerance, 15);
  assert.equal(calibration.result.screen.pitchTolerance, 12);
  assert.equal(calibration.steps.screen.validFrames, 46);
  assert.equal(calibration.active, false);
  calibration.start();
  assert.equal(calibration.result, null);
  assert.deepEqual(calibration.steps, {});
});

test("calibration rejects a step below 90%, no face, and overlapping side glance", () => {
  const calibration = new Calibration(); calibration.start();
  assert.match(captureStep(calibration, 0, frame(), 6).update.error, /90% required/);
  assert.equal(calibration.result, null);
  calibration.start();
  assert.match(captureStep(calibration, 0, noFace).update.error, /0.0% valid/);
  calibration.start();
  let now = captureStep(calibration, 0, frame()).next;
  now = captureStep(calibration, now, frame(0, 30)).next;
  assert.match(captureStep(calibration, now, frame(5)).update.error, /overlaps/);
  assert.equal(calibration.result, null);
});

test("calibration accepts exactly 90% and rejects interrupted processing", () => {
  const calibration = new Calibration(); calibration.start();
  // Exactly 100 processed frames distributed over 5000ms, with 10 misses.
  for (let i = 0; i < 100; i++) calibration.addFrame(i < 10 ? noFace : frame(), i * 5000 / 99);
  assert.equal(calibration.steps.screen.validRatio, 0.9);
  assert.equal(calibration.stepIndex, 1);
  calibration.start();
  calibration.addFrame(frame(), 0);
  assert.match(calibration.addFrame(frame(), 2000).error, /interrupted/);
  assert.equal(calibration.active, false);
});

test("event records contain only confirmed transitions, close cleanly, retain destination order", () => {
  const machine = new StateMachine();
  const log = new EventLog();
  const feed = (raw, start, duration) => hold(machine, raw, start, duration).forEach((transition) => log.transition(transition));
  feed("engaged", 0, 1000);
  feed("distracted", 1100, 2900);
  assert.equal(log.events.length, 1);
  feed("distracted", 4100, 0);
  feed("away", 4200, 1000);
  feed("distracted", 5300, 3000);
  feed("engaged", 8400, 1000);
  assert.deepEqual(log.events.map((event) => event.type), ["engaged", "distracted", "away", "distracted", "engaged"]);
  assert.deepEqual(log.events[0], { type: "engaged", start: 1000, end: 4100, duration: 3100 });
  assert.equal(log.events[1].end, log.events[2].start); // distraction ending in away stays in log
  assert.equal(log.events.at(-1).end, null);
  log.close(9500);
  assert.equal(log.events.at(-1).duration, 100);
  log.close(10000);
  assert.equal(log.events.at(-1).end, 9500);
});

test("MediaPipe output adapter handles empty output and exact blendshape names", () => {
  assert.equal(readFrame({}).faceDetected, false);
  const read = readFrame({
    faceLandmarks: [[{ x: 0.5, y: 0.5 }]],
    facialTransformationMatrixes: [matrix(20, -10, 5)],
    faceBlendshapes: [{ categories: [
      { categoryName: "eyeBlinkLeft", score: 0.8 },
      { categoryName: "eyeBlinkRight", score: 0.6 },
    ] }],
  });
  near(read.eyeClosedScore, 0.7);
  near(read.pose.yaw, 20);
  assert.equal(classifyFrame(read, zones), "eyes_closed");
  assert.equal(readFrame({ faceLandmarks: [[{}]] }).eyeClosedScore, null);
});
