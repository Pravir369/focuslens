import test from "node:test";
import assert from "node:assert/strict";
import { DeskCamera, listDeskCameras } from "../js/desk-camera.js";
import { PhoneTracker } from "../js/phone-tracker.js";
import { classifyObservation, StateMachine } from "../js/classifier.js";
import { StudySession, sessionMetrics } from "../js/session.js";
import { summarizeSession } from "../js/history.js";

const zones = { screen: { yaw: 0, pitch: 0, yawTolerance: 15, pitchTolerance: 12 }, notes: { yaw: 0, pitch: 30, yawTolerance: 15, pitchTolerance: 12 } };
const face = { faceDetected: true, pose: { yaw: 0, pitch: 0 }, eyeClosedScore: 0.1 };
const evidence = (present, capturedAt = 1000) => ({ present, capturedAt, confidence: present ? 0.8 : null, boxes: [] });
const classify = (a, b, now = 1000, frame = face, phonePolicy = "phone-free") => classifyObservation(frame, zones, { phonePolicy, phoneSample: a, deskPhoneSample: b, now });

test("either camera overrides study zones; A wins ties and face/eye precedence is unchanged", () => {
  assert.equal(classify(evidence(false), evidence(true)).triggerSource, "cameraB");
  assert.equal(classify(evidence(true), evidence(false)).triggerSource, "cameraA");
  assert.equal(classify(evidence(true), evidence(true)).triggerSource, "cameraA");
  assert.equal(classify(null, evidence(true)).state, "distracted");
  assert.equal(classify(evidence(false), evidence(true), 1000, { ...face, pose: { yaw: 0, pitch: 30 } }).state, "distracted");
  assert.equal(classify(evidence(false), evidence(true), 1000, { ...face, faceDetected: false }).state, "away");
  assert.equal(classify(evidence(false), evidence(true), 1000, { ...face, pose: null }).state, null);
  assert.equal(classify(evidence(false), evidence(true), 1000, { ...face, eyeClosedScore: 0.8 }).state, "eyes_closed");
  assert.equal(classify(evidence(true), evidence(true), 1000, face, "phone-allowed").state, "engaged");
});

test("B is optional: missing, stale, future, and failing readings do not block A or prove A absence", () => {
  for (const b of [null, evidence(true, 0), evidence(true, 1001), { get capturedAt() { throw new Error("Desk failure"); } }]) {
    assert.equal(classify(evidence(false), b).state, "engaged");
    assert.equal(classify(null, b).state, null);
  }
  assert.equal(classify(evidence(false), evidence(true, 250)).state, "distracted");
  assert.equal(classify(evidence(false), evidence(true, 249)).state, "engaged");
});

test("switching camera/pose causes uses a single debounce; source describes confirmation, not a new event", () => {
  const machine = new StateMachine(), session = new StudySession(); session.start(0);
  const feed = (now, a, b, pose = face) => {
    const observation = classify(evidence(a, now), evidence(b, now), now, pose);
    const transition = machine.update(observation.state, now);
    if (transition) session.confirm({ ...transition, triggerSource: observation.triggerSource });
  };
  for (let at = 0; at <= 1000; at += 100) feed(at, false, false);
  for (let at = 1100; at <= 2000; at += 100) feed(at, true, false);
  for (let at = 2100; at <= 3000; at += 100) feed(at, false, false, { ...face, pose: { yaw: 45, pitch: 0 } });
  for (let at = 3100; at <= 4100; at += 100) feed(at, false, true);
  assert.equal(session.events.length, 2); assert.equal(session.events[1].start, 4100);
  assert.equal(session.events[1].triggerSource, "cameraB");
  for (let at = 4200; at <= 4500; at += 100) feed(at, true, false);
  assert.equal(session.events.length, 2); assert.equal(session.events[1].triggerSource, "cameraB");
  for (let at = 4600; at <= 5600; at += 100) feed(at, false, false);
  session.end(6000);
  assert.equal(sessionMetrics(session).averageRecoveryMs, 1500);
  assert.deepEqual(Object.keys(session.events[2]), ["type", "start", "end", "duration"]);
  assert.equal(Object.hasOwn(summarizeSession(session), "triggerSource"), false);
});

