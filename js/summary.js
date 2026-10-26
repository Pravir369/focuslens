import { sessionMetrics, sessionTimeline, goalFeedback } from "./session.js";
import { patternTip, headlineSentences } from "./insights.js?v=7";

export function formatDuration(ms) {
  const seconds = Math.max(0, ms) / 1000;
  if (seconds < 60) return `${seconds.toFixed(1).replace(/\.0$/, "")} s`;
  return `${Math.floor(seconds / 60)} m ${(seconds % 60).toFixed(1).replace(/\.0$/, "")} s`;
}

export function formatCountdown(ms) {
  const seconds = Math.ceil(Math.max(0, ms) / 1000);
  return `${Math.floor(seconds / 60).toString().padStart(2, "0")}:${(seconds % 60).toString().padStart(2, "0")}`;
}

export function renderTable(document, element, rows, empty = "No records yet.") {
  element.replaceChildren();
  for (const row of rows.length ? rows : [[empty]]) {
    const tr = document.createElement("tr");
    for (const value of row) {
      const td = document.createElement("td");
      td.textContent = value;
      if (!rows.length) td.colSpan = 4;
      tr.append(td);
    }
    element.append(tr);
  }
}

export function renderSessionSummary(document, session) {
  const set = (id, text) => { document.getElementById(id).textContent = text; };
  const metrics = sessionMetrics(session);
  const headlines = headlineSentences(metrics, session.goalEngagementPct);
  const feedback = goalFeedback(metrics.engagedPct, session.goalEngagementPct);
  set("summary-meta", `${session.endReason === "completed" ? "Session complete" : "Session ended early"} · Study time ${formatDuration(session.elapsedMs(session.endTime))} · ${session.phonePolicy === "phone-free" ? "Phone-free" : "Studying with phone"}`);
  set("summary-recovery", headlines.recovery);
  set("summary-recoveries", metrics.recoveryCount ? `Across ${metrics.recoveryCount} confirmed ${metrics.recoveryCount === 1 ? "recovery" : "recoveries"}.` : "Recovery is measured when a distraction ends in confirmed engagement.");
  const sourceCounts = { cameraA: 0, cameraB: 0 };
  for (const event of session.events) if (event.type === "distracted" && event.triggerSource in sourceCounts) sourceCounts[event.triggerSource]++;
  set("summary-phone-sources", sourceCounts.cameraA || sourceCounts.cameraB
    ? `Phone-triggered distractions: Camera A ${sourceCounts.cameraA} · Camera B (desk) ${sourceCounts.cameraB}. Source is recorded at confirmation; later cause changes do not split the event.` : "");
  const windowCount = session.events.filter((event) => event.type === "distracted" && event.triggerSource === "window").length;
  set("summary-window-sources", windowCount ? `${windowCount} ${windowCount === 1 ? "distraction was" : "distractions were"} confirmed from the active app. Only app names were checked; no screen content was captured.` : "");
  set("summary-engagement", headlines.engagement);
  set("summary-goal", feedback.text);
  set("summary-distractions", headlines.distractions);
  set("summary-longest", headlines.longest);
  set("summary-pattern", patternTip(session.events).message);
  const spans = sessionTimeline(session);
  const timeline = document.getElementById("timeline");
  timeline.replaceChildren();
  timeline.setAttribute("aria-label", `Session timeline, ${spans.length} segments. States and durations are listed in Timeline details below.`);
  document.getElementById("timeline-empty").hidden = spans.length > 0;
  const relative = (at) => formatDuration(at - session.startTime);
  const eventForSpan = (span) => span.type === "distracted" && session.events.find((entry) =>
    entry.type === "distracted" && entry.start <= span.start && entry.end >= span.end);
  const stateLabel = (span) => {
    const event = eventForSpan(span);
    return `${span.type}${event?.triggerSource ? ` · ${event.triggerSource === "window" ? "Active app" : event.triggerSource === "cameraB" ? "Camera B (desk)" : "Camera A"}` : ""}`;
  };
  for (const span of spans) {
    const element = document.createElement("span");
    element.dataset.state = span.type;
    const event = eventForSpan(span);
    if (event?.triggerSource === "cameraA" || event?.triggerSource === "cameraB") {
      element.classList.add("phone-catch");
      element.dataset.triggerSource = event.triggerSource;
    }
    if (event?.triggerSource === "window") { element.classList.add("window-catch"); element.dataset.triggerSource = "window"; }
    element.style.flexGrow = span.duration;
    element.title = `${stateLabel(span)}: ${relative(span.start)} – ${relative(span.end)}`;
    timeline.append(element);
  }
  renderTable(document, document.getElementById("timeline-rows"), spans.map((span) =>
    [stateLabel(span), relative(span.start), relative(span.end), formatDuration(span.duration)]), "No elapsed time to display.");
}
