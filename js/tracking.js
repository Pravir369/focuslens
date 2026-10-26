import { FACE_MODEL_URL, MEDIAPIPE_WASM_URL, MAX_FRAME_GAP_MS } from "./config.js";
import { matrixToEulerAngles } from "./pose.js";
import { atStage, loadModelBuffer } from "./loading.js";

export async function createLandmarker({ FaceLandmarker, FilesetResolver }, { onStage = () => {}, signal, fetcher } = {}) {
  onStage("runtime");
  const fileset = await atStage("runtime", () => FilesetResolver.forVisionTasks(MEDIAPIPE_WASM_URL));
  onStage("face-model");
  const modelAssetBuffer = await loadModelBuffer(FACE_MODEL_URL, "face-model", { signal, fetcher });
  onStage("runtime");
  return atStage("runtime", () => FaceLandmarker.createFromOptions(fileset, {
    baseOptions: { modelAssetBuffer, delegate: "CPU" },
    runningMode: "VIDEO", numFaces: 1,
    outputFacialTransformationMatrixes: true,
    outputFaceBlendshapes: true,
  }));
}

export function readFrame(result) {
  const faceDetected = Boolean(result.faceLandmarks?.[0]?.length);
  const pose = faceDetected ? matrixToEulerAngles(result.facialTransformationMatrixes?.[0]) : null;
  const categories = result.faceBlendshapes?.[0]?.categories ?? [];
  const left = categories.find((item) => item.categoryName === "eyeBlinkLeft")?.score;
  const right = categories.find((item) => item.categoryName === "eyeBlinkRight")?.score;
  const eyeClosedScore = Number.isFinite(left) && Number.isFinite(right) ? (left + right) / 2 : null;
  return { faceDetected, pose, eyeClosedScore, eyeBlinkLeft: left ?? null, eyeBlinkRight: right ?? null };
}

export function startTracking(video, landmarker, { onFrame, onGap, onError }) {
  let stopped = false;
  let requestId = null;
  let lastVideoTime = -1;
  let lastProcessedAt = performance.now();
  let gapReported = false;

  function tick(now) {
    if (stopped) return;
    try {
      if (document.hidden) {
        if (!gapReported) onGap({ reason: "hidden", lastFrameAt: lastProcessedAt });
        gapReported = true;
      } else if (video.readyState >= 2 && video.currentTime !== lastVideoTime) {
        if (now - lastProcessedAt > MAX_FRAME_GAP_MS && !gapReported) onGap({ reason: "frames-stalled", lastFrameAt: lastProcessedAt });
        lastVideoTime = video.currentTime;
        const result = landmarker.detectForVideo(video, now);
        lastProcessedAt = now;
        gapReported = false;
        onFrame(readFrame(result), now);
      } else if (now - lastProcessedAt > MAX_FRAME_GAP_MS && !gapReported) {
        onGap({ reason: "frames-stalled", lastFrameAt: lastProcessedAt });
        gapReported = true;
      }
      requestId = requestAnimationFrame(tick);
    } catch (error) {
      stopped = true;
      onError(error);
    }
  }
  requestId = requestAnimationFrame(tick);
  return () => {
    stopped = true;
    cancelAnimationFrame(requestId);
  };
}
