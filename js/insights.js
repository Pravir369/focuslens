// Summary-only interpretation of confirmed events. Never mutate the log or
// infer a recovery, cause change, or duration that was not recorded.
export function patternTip(events) {
  const counts = { phone: 0, lookAway: 0, drowsy: 0, window: 0 };
  for (const event of events) {
    if (event.type === "drowsy") counts.drowsy++;
    if (event.type !== "distracted") continue;
    if (event.triggerSource === "cameraA" || event.triggerSource === "cameraB") counts.phone++;
    else if (event.triggerSource === "window") counts.window++;
    else if (!event.triggerSource) counts.lookAway++;
  }
  if (counts.phone + counts.lookAway + counts.drowsy + counts.window === 0) return {
    pattern: "none", counts, message: "No distractions logged this session.",
  };
  // Keep the previous order; the new app pattern follows phone in ties.
  if (counts.phone >= counts.window && counts.phone >= counts.drowsy && counts.phone >= counts.lookAway) return {
    pattern: "phone", counts,
    message: "Most of today's lapses were phone-related. Try leaving it in another room next session.",
  };
  if (counts.window >= counts.drowsy && counts.window >= counts.lookAway) return {
    pattern: "window", counts,
    message: "Most of this session's lapses happened while an app outside your study list was active. Try keeping only your study apps open next session.",
  };
  if (counts.drowsy >= counts.lookAway) return {
    pattern: "drowsy", counts,
    message: "Several drowsy moments today — this might be a session-timing issue more than a focus issue. Try studying earlier, or take a short break before you start.",
  };
  return {
    pattern: "lookAway", counts,
    message: "Most lapses were brief look-aways, not phone use — your attention drifted but came back on its own, which your recovery-speed number below reflects.",
  };
}

// Formatting only: all values are supplied by the existing session metrics.
export function headlineSentences(metrics, goal) {
  const seconds = (ms) => {
    const value = (ms / 1000).toFixed(1).replace(/\.0$/, "");
    return `${value} ${value === "1" ? "second" : "seconds"}`;
  };
  return {
    recovery: metrics.distractionCount === 0 ? "No distractions this session"
      : metrics.averageRecoveryMs === null ? "No recoveries recorded"
      : `You got back on track in about ${seconds(metrics.averageRecoveryMs)} on average.`,
    engagement: metrics.engagedPct === null ? "No classified time"
      : `You were engaged for ${metrics.engagedPct.toFixed(1)}% of classified study time, against your ${goal}% goal.`,
    distractions: `${metrics.distractionCount} ${metrics.distractionCount === 1 ? "moment" : "moments"} of distraction this session.`,
    longest: `Your longest distraction lasted about ${seconds(metrics.longestDistractionMs)}.`,
  };
}
