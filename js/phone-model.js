import { MEDIAPIPE_WASM_URL, PHONE_MODEL_URL, PHONE_CONFIDENCE_THRESHOLD } from "./config.js";
import { atStage, loadModelBuffer } from "./loading.js";

export async function createPhoneDetector({ ObjectDetector, FilesetResolver }, { onStage = () => {}, fetcher, canvas } = {}) {
  onStage("runtime");
  const fileset = await atStage("runtime", () => FilesetResolver.forVisionTasks(MEDIAPIPE_WASM_URL));
  onStage("phone-model");
  const modelAssetBuffer = await loadModelBuffer(PHONE_MODEL_URL, "phone-model", { fetcher });
  onStage("runtime");
  return atStage("runtime", () => ObjectDetector.createFromOptions(fileset, {
    ...(canvas ? { canvas } : {}),
    baseOptions: { modelAssetBuffer, delegate: "CPU" },
    runningMode: "VIDEO", categoryAllowlist: ["cell phone"],
    scoreThreshold: PHONE_CONFIDENCE_THRESHOLD,
  }));
}
