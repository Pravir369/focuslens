import { PHONE_SAMPLE_INTERVAL_MS, PHONE_LOAD_TIMEOUT_MS, CAMERA_WIDTH, CAMERA_HEIGHT } from "./config.js";
import { SetupError } from "./loading.js";

export function createPhoneBitmap(video, createBitmap = (...args) => createImageBitmap(...args)) {
  const width = video.videoWidth || video.width;
  const height = video.videoHeight || video.height;
  const scale = Math.min(1, CAMERA_WIDTH / width, CAMERA_HEIGHT / height);
  // Camera constraints are preferences; some devices still supply HD/4K.
  // Bound the transferred image, keeping the full frame and its aspect ratio.
  return scale < 1 ? createBitmap(video, {
    resizeWidth: Math.max(1, Math.round(width * scale)),
    resizeHeight: Math.max(1, Math.round(height * scale)), resizeQuality: "low",
  }) : createBitmap(video);
}

export class PhoneTracker {
  constructor({ onError = () => {}, onStage = () => {}, onSourceError = () => {},
    workerFactory = () => new Worker(new URL("./phone-worker.js", import.meta.url), { type: "module" }),
    makeBitmap = (video) => createPhoneBitmap(video),
    // Keep Window timer functions bound to their native receiver in WebKit.
    setTimer = (callback, delay) => setTimeout(callback, delay),
    clearTimer = (timer) => clearTimeout(timer),
  } = {}) {
    Object.assign(this, { onError, onStage, onSourceError, workerFactory, makeBitmap, setTimer, clearTimer });
    this.worker = null;
    this.ready = false;
    this.stopped = false;
    this.inFlight = false;
    this.lastSampleAt = -Infinity;
    this.latest = null;
    this.deskLatest = null;
    this.sourceGeneration = { cameraA: 0, cameraB: 0 };
    this.nextSource = "cameraA";
    this.generation = 0;
    this.nextId = 0;
    this.pendingId = null;
  }

  start() {
    if (this.startPromise) return this.startPromise;
    this.startPromise = new Promise((resolve, reject) => {
      this.resolveReady = resolve;
      this.rejectReady = reject;
      try {
        if (this.stopped) throw new Error("Phone tracking has stopped");
        this.worker = this.workerFactory();
        this.worker.onmessage = ({ data }) => this.handleMessage(data);
        this.worker.onerror = (event) => {
          event.preventDefault?.();
          this.fail(new SetupError("phone-worker", new Error(event.message || "Worker could not load")));
        };
        this.worker.onmessageerror = () => this.fail(new SetupError("phone-worker", new Error("Could not read worker response")));
        this.loadTimer = this.setTimer(() => this.fail(new SetupError("phone-worker", new Error("Loading timed out"))), PHONE_LOAD_TIMEOUT_MS);
        this.worker.postMessage({ type: "init" });
      } catch (error) {
        this.fail(error instanceof SetupError ? error : new SetupError("phone-worker", error));
      }
    });
    return this.startPromise;
  }

  handleMessage(data) {
    if (this.stopped) return;
    if (data.type === "stage") {
      this.onStage(data.stage);
    } else if (data.type === "ready") {
      this.clearTimer(this.loadTimer);
      this.ready = true;
      this.resolveReady?.();
      this.resolveReady = this.rejectReady = null;
    } else if (data.type === "error") {
      const error = new Error(data.message);
      error.name = "SetupError";
      error.stage = data.stage;
      if (data.source === "cameraB") {
        if (data.id !== this.pendingId) return;
        const current = this.pendingGeneration === this.generation && this.pendingSourceGeneration === this.sourceGeneration.cameraB;
        this.inFlight = false; this.pendingId = null;
        if (current) { this.invalidateSource("cameraB"); this.onSourceError(error); }
      } else this.fail(error);
    } else if (data.type === "result" && data.id === this.pendingId) {
      this.inFlight = false;
      this.pendingId = null;
      if (data.generation === this.generation && this.pendingSourceGeneration === this.sourceGeneration[this.pendingSource]) {
        if (this.pendingSource === "cameraB") this.deskLatest = data.sample;
        else this.latest = data.sample;
      }
    }
  }

  // One model, one globally ordered VIDEO clock, and at most one bitmap/request
  // in flight across both cameras. capturedAt remains the source's frame time.
  async sample(video, now, source = "cameraA", capturedAt = now) {
    if (!(source in this.sourceGeneration)) return false;
    if (!this.ready || this.stopped || this.inFlight || now - this.lastSampleAt < PHONE_SAMPLE_INTERVAL_MS) return false;
    this.inFlight = true; // Covers bitmap creation as well as worker inference.
    this.lastSampleAt = now;
    const generation = this.generation;
    const sourceGeneration = this.sourceGeneration[source];
    let bitmap;
    try {
      bitmap = await this.makeBitmap(video);
      if (this.stopped || generation !== this.generation || sourceGeneration !== this.sourceGeneration[source]) {
        bitmap.close();
        this.inFlight = false;
        return false;
      }
      const id = ++this.nextId;
      this.pendingId = id;
      this.pendingSource = source; this.pendingGeneration = generation; this.pendingSourceGeneration = sourceGeneration;
      this.worker.postMessage({ type: "frame", bitmap, capturedAt, inferenceAt: now, source, id, generation }, [bitmap]);
      return true;
    } catch (error) {
      bitmap?.close();
      this.inFlight = false;
      this.pendingId = null;
      if (source === "cameraB") {
        if (generation === this.generation && sourceGeneration === this.sourceGeneration[source] && !this.stopped) {
          this.invalidateSource(source); this.onSourceError(new SetupError("phone-inference", error));
        }
      } else this.fail(new SetupError("phone-inference", error));
      return false;
    }
  }

  sampleNext(cameraA, deskFrame, now) {
    if (!this.ready || this.stopped || this.inFlight || now - this.lastSampleAt < PHONE_SAMPLE_INTERVAL_MS) return Promise.resolve(false);
    const source = deskFrame && this.nextSource === "cameraB" ? "cameraB" : "cameraA";
    this.nextSource = source === "cameraA" && deskFrame ? "cameraB" : "cameraA";
    return this.sample(source === "cameraB" ? deskFrame.video : cameraA, now, source, source === "cameraB" ? deskFrame.capturedAt : now);
  }

  invalidateSource(source) {
    this.sourceGeneration[source]++;
    if (source === "cameraB") this.deskLatest = null;
    else this.latest = null;
  }

  invalidate() {
    this.generation++;
    this.latest = null;
    this.deskLatest = null;
    this.nextSource = "cameraA";
  }

  fail(error) {
    if (this.stopped) return;
    const reject = this.rejectReady;
    this.rejectReady = this.resolveReady = null;
    this.stop();
    if (reject) reject(error);
    else this.onError(error);
  }

  stop() {
    if (this.stopped) return;
    this.stopped = true;
    this.ready = false;
    this.invalidate();
    this.clearTimer(this.loadTimer);
    // Terminating the worker destroys its model/runtime and transferred images.
    // A bitmap still being created locally is closed by sample() when it resolves.
    this.worker?.terminate();
    this.worker = null;
    this.inFlight = false;
    const reject = this.rejectReady;
    this.rejectReady = this.resolveReady = null;
    if (reject) reject(new DOMException("Phone tracking stopped", "AbortError"));
  }
}
