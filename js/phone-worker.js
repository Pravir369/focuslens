import { MEDIAPIPE_MODULE_URL, CAMERA_WIDTH, CAMERA_HEIGHT } from "./config.js";
import { atStage } from "./loading.js";
import { createPhoneDetector } from "./phone-model.js";
import { readPhoneResult } from "./phone.js";
import { installWorkerRuntimeImport } from "./worker-runtime.js";

let detector = null;
installWorkerRuntimeImport(self);

self.onmessage = async ({ data }) => {
  if (data.type === "init") {
    try {
      self.postMessage({ type: "stage", stage: "library" });
      const vision = await atStage("library", () => import(MEDIAPIPE_MODULE_URL));
      detector = await createPhoneDetector(vision, {
        canvas: new OffscreenCanvas(1, 1),
        onStage: (stage) => self.postMessage({ type: "stage", stage }),
      });
      // WASM's first inference can take longer than the evidence freshness
      // window. Warm it with synthetic pixels before advertising readiness;
      // this is never camera evidence and never enters the classifier.
      await atStage("runtime", async () => {
        const canvas = new OffscreenCanvas(CAMERA_WIDTH, CAMERA_HEIGHT);
        canvas.getContext("2d").fillRect(0, 0, canvas.width, canvas.height);
        const warmup = await createImageBitmap(canvas);
        try { detector.detectForVideo(warmup, 0); }
        finally { warmup.close(); }
      });
      self.postMessage({ type: "ready" });
    } catch (error) {
      self.postMessage({ type: "error", stage: error.stage ?? "phone-worker", message: error.message });
    }
  } else if (data.type === "frame") {
    const { bitmap, capturedAt, inferenceAt = capturedAt, source = "cameraA", id, generation } = data;
    try {
      if (!detector) throw new Error("The phone model is not ready");
      // Both video feeds share this instance and monotonically increasing
      // inference timestamp. The evidence keeps its original capture time.
      const result = detector.detectForVideo(bitmap, inferenceAt);
      const sample = readPhoneResult(result, bitmap.width, bitmap.height, capturedAt);
      self.postMessage({ type: "result", id, generation, source, sample });
    } catch (error) {
      self.postMessage({ type: "error", source, id, generation, stage: "phone-inference", message: error.message });
    } finally {
      // This is the sole owner after transfer. Never retain a camera bitmap.
      bitmap.close();
    }
  }
};
