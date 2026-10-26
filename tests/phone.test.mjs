import test from "node:test";
import assert from "node:assert/strict";
import { classifyFrame, classifyObservation, StateMachine } from "../js/classifier.js";
import { EventLog } from "../js/event-log.js";
import { phoneEvidence, readPhoneResult, mirroredPhoneBox } from "../js/phone.js";
import { PhoneTracker } from "../js/phone-tracker.js";
import { atStage, loadModelBuffer } from "../js/loading.js";
import { createLandmarker } from "../js/tracking.js";
import { createPhoneDetector } from "../js/phone-model.js";
import { installWorkerRuntimeImport } from "../js/worker-runtime.js";

const calibration = {
  screen: { yaw: 0, pitch: 0, yawTolerance: 15, pitchTolerance: 12 },
  notes: { yaw: 0, pitch: 30, yawTolerance: 15, pitchTolerance: 12 },
};
const face = { faceDetected: true, pose: { yaw: 0, pitch: 0, roll: 0 }, eyeClosedScore: 0.1 };
const sample = (present, capturedAt) => ({ present, capturedAt, confidence: present ? 0.8 : null, boxes: [] });
const options = (present, now = 1000) => ({ phonePolicy: "phone-free", phoneSample: sample(present, now), now });

test("phone-free overrides either study zone; phone-allowed needs no model/evidence", () => {
  assert.equal(classifyFrame(face, calibration, options(true)), "distracted");
  assert.equal(classifyFrame({ ...face, pose: { yaw: 0, pitch: 30 } }, calibration, options(true)), "distracted");
  assert.equal(classifyFrame(face, calibration, options(false)), "engaged");
  assert.equal(classifyFrame(face, calibration, { ...options(true), phonePolicy: "phone-allowed" }), "engaged");
  assert.equal(classifyFrame(face, calibration, { phonePolicy: "phone-allowed" }), "engaged");
  assert.match(classifyObservation(face, calibration, options(true)).reason, /Visible phone/);
});

test("no face, invalid face, eyes closed, and calibration retain their precedence", () => {
  assert.equal(classifyFrame({ ...face, faceDetected: false }, calibration, options(true)), "away");
  assert.equal(classifyFrame({ ...face, pose: null }, calibration, options(true)), null);
  assert.equal(classifyFrame({ ...face, eyeClosedScore: 0.8 }, calibration, options(true)), "eyes_closed");
  assert.equal(classifyFrame({ ...face, eyeClosedScore: 0.8 }, calibration, { phonePolicy: "phone-free" }), "eyes_closed");
  assert.equal(classifyFrame(face, null, options(true)), null);
});

test("freshness boundaries: absent/present results expire, missing/future readings are unknown", () => {
  assert.equal(phoneEvidence(sample(true, 1000), 1750).status, "present");
  assert.equal(phoneEvidence(sample(false, 1000), 1750).status, "absent");
  assert.equal(phoneEvidence(sample(false, 1000), 1751).status, "unknown");
  assert.equal(phoneEvidence(sample(true, 1000), 1751).status, "unknown");
  assert.deepEqual(phoneEvidence({ ...sample(true, 1000), boxes: [{ x: 0 }] }, 1751).boxes, []);
  assert.equal(phoneEvidence(sample(true, 1000), 999).status, "unknown");
  assert.equal(phoneEvidence(null, 1000).status, "unknown");
  assert.equal(phoneEvidence({ capturedAt: 1000 }, 1000).status, "unknown");
  assert.equal(classifyFrame(face, calibration, { ...options(false, 1000), now: 1751 }), null);
  assert.equal(classifyFrame(face, calibration, { phonePolicy: "phone-free", now: 1000 }), null);
});

test("phone threshold is inclusive; unrelated objects ignored; boxes normalized and mirrored", () => {
  const detection = (score, categoryName = "cell phone") => ({
    categories: [{ score, categoryName }], boundingBox: { originX: 64, originY: 48, width: 128, height: 96 },
  });
  assert.equal(readPhoneResult({ detections: [detection(0.549)] }, 640, 480, 0).present, false);
  assert.equal(readPhoneResult({ detections: [detection(0.9, "book")] }, 640, 480, 0).present, false);
  const result = readPhoneResult({ detections: [detection(0.55), detection(0.9)] }, 640, 480, 100);
  assert.equal(result.confidence, 0.9);
  assert.equal(result.present, true);
  for (const [key, expected] of Object.entries({ x: 0.1, y: 0.1, width: 0.2, height: 0.2, confidence: 0.55 })) {
    assert.ok(Math.abs(result.boxes[0][key] - expected) < 1e-8);
  }
  const mirrored = mirroredPhoneBox(result.boxes[0], 640, 480);
  assert.ok(Math.abs(mirrored.x - 448) < 1e-8);
  assert.ok(Math.abs(mirrored.width - 128) < 1e-8);
  assert.equal(readPhoneResult({}, 640, 480, 0).present, false);
});

