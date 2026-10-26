import { CAMERA_WIDTH, CAMERA_HEIGHT } from "./config.js";

export async function startCamera(video, onEnded) {
  if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
    throw new Error("Camera access requires localhost or HTTPS. Open http://localhost:8000, using the local server instructions.");
  }
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { width: { ideal: CAMERA_WIDTH }, height: { ideal: CAMERA_HEIGHT }, frameRate: { ideal: 15, max: 30 } },
    audio: false,
  });
  try {
    video.srcObject = stream;
    await video.play();
    for (const track of stream.getVideoTracks()) track.addEventListener("ended", onEnded, { once: true });
    return stream;
  } catch (error) {
    stream.getTracks().forEach((track) => track.stop());
    video.srcObject = null;
    throw error;
  }
}

export function stopCamera(video, stream) {
  stream?.getTracks().forEach((track) => track.stop());
  video.pause();
  video.srcObject = null;
}

export function cameraErrorMessage(error) {
  if (error.name === "NotAllowedError" || error.name === "SecurityError") {
    return "Camera access is needed to use FocusLens. Allow camera access in your browser’s site settings, then retry.";
  }
  if (error.name === "NotFoundError") return "No camera was found. Connect a camera, then retry.";
  if (error.name === "NotReadableError") return "The camera could not start. Close other apps using it, then retry.";
  return error.message || "The camera could not start. Please retry.";
}
