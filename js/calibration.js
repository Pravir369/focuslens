import {
  CALIBRATION_MIN_VALID_RATIO, CALIBRATION_STEPS,
  YAW_TOLERANCE_DEG, PITCH_TOLERANCE_DEG, MAX_FRAME_GAP_MS,
} from "./config.js";
import { meanAngle } from "./pose.js";
import { inZone } from "./classifier.js";

export class Calibration {
  constructor() { this.reset(); }

  reset() {
    this.active = false;
    this.stepIndex = 0;
    this.stepStartedAt = null;
    this.lastFrameAt = null;
    this.samples = [];
    this.totalFrames = 0;
    this.steps = {};
    this.result = null;
    this.error = null;
  }

  start() {
    this.reset();
    this.active = true;
  }

  fail(message) {
    this.active = false;
    this.result = null;
    this.error = message;
    return { error: message };
  }

  addFrame(frame, now) {
    if (!this.active) return null;
    if (this.lastFrameAt !== null && now - this.lastFrameAt > MAX_FRAME_GAP_MS) {
      return this.fail("Camera processing was interrupted. Keep this tab visible and retry calibration.");
    }
    this.lastFrameAt = now;
    this.stepStartedAt ??= now;
    this.totalFrames++;
    if (frame.faceDetected && frame.pose) this.samples.push(frame.pose);

    const step = CALIBRATION_STEPS[this.stepIndex];
    if (now - this.stepStartedAt < step.durationMs) return null;
    const validRatio = this.samples.length / this.totalFrames;
    if (validRatio < CALIBRATION_MIN_VALID_RATIO) {
      return this.fail(`No face detected often enough during “${step.instruction}” (${(validRatio * 100).toFixed(1)}% valid; 90% required). Adjust your camera and try again.`);
    }
    this.steps[step.key] = {
      yaw: meanAngle(this.samples.map((pose) => pose.yaw)),
      pitch: meanAngle(this.samples.map((pose) => pose.pitch)),
      validFrames: this.samples.length,
      totalFrames: this.totalFrames,
      validRatio,
    };
    this.stepIndex++;
    if (this.stepIndex < CALIBRATION_STEPS.length) {
      this.stepStartedAt = null;
      this.samples = [];
      this.totalFrames = 0;
      return { stepChanged: true };
    }

    const zone = (sample) => ({
      yaw: sample.yaw, pitch: sample.pitch,
      yawTolerance: YAW_TOLERANCE_DEG, pitchTolerance: PITCH_TOLERANCE_DEG,
    });
    const result = { screen: zone(this.steps.screen), notes: zone(this.steps.notes) };
    if (inZone(this.steps.side, result.screen) || inZone(this.steps.side, result.notes)) {
      return this.fail("Your side glance overlaps a study zone. Retry calibration with a clearer turn to the side, keeping your face in view.");
    }
    this.active = false;
    this.result = result;
    return { complete: true, result };
  }

  progress(now) {
    if (!this.active) return null;
    const step = CALIBRATION_STEPS[this.stepIndex];
    const elapsed = this.stepStartedAt === null ? 0 : now - this.stepStartedAt;
    return {
      ...step, number: this.stepIndex + 1,
      remainingMs: Math.max(0, step.durationMs - elapsed),
      validFrames: this.samples.length, totalFrames: this.totalFrames,
    };
  }
}
