// Presentation only: never force a state, reuse stale evidence or change dwell.
export function classificationFeedback({ running, calibrated, calibrating, paused,
  confirmed, raw, reason, progress, waitingMs = 0 }) {
  if (paused) return "Timer, scoring, and nudges are paused.";
  if (!calibrated) return calibrating ? "Finish calibration, then choose Start Session to begin classification."
    : "Complete calibration before starting classification.";
  if (!running) return "Choose Start Session to begin classification. Phone boxes show detections before the session starts.";
  if (raw === null) {
    const help = reason === "Waiting for fresh phone detection"
      ? "Keep this tab visible and close other camera or video apps. If this continues, pause and reconnect tracking."
      : "Keep your face well lit and fully in Camera A's view. If this continues, pause and reconnect tracking.";
    return `${reason || "Waiting for usable readings"}. Unclassified time is excluded from engagement.${waitingMs >= 8000 ? ` ${help}` : ""}`;
  }
  if (!confirmed && progress) {
    const label = progress.state === "drowsy" ? "closed eyes" : progress.state;
    return `Checking ${label}: ${(progress.elapsedMs / 1000).toFixed(1)} / ${(progress.requiredMs / 1000).toFixed(1)} seconds. Keep the reading steady while it is confirmed.`;
  }
  return "";
}
