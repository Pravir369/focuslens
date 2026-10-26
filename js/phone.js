import { PHONE_CONFIDENCE_THRESHOLD, PHONE_FRESHNESS_MS } from "./config.js";

export function readPhoneResult(result, width, height, capturedAt) {
  let confidence = null;
  const boxes = [];
  for (const detection of result.detections ?? []) {
    const category = detection.categories?.find((entry) => entry.categoryName === "cell phone"
      && Number.isFinite(entry.score) && entry.score >= PHONE_CONFIDENCE_THRESHOLD);
    if (!category) continue;
    confidence = Math.max(confidence ?? 0, category.score);
    const box = detection.boundingBox;
    if (!box || ![box.originX, box.originY, box.width, box.height, width, height].every(Number.isFinite)
      || width <= 0 || height <= 0 || box.width <= 0 || box.height <= 0) continue;
    const x = Math.max(0, Math.min(1, box.originX / width));
    const y = Math.max(0, Math.min(1, box.originY / height));
    const right = Math.max(x, Math.min(1, (box.originX + box.width) / width));
    const bottom = Math.max(y, Math.min(1, (box.originY + box.height) / height));
    if (right > x && bottom > y) boxes.push({ x, y, width: right - x, height: bottom - y, confidence: category.score });
  }
  return { capturedAt, present: confidence !== null, confidence, boxes };
}

export function phoneEvidence(sample, now) {
  const ageMs = sample && Number.isFinite(sample.capturedAt) && Number.isFinite(now)
    ? now - sample.capturedAt : null;
  if (ageMs === null || ageMs < 0 || ageMs > PHONE_FRESHNESS_MS || typeof sample.present !== "boolean") {
    return { status: "unknown", ageMs, confidence: null, boxes: [] };
  }
  return {
    status: sample.present ? "present" : "absent",
    ageMs, confidence: sample.confidence, boxes: sample.boxes,
  };
}

// The video is mirrored with CSS; the overlay is not, so labels stay readable.
export function mirroredPhoneBox(box, width, height) {
  return { x: (1 - box.x - box.width) * width, y: box.y * height,
    width: box.width * width, height: box.height * height };
}