test("one distraction debounce covers phone + head-pose evidence; confirmed events stay unchanged", () => {
  const machine = new StateMachine();
  const log = new EventLog();
  function feed(pose, phone, now) {
    const transition = machine.update(classifyFrame(pose, calibration, options(phone, now)), now);
    if (transition) log.transition(transition);
  }
  for (let now = 0; now <= 1000; now += 100) feed(face, false, now);
  for (let now = 1100; now <= 2000; now += 100) feed(face, true, now);
  assert.equal(machine.currentConfirmedState, "engaged"); // brief phone appearance
  feed(face, false, 2100);
  for (let now = 2200; now <= 4100; now += 100) feed(face, true, now);
  const side = { ...face, pose: { yaw: 40, pitch: 0 } };
  for (let now = 4200; now <= 5200; now += 100) feed(side, false, now);
  assert.equal(log.events.at(-1).type, "distracted");
  assert.equal(log.events.at(-1).start, 5200); // 3s total, no restart when reason changed
  for (let now = 5300; now <= 6300; now += 100) feed(face, false, now);
  assert.deepEqual(log.events.map((event) => event.type), ["engaged", "distracted", "engaged"]);
  assert.deepEqual(Object.keys(log.events[1]), ["type", "start", "end", "duration"]);
  assert.equal(log.events[1].duration, 1100);
});

test("stale phone absence resets recovery candidate rather than confirming engagement", () => {
  const machine = new StateMachine();
  for (let now = 0; now <= 3000; now += 100) machine.update(classifyFrame(face, calibration, options(true, now)), now);
  for (let now = 3100; now <= 3800; now += 100) {
    machine.update(classifyFrame(face, calibration, { phonePolicy: "phone-free", phoneSample: sample(false, 3100), now }), now);
  }
  machine.update(classifyFrame(face, calibration, { phonePolicy: "phone-free", phoneSample: sample(false, 3100), now: 3900 }), 3900);
  assert.equal(machine.candidateState, null);
  assert.equal(machine.currentConfirmedState, "distracted");
  for (let now = 4000; now <= 5000; now += 100) machine.update(classifyFrame(face, calibration, options(false, now)), now);
  assert.equal(machine.currentConfirmedState, "engaged");
});

class FakeWorker {
  constructor() { this.messages = []; this.terminated = false; }
  postMessage(message, transfers) { this.messages.push({ message, transfers }); }
  terminate() { this.terminated = true; }
  emit(data) { this.onmessage({ data }); }
}
function setupTracker(overrides = {}) {
  const worker = new FakeWorker();
  const tracker = new PhoneTracker({ workerFactory: () => worker, ...overrides });
  return { worker, tracker };
}
async function readyTracker(overrides) {
  const setup = setupTracker(overrides);
  const ready = setup.tracker.start();
  setup.worker.emit({ type: "ready" });
  await ready;
  return setup;
}

test("sampling throttles to four per second and permits one capture/inference in flight", async () => {
  let resolveBitmap;
  const bitmap = { close() {} };
  const { worker, tracker } = await readyTracker({ makeBitmap: () => new Promise((resolve) => { resolveBitmap = resolve; }) });
  const first = tracker.sample({}, 1000);
  assert.equal(await tracker.sample({}, 2000), false); // capture still pending
  resolveBitmap(bitmap); await first;
  assert.equal(await tracker.sample({}, 2000), false); // worker still pending
  const request = worker.messages.at(-1).message;
  assert.equal(request.type, "frame");
  assert.deepEqual(worker.messages.at(-1).transfers, [bitmap]);
  worker.emit({ type: "result", id: request.id, generation: request.generation, sample: sample(false, 1000) });
  assert.equal(await tracker.sample({}, 1249), false);
  tracker.invalidate();
  assert.equal(await tracker.sample({}, 1249), false); // reset must not bypass rate limit
  const next = tracker.sample({}, 1250);
  resolveBitmap(bitmap); await next;
  assert.equal(worker.messages.filter((entry) => entry.message.type === "frame").length, 2);
  tracker.stop();
  assert.equal(worker.terminated, true);
});

