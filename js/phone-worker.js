import { MEDIAPIPE_MODULE_URL } from "./config.js";
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
