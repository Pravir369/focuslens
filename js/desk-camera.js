import { PHONE_FRESHNESS_MS } from "./config.js";

export async function listDeskCameras(primaryId, mediaDevices = navigator.mediaDevices) {
  const devices = await mediaDevices.enumerateDevices();
  return devices.filter((device) => device.kind === "videoinput" && device.deviceId && device.deviceId !== primaryId)
    .map((device, index) => ({ id: device.deviceId, label: device.label || `Camera ${index + 1}` }));
}

// Camera B never owns Camera A's stream, face model, or session state.
export class DeskCamera {
  constructor(video, { getMedia = (constraints) => navigator.mediaDevices.getUserMedia(constraints),
    onStatus = () => {}, onUnavailable = () => {} } = {}) {
    Object.assign(this, { video, getMedia, onStatus, onUnavailable });
    this.stream = null;
    this.operation = 0;
    this.resetFrames();
  }

  resetFrames() {
    try { this.lastVideoTime = this.video.currentTime; }
    catch { this.lastVideoTime = null; }
    this.lastFrameAt = null;
  }

  async start(deviceId, primaryId) {
    this.stop();
    if (!deviceId || deviceId === primaryId) throw new Error("Choose a different camera for the desk view.");
    const token = ++this.operation;
    this.onStatus("Connecting desk camera…");
    let next;
    try {
      next = await this.getMedia({ audio: false, video: { deviceId: { exact: deviceId },
        width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 15, max: 30 } } });
      if (token !== this.operation) { next.getTracks().forEach((track) => track.stop()); return false; }
      const track = next.getVideoTracks()[0];
      if (!track || (primaryId && track.getSettings?.().deviceId === primaryId)) throw new Error("The desk view must use a different physical camera from Camera A.");
      this.stream = next;
      this.video.srcObject = next;
      track.addEventListener("ended", () => { if (token === this.operation) this.fail("Desk camera disconnected. Camera A is still running."); }, { once: true });
      await this.video.play();
      if (token !== this.operation) { next.getTracks().forEach((item) => item.stop()); return false; }
      if (track.readyState === "ended") throw new Error("Desk camera disconnected while starting.");
      this.resetFrames();
      this.onStatus("Desk camera connected. Waiting for a fresh frame…");
      return true;
    } catch (error) {
      next?.getTracks().forEach((track) => track.stop());
      if (token !== this.operation) return false;
      this.fail(`Desk camera unavailable: ${error.message || "could not connect"}. Camera A is still running.`);
      throw error;
    }
  }

  frame(now) {
    try {
      if (!this.stream) return null;
      if (this.stream.getVideoTracks()[0]?.readyState === "ended") {
        this.fail("Desk camera disconnected. Camera A is still running."); return null;
      }
      if (this.video.readyState >= 2 && Number.isFinite(this.video.currentTime) && this.video.currentTime !== this.lastVideoTime) {
        this.lastVideoTime = this.video.currentTime;
        this.lastFrameAt = now;
      }
      if (this.video.readyState < 2 || this.lastFrameAt === null || now - this.lastFrameAt > PHONE_FRESHNESS_MS) {
        this.onStatus("Desk camera waiting or stalled. Using Camera A only.");
        return null;
      }
      return { video: this.video, capturedAt: this.lastFrameAt };
    } catch {
      this.fail("Desk camera readings unavailable. Camera A is still running.");
      return null;
    }
  }

  fail(message) { this.stop(); this.onStatus(message); this.onUnavailable(); }

  stop() {
    this.operation++;
    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = null;
    this.video.pause(); this.video.srcObject = null;
    this.resetFrames();
  }
}
