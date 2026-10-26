import { DWELL_MS, EYE_CLOSED_THRESHOLD, MAX_FRAME_GAP_MS } from "./config.js";
import { angleDifference } from "./pose.js";
import { phoneEvidence } from "./phone.js";
import { personEvidence } from './presence.js';

export function inZone(pose, zone) {
  return Boolean(pose && zone
    && Math.abs(angleDifference(pose.yaw, zone.yaw)) <= zone.yawTolerance
    && Math.abs(angleDifference(pose.pitch, zone.pitch)) <= zone.pitchTolerance);
}

export function classifyObservation(frame, calibration, { phonePolicy = "phone-allowed", phoneSample = null, deskPhoneSample = null, presenceEnabled = false, now } = {}) {
  if (!frame.faceDetected) {
    // Landmarks often disappear in profile. In the presence-enabled path,
    // distinguish a seated person from an empty view instead of inventing a
    // break whenever the face tracker loses the direction of the face.
    if (presenceEnabled) {
      if (!calibration) return { state: null, reason: 'Calibration required' };
      const person = personEvidence(phoneSample, now);
      if (person.status === 'unknown') return { state: null, reason: 'Face not visible · waiting for fresh person detection' };
      if (person.status === 'present') return { state: 'distracted', reason: 'Face not visible · person still present in Camera A' };
      return { state: 'away', reason: 'No face or person detected in Camera A' };
    }
    return { state: "away", reason: "No face detected" };
  }
  // Missing pose/blendshapes is an unusable sample, not evidence of distraction.
  if (!frame.pose || !Number.isFinite(frame.eyeClosedScore)) return { state: null, reason: "Waiting for usable face readings" };
  if (frame.eyeClosedScore > EYE_CLOSED_THRESHOLD) return { state: "eyes_closed", reason: "Eyes closed" };
  if (!calibration) return { state: null, reason: "Calibration required" };
  if (phonePolicy === "phone-free") {
    const phone = phoneEvidence(phoneSample, now);
    // B is optional positive evidence only. Missing/stale B never establishes
    // phone absence or blocks Camera A. A's required freshness rule remains.
    let deskPresent = false;
    try { deskPresent = phoneEvidence(deskPhoneSample, now).status === "present"; } catch { /* Ignore a failed optional input. */ }
    if (phone.status === "present") return { state: "distracted", reason: "Visible phone · Camera A (phone-free mode)", triggerSource: "cameraA" };
    if (deskPresent) return { state: "distracted", reason: "Visible phone · Camera B (desk camera)", triggerSource: "cameraB" };
    if (phone.status === "unknown") return { state: null, reason: "Waiting for fresh phone detection" };
  }
  const engaged = inZone(frame.pose, calibration.screen) || inZone(frame.pose, calibration.notes);
  return { state: engaged ? "engaged" : "distracted", reason: engaged ? "Inside a study zone" : "Outside both study zones" };
}

// Optional phone arguments preserve the original face-only API for callers
// that explicitly do not need phone evidence. The app passes its selected policy.
export function classifyFrame(frame, calibration, options) {
  return classifyObservation(frame, calibration, options).state;
}

export class StateMachine {
  constructor() { this.reset(); }

  reset() {
    this.currentConfirmedState = null;
    this.lastFrameAt = null;
    this.resetCandidate();
  }

  resetCandidate() {
    this.candidateState = null;
    this.candidateStateSince = null;
  }

  update(rawState, now) {
    if (!Number.isFinite(now)) throw new Error("A monotonic frame timestamp is required.");
    if (this.lastFrameAt !== null
      && (now - this.lastFrameAt > MAX_FRAME_GAP_MS || now < this.lastFrameAt)) {
      this.resetCandidate();
    }
    this.lastFrameAt = now;
    if (rawState === null) {
      this.resetCandidate();
      return null;
    }
    const target = rawState === "eyes_closed" ? "drowsy" : rawState;
    if (!(target in DWELL_MS)) throw new Error(`Unknown raw state: ${rawState}`);
    if (target === this.currentConfirmedState) {
      this.resetCandidate();
      return null;
    }
    if (target !== this.candidateState) {
      this.candidateState = target;
      this.candidateStateSince = now;
    }
    if (now - this.candidateStateSince < DWELL_MS[target]) return null;
    const transition = { from: this.currentConfirmedState, to: target, at: now };
    this.currentConfirmedState = target;
    this.resetCandidate();
    return transition;
  }

  candidateProgress(now) {
    return this.candidateState === null ? null : {
      state: this.candidateState,
      elapsedMs: Math.max(0, now - this.candidateStateSince),
      requiredMs: DWELL_MS[this.candidateState],
    };
  }
}
