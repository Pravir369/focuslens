import { PERSON_CONFIDENCE_THRESHOLD, PERSON_FRESHNESS_MS } from './config.js';

export function readPersonResult(result, width, height, capturedAt) {
  const boxes = [];
  if (!(Number.isFinite(width) && width > 0 && Number.isFinite(height) && height > 0)) {
    return { capturedAt, present: null, confidence: null, boxes };
  }
  for (const detection of result.detections ?? []) {
    const category = detection.categories?.find(entry => entry.categoryName === 'person' &&
      Number.isFinite(entry.score) && entry.score >= PERSON_CONFIDENCE_THRESHOLD);
    const box = detection.boundingBox;
    if (!category || !box || ![box.originX, box.originY, box.width, box.height].every(Number.isFinite) || box.width <= 0 || box.height <= 0) continue;
    const x = Math.max(0, Math.min(1, box.originX / width));
    const y = Math.max(0, Math.min(1, box.originY / height));
    const right = Math.max(x, Math.min(1, (box.originX + box.width) / width));
    const bottom = Math.max(y, Math.min(1, (box.originY + box.height) / height));
    if (right > x && bottom > y) boxes.push({ x, y, width: right - x, height: bottom - y, confidence: category.score });
  }
  return { capturedAt, present: boxes.length > 0, confidence: boxes.length ? Math.max(...boxes.map(box => box.confidence)) : null, boxes };
}

// Only Camera A's worker sample is passed here. Camera B cannot establish
// student presence, and old/missing results never mean an empty chair.
export function personEvidence(sample, now) {
  const person = sample?.person;
  const ageMs = Number.isFinite(person?.capturedAt) && Number.isFinite(now) ? now - person.capturedAt : null;
  if (ageMs === null || ageMs < 0 || ageMs > PERSON_FRESHNESS_MS || typeof person.present !== 'boolean') {
    return { status: 'unknown', ageMs, confidence: null, boxes: [] };
  }
  return { status: person.present ? 'present' : 'absent', ageMs, confidence: person.confidence, boxes: person.boxes };
}
