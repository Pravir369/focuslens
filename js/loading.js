const STAGE_LABELS = {
  library: "Tracking library download",
  runtime: "Tracking runtime / WASM initialization",
  "face-model": "Face model download",
  "phone-model": "Phone model download",
  "phone-worker": "Phone worker startup",
  "phone-inference": "Phone detection",
};

export class SetupError extends Error {
  constructor(stage, cause) {
    const recovery = stage === "phone-inference" ? "Stop the camera and retry in an up-to-date browser."
      : stage === "phone-worker" ? "Retry in an up-to-date browser with module-worker support."
      : "Check your connection and retry in an up-to-date browser.";
    super(`${STAGE_LABELS[stage] ?? stage} failed: ${cause?.message ?? cause}. ${recovery}`, { cause });
    this.name = "SetupError";
    this.stage = stage;
  }
}

export async function atStage(stage, action) {
  try {
    return await action();
  } catch (error) {
    if (error.name === "AbortError" || error instanceof SetupError) throw error;
    throw new SetupError(stage, error);
  }
}

export function loadModelBuffer(url, stage, { signal, fetcher = globalThis.fetch } = {}) {
  return atStage(stage, async () => {
    const response = await fetcher(url, { signal });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const buffer = new Uint8Array(await response.arrayBuffer());
    if (!buffer.byteLength) throw new Error("The downloaded model is empty");
    return buffer;
  });
}
