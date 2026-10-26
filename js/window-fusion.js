import { classifyObservation } from "./classifier.js";

// Add a signal without editing the verified camera classifier or dwell logic.
export function classifyWithWindow(frame, calibration, options, windowOffTask = false) {
  const camera = classifyObservation(frame, calibration, options);
  if (!windowOffTask || camera.triggerSource === "cameraA" || camera.triggerSource === "cameraB") return camera;
  const faceOnly = classifyObservation(frame, calibration, { phonePolicy: "phone-allowed" });
  if (faceOnly.state === null || faceOnly.state === "away" || faceOnly.state === "eyes_closed") return camera;
  return { state: "distracted", reason: "Active app outside your study list", triggerSource: "window" };
}
