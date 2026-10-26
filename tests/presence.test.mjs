import test from 'node:test';
import assert from 'node:assert/strict';
import { readPersonResult, personEvidence } from '../js/presence.js';
import { classifyObservation, StateMachine } from '../js/classifier.js';
import { createPhoneDetector } from '../js/phone-model.js';
import { EventLog } from '../js/event-log.js';

const detection = (score, name = 'person', box = { originX: 64, originY: 48, width: 320, height: 384 }) =>
  ({ categories: [{ categoryName: name, score }], boundingBox: box });
const sample = (present, at = 1000) => ({ person: { present, capturedAt: at, confidence: present ? .8 : null, boxes: [] } });

test('presence has its own confidence boundary and ignores phones and invalid boxes', () => {
  const read = detections => readPersonResult({ detections }, 640, 480, 1000);
  assert.equal(read([detection(.449)]).present, false);
  assert.equal(read([detection(.45)]).present, true);
  assert.equal(read([detection(.9, 'cell phone')]).present, false);
  assert.equal(read([detection(.9, 'person', null)]).present, false);
  assert.equal(read([detection(.9, 'person', { originX: NaN, originY: 0, width: 2, height: 2 })]).present, false);
  const result = read([detection(.45), detection(.9)]);
  assert.equal(result.confidence, .9);
  assert.deepEqual(result.boxes[0], { x: .1, y: .1, width: .5, height: .8, confidence: .45 });
  assert.equal(readPersonResult({}, 0, 480, 1000).present, null);
});

test('fresh absence is distinct from missing/stale/future evidence', () => {
  assert.equal(personEvidence(sample(true), 1750).status, 'present');
  assert.equal(personEvidence(sample(false), 1750).status, 'absent');
  assert.equal(personEvidence(sample(true), 1751).status, 'unknown');
  assert.equal(personEvidence(sample(false), 1751).status, 'unknown');
  assert.equal(personEvidence(sample(true), 999).status, 'unknown');
  assert.equal(personEvidence(null, 1000).status, 'unknown');
  assert.equal(personEvidence({ present: true, capturedAt: 1000 }, 1000).status, 'unknown');
});

const zones = { screen: { yaw: 0, pitch: 0, yawTolerance: 15, pitchTolerance: 12 }, notes: { yaw: 0, pitch: 30, yawTolerance: 15, pitchTolerance: 12 } };
const face = { faceDetected: true, pose: { yaw: 0, pitch: 0 }, eyeClosedScore: .1 };
const missingFace = { faceDetected: false, pose: null, eyeClosedScore: null };
const objects = (person, at = 1000, phone = false) => ({ ...sample(person, at), capturedAt: at, present: phone, confidence: phone ? .8 : null, boxes: [] });
const classify = (frame, person, extra = {}) => classifyObservation(frame, zones, {
  phonePolicy: 'phone-free', presenceEnabled: true, phoneSample: objects(person), now: 1000, ...extra,
});

test('a person without face landmarks is distracted; an empty Camera A is away', () => {
  assert.equal(classify(missingFace, true).state, 'distracted');
  assert.match(classify(missingFace, true).reason, /person still present/);
  assert.equal(classify(missingFace, false).state, 'away');
  assert.equal(classify(missingFace, false, { deskPhoneSample: objects(true, 1000, true) }).state, 'away');
  assert.equal(classify(missingFace, true, { phoneSample: null }).state, null);
  assert.equal(classify(missingFace, true, { now: 1751 }).state, null);
  assert.equal(classifyObservation(missingFace, null, { presenceEnabled: true, phoneSample: objects(true), now: 1000 }).state, null);
});

test('visible-face pose/eye precedence remains, and phone-allowed ignores phone detections', () => {
  assert.equal(classify(face, false).state, 'engaged'); // Face itself proves presence.
  assert.equal(classify({ ...face, pose: null }, true).state, null);
  assert.equal(classify({ ...face, eyeClosedScore: .8 }, true).state, 'eyes_closed');
  assert.equal(classify(face, true, { phonePolicy: 'phone-allowed', phoneSample: objects(true, 1000, true) }).state, 'engaged');
  assert.equal(classify(missingFace, true, { phonePolicy: 'phone-allowed' }).state, 'distracted');
  // An explicit legacy path remains available for clients without presence.
  assert.equal(classify(missingFace, true, { presenceEnabled: false }).state, 'away');
});

test('pose look-away continues through face loss with one three-second dwell and unchanged event records', () => {
  const machine = new StateMachine(), log = new EventLog();
  const feed = (frame, person, at) => {
    const raw = classify(frame, person, { phoneSample: objects(person, at), now: at }).state;
    const transition = machine.update(raw, at); if (transition) log.transition(transition);
  };
  for (let at = 0; at <= 1000; at += 100) feed(face, true, at);
  for (let at = 1100; at <= 2000; at += 100) feed({ ...face, pose: { yaw: 45, pitch: 0 } }, true, at);
  for (let at = 2100; at <= 4100; at += 100) feed(missingFace, true, at);
  assert.equal(machine.currentConfirmedState, 'distracted'); assert.equal(log.events[1].start, 4100);
  assert.deepEqual(log.events.map(row => row.type), ['engaged', 'distracted']);
  for (let at = 4200; at <= 5200; at += 100) feed(missingFace, false, at);
  assert.equal(machine.currentConfirmedState, 'away');
  for (let at = 5300; at <= 6300; at += 100) feed(face, true, at);
  assert.equal(machine.currentConfirmedState, 'engaged');
  assert.deepEqual(Object.keys(log.events.at(-1)), ['type', 'start', 'end', 'duration']);
});

test('unknown person evidence resets pending away/distraction dwell', () => {
  const machine = new StateMachine();
  for (let at = 0; at <= 2000; at += 100) machine.update(classify(missingFace, true, { phoneSample: objects(true, at), now: at }).state, at);
  machine.update(classify(missingFace, true, { phoneSample: null, now: 2100 }).state, 2100);
  assert.equal(machine.candidateState, null); assert.equal(machine.currentConfirmedState, null);
  for (let at = 2200; at <= 5100; at += 100) machine.update(classify(missingFace, true, { phoneSample: objects(true, at), now: at }).state, at);
  assert.equal(machine.currentConfirmedState, null);
  machine.update(classify(missingFace, true, { phoneSample: objects(true, 5200), now: 5200 }).state, 5200);
  assert.equal(machine.currentConfirmedState, 'distracted');
});

test('one VIDEO object detector returns both categories without lowering the phone decision threshold', async () => {
  let configurations = [];
  await createPhoneDetector({ FilesetResolver: { forVisionTasks: async () => ({}) }, ObjectDetector: {
    createFromOptions: async (fileset, config) => { configurations.push(config); return {}; },
  } }, { fetcher: async () => ({ ok: true, arrayBuffer: async () => new Uint8Array([1]).buffer }) });
  assert.equal(configurations.length, 1);
  assert.deepEqual(configurations[0].categoryAllowlist, ['cell phone', 'person']);
  assert.equal(configurations[0].runningMode, 'VIDEO'); assert.equal(configurations[0].scoreThreshold, .45);
});