function cameraFixture(options = {}) {
  const ended = [];
  const track = { readyState: "live", stopped: false, getSettings: () => ({ deviceId: "desk" }), addEventListener: (name, cb) => ended.push(cb), stop() { this.stopped = true; } };
  const stream = { getTracks: () => [track], getVideoTracks: () => [track] };
  const video = { currentTime: 0, readyState: 2, srcObject: null, pause() {}, async play() {} };
  const messages = [];
  let failures = 0, constraints;
  const camera = new DeskCamera(video, { getMedia: async (value) => { constraints = value; return stream; }, onStatus: (message) => messages.push(message), onUnavailable: () => failures++, ...options });
  return { camera, video, track, stream, ended, messages, get constraints() { return constraints; }, get failures() { return failures; } };
}

test("device list excludes Camera A, microphones, and missing IDs; labels have a fallback", async () => {
  const list = await listDeskCameras("front", { enumerateDevices: async () => [
    { kind: "videoinput", deviceId: "front", label: "Face" }, { kind: "audioinput", deviceId: "mic" },
    { kind: "videoinput", deviceId: "desk", label: "USB" }, { kind: "videoinput", deviceId: "other", label: "" }, { kind: "videoinput", deviceId: "" },
  ] });
  assert.deepEqual(list, [{ id: "desk", label: "USB" }, { id: "other", label: "Camera 2" }]);
});

test("desk opens exact device without audio; only advancing video frames count as fresh", async () => {
  const f = cameraFixture(); await f.camera.start("desk", "front");
  assert.deepEqual(f.constraints.video.deviceId, { exact: "desk" }); assert.equal(f.constraints.audio, false);
  assert.equal(f.camera.frame(100), null);
  f.video.currentTime = 1;
  assert.equal(f.camera.frame(100).capturedAt, 100);
  assert.equal(f.camera.frame(850).capturedAt, 100);
  assert.equal(f.camera.frame(851), null);
  f.video.currentTime = 2; assert.equal(f.camera.frame(900).capturedAt, 900);
  f.camera.resetFrames(); assert.equal(f.camera.frame(1000), null);
  f.camera.stop(); assert.equal(f.track.stopped, true); assert.equal(f.video.srcObject, null);
});

test("same physical camera, denial, ended tracks, and reading errors affect B only", async () => {
  const same = cameraFixture(); await assert.rejects(same.camera.start("front", "front"), /different/);
  await assert.rejects(same.camera.start("alias", "desk"), /physical/); assert.equal(same.track.stopped, true);
  const denied = cameraFixture({ getMedia: async () => { throw new Error("Permission denied"); } });
  await assert.rejects(denied.camera.start("desk", "front"), /Permission/); assert.equal(denied.failures, 1);
  const f = cameraFixture(); await f.camera.start("desk", "front"); f.ended[0]();
  assert.equal(f.camera.stream, null); assert.match(f.messages.at(-1), /Camera A is still running/);
  const broken = cameraFixture(); await broken.camera.start("desk", "front");
  Object.defineProperty(broken.video, "readyState", { get() { throw new Error("Video failed"); } });
  assert.equal(broken.camera.frame(1000), null); assert.equal(broken.failures, 1);
  const brokenClock = cameraFixture(); await brokenClock.camera.start("desk", "front");
  Object.defineProperty(brokenClock.video, "currentTime", { get() { throw new Error("Video clock failed"); } });
  assert.equal(brokenClock.camera.frame(1000), null); assert.equal(brokenClock.failures, 1);
});

test("stop during permission/play prevents late streams from attaching or leaking", async () => {
  let resolve;
  const f = cameraFixture({ getMedia: () => new Promise((done) => { resolve = done; }) });
  const pending = f.camera.start("desk", "front"); f.camera.stop(); resolve(f.stream);
  assert.equal(await pending, false); assert.equal(f.track.stopped, true); assert.equal(f.video.srcObject, null);
  const playing = cameraFixture(); playing.video.play = () => new Promise((done) => { resolve = done; });
  const loading = playing.camera.start("desk", "front"); await Promise.resolve(); playing.camera.stop(); resolve();
  assert.equal(await loading, false); assert.equal(playing.track.stopped, true);
});

