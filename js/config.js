// Starting values: tune these only after testing with the actual camera/setup.
export const YAW_TOLERANCE_DEG = 15;
export const PITCH_TOLERANCE_DEG = 12;
export const EYE_CLOSED_THRESHOLD = 0.6;
export const DWELL_MS = Object.freeze({
  engaged: 1000,
  distracted: 3000,
  drowsy: 1000,
  away: 1000,
});
export const CALIBRATION_MIN_VALID_RATIO = 0.9;
export const CALIBRATION_STEPS = Object.freeze([
  { key: "screen", instruction: "Look at your screen", durationMs: 5000 },
  { key: "notes", instruction: "Look down at your notes, like you’re writing", durationMs: 5000 },
  { key: "side", instruction: "Now glance to the side, like checking your phone", durationMs: 3000 },
]);
// Longer gaps are unobserved time, never continuous evidence for a transition.
export const MAX_FRAME_GAP_MS = 500;
export const MEDIAPIPE_VERSION = "0.10.32";
export const MEDIAPIPE_MODULE_URL = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MEDIAPIPE_VERSION}/vision_bundle.mjs`;
export const MEDIAPIPE_WASM_URL = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MEDIAPIPE_VERSION}/wasm`;
export const FACE_MODEL_URL = "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task";
export const PHONE_MODEL_URL = "https://storage.googleapis.com/mediapipe-models/object_detector/efficientdet_lite0/int8/1/efficientdet_lite0.tflite";
export const PHONE_SAMPLE_INTERVAL_MS = 250;
export const PHONE_CONFIDENCE_THRESHOLD = 0.55;
export const PHONE_FRESHNESS_MS = 750;
// Presence is separate from phone use. Starting values need a real-camera
// check with the student's head/upper body in Camera A's view.
export const PERSON_CONFIDENCE_THRESHOLD = 0.45;
export const PERSON_FRESHNESS_MS = 750;
export const PHONE_LOAD_TIMEOUT_MS = 45000;