test("invalidation rejects old results, blocks duplicate requests, and stop closes late local bitmap", async () => {
  const { worker, tracker } = await readyTracker({ makeBitmap: async () => ({ close() {} }) });
  await tracker.sample({}, 1000);
  const request = worker.messages.at(-1).message;
  tracker.invalidate();
  assert.equal(await tracker.sample({}, 2000), false);
  worker.emit({ type: "result", id: request.id, generation: request.generation, sample: sample(true, 1000) });
  assert.equal(tracker.latest, null);
  let resolveBitmap;
  let closed = false;
  tracker.makeBitmap = () => new Promise((resolve) => { resolveBitmap = resolve; });
  const pending = tracker.sample({}, 2000);
  tracker.stop();
  resolveBitmap({ close() { closed = true; } });
  await pending;
  assert.equal(closed, true);
  assert.equal(tracker.latest, null);
  assert.equal(worker.terminated, true);
});

test("worker startup errors, explicit stop, timeout, and inference errors release resources", async () => {
  const { worker, tracker } = setupTracker();
  const failed = assert.rejects(tracker.start(), { stage: "phone-model" });
  worker.emit({ type: "error", stage: "phone-model", message: "Phone model download failed: HTTP 404. Retry." });
  await failed;
  assert.equal(worker.terminated, true);
  const pending = setupTracker();
  const stopped = assert.rejects(pending.tracker.start(), { name: "AbortError" });
  pending.tracker.stop(); await stopped;
  let timeout;
  const timed = setupTracker({ setTimer: (callback) => { timeout = callback; return 1; }, clearTimer() {} });
  const timedOut = assert.rejects(timed.tracker.start(), /timed out/);
  timeout(); await timedOut;
  assert.equal(timed.worker.terminated, true);
  let inferenceError;
  const active = await readyTracker({ onError(error) { inferenceError = error; } });
  active.worker.emit({ type: "error", stage: "phone-inference", message: "Inference failed" });
  assert.equal(inferenceError.stage, "phone-inference");
  assert.equal(active.worker.terminated, true);
});

test("capture/transfer failures close locally owned bitmap and terminate worker", async () => {
  let closed = false;
  let failure;
  const { worker, tracker } = await readyTracker({
    makeBitmap: async () => ({ close() { closed = true; } }),
    onError: (error) => { failure = error; },
  });
  worker.postMessage = () => { throw new Error("Transfer failed"); };
  await tracker.sample({}, 1000);
  assert.equal(closed, true);
  assert.equal(worker.terminated, true);
  assert.equal(failure.stage, "phone-inference");
});

test("loading failures retain library/runtime/face-model/phone-model stages", async () => {
  await assert.rejects(atStage("library", async () => { throw new Error("Blocked"); }), { stage: "library" });
  const unavailable = async () => ({ ok: false, status: 503 });
  for (const stage of ["face-model", "phone-model"]) {
    await assert.rejects(loadModelBuffer("https://example.invalid", stage, { fetcher: unavailable }), { stage });
  }
  await assert.rejects(createLandmarker({ FilesetResolver: { forVisionTasks() { throw new Error("No WASM"); } } }), { stage: "runtime" });
  const fileset = { FilesetResolver: { forVisionTasks: async () => ({}) } };
  await assert.rejects(createLandmarker(fileset, { fetcher: unavailable }), { stage: "face-model" });
  await assert.rejects(createPhoneDetector(fileset, { fetcher: unavailable }), { stage: "phone-model" });
  const fetcher = async () => ({ ok: true, arrayBuffer: async () => new Uint8Array([1]).buffer });
  await assert.rejects(createPhoneDetector({ ...fileset, ObjectDetector: { createFromOptions() { throw new Error("Bad runtime"); } } }, { fetcher }), { stage: "runtime" });
});

test("module-worker runtime bridge captures the loader export and restores globals", async () => {
  const scope = {};
  const factory = () => {};
  installWorkerRuntimeImport(scope, async () => { scope.module.exports = factory; });
  assert.equal(typeof scope.custom_dbg, "function");
  await scope.import("https://example.invalid/runtime.js");
  assert.equal(scope.ModuleFactory, factory);
  assert.equal("module" in scope, false);
  assert.equal("exports" in scope, false);
  const originalModule = {};
  scope.module = originalModule;
  installWorkerRuntimeImport(scope, async () => { throw new Error("Blocked runtime"); });
  await assert.rejects(scope.import("runtime.js"), /Blocked runtime/);
  assert.equal(scope.module, originalModule);
  assert.equal("exports" in scope, false);
});