async function sharedTracker(options = {}) {
  const worker = { messages: [], postMessage(message) { this.messages.push(message); }, terminate() { this.terminated = true; }, emit(data) { this.onmessage({ data }); } };
  let workers = 0;
  const tracker = new PhoneTracker({ workerFactory: () => { workers++; return worker; }, makeBitmap: async () => ({ close() {} }), ...options });
  const ready = tracker.start(); worker.emit({ type: "ready" }); await ready;
  const complete = (present = false) => { const m = worker.messages.at(-1); worker.emit({ type: "result", id: m.id, generation: m.generation, source: m.source, sample: evidence(present, m.capturedAt) }); };
  return { tracker, worker, complete, get workers() { return workers; } };
}

test("one worker alternates A/B within a shared four-per-second budget and ordered inference clock", async () => {
  const f = await sharedTracker(); const desk = { video: {}, capturedAt: 900 };
  await f.tracker.sampleNext({}, desk, 1000); f.complete();
  assert.equal(await f.tracker.sampleNext({}, desk, 1249), false);
  await f.tracker.sampleNext({}, desk, 1250); f.complete(true);
  await f.tracker.sampleNext({}, desk, 1500); f.complete();
  const frames = f.worker.messages.filter((message) => message.type === "frame");
  assert.deepEqual(frames.map((message) => message.source), ["cameraA", "cameraB", "cameraA"]);
  assert.deepEqual(frames.map((message) => message.inferenceAt), [1000, 1250, 1500]);
  assert.equal(frames[1].capturedAt, 900); assert.equal(f.tracker.deskLatest.present, true); assert.equal(f.tracker.latest.present, false);
  assert.equal(f.workers, 1); assert.equal(f.worker.messages.filter((message) => message.type === "init").length, 1);
  f.tracker.stop();
});

test("dropping B rejects its late results without invalidating A or allowing concurrent requests", async () => {
  const f = await sharedTracker(); await f.tracker.sample({}, 1000); f.complete();
  await f.tracker.sample({}, 1250, "cameraB"); f.tracker.invalidateSource("cameraB");
  assert.equal(await f.tracker.sample({}, 1500), false); f.complete(true);
  assert.equal(f.tracker.deskLatest, null); assert.equal(f.tracker.latest.present, false);
  await f.tracker.sample({}, 1500); f.complete(); assert.equal(f.tracker.ready, true);
  f.tracker.invalidate(); assert.equal(f.tracker.latest, null); assert.equal(f.tracker.deskLatest, null); f.tracker.stop();
});

test("B capture/worker inference errors are isolated and A can keep using the same model", async () => {
  let error;
  const f = await sharedTracker({ onSourceError: (value) => { error = value; } });
  f.tracker.makeBitmap = async () => { throw new Error("Desk capture failed"); };
  assert.equal(await f.tracker.sample({}, 1000, "cameraB"), false);
  assert.equal(f.tracker.ready, true); assert.equal(f.worker.terminated, undefined); assert.match(error.message, /Desk capture/);
  f.tracker.makeBitmap = async () => ({ close() {} });
  await f.tracker.sample({}, 1250, "cameraB"); const request = f.worker.messages.at(-1);
  f.worker.emit({ type: "error", id: request.id, generation: request.generation, source: "cameraB", stage: "phone-inference", message: "Desk inference failed" });
  assert.equal(f.tracker.inFlight, false); assert.equal(f.tracker.ready, true); assert.equal(f.tracker.deskLatest, null);
  await f.tracker.sample({}, 1500); f.complete(); assert.equal(f.tracker.latest.present, false);
  f.tracker.stop();
});

test("late B errors after interruption are ignored and transferred/cancelled images are cleaned", async () => {
  let resolve, closed = 0, errors = 0;
  const f = await sharedTracker({ onSourceError: () => errors++ });
  await f.tracker.sample({}, 1000, "cameraB"); const request = f.worker.messages.at(-1);
  f.tracker.invalidate();
  f.worker.emit({ type: "error", id: request.id, source: "cameraB", generation: request.generation, message: "Old B error" });
  assert.equal(errors, 0); assert.equal(f.tracker.ready, true);
  f.tracker.makeBitmap = () => new Promise((done) => { resolve = done; });
  const pending = f.tracker.sample({}, 1250, "cameraB"); f.tracker.invalidateSource("cameraB");
  resolve({ close() { closed++; } }); await pending;
  assert.equal(closed, 1); assert.equal(f.tracker.inFlight, false); f.tracker.stop();
});
