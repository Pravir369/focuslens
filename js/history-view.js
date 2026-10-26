import { recoveryTrend } from "./history.js";
import { formatDuration, renderTable } from "./summary.js";

export function renderHistory(document, records) {
  const get = (id) => document.getElementById(id);
  const trend = recoveryTrend(records);
  get("history-count").textContent = `${records.length} saved ${records.length === 1 ? "session" : "sessions"} · Oldest first · Up to 100 summaries`;
  get("history-trend").textContent = trend.direction === "waiting"
    ? "A trend appears after two saved sessions with a confirmed recovery."
    : trend.direction === "steady" ? "Your latest recovery average is about the same as your first."
    : `Your latest recovery average is ${formatDuration(trend.differenceMs)} ${trend.direction} than your first.`;
  get("history-trend-note").textContent = "Lower recovery time means a quicker return to engagement. Sessions without recoveries have no recovery value; they are never counted as zero. Estimates vary with setup and phone policy.";
  const date = (value) => new Date(value).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
  renderTable(document, get("history-rows"), records.map((record) => [
    date(record.endTime), `${formatDuration(record.activeMs)}${record.endReason === "ended-early" ? " · ended early" : ""}`,
    record.averageRecoveryMs === null ? record.distractionCount ? "No recoveries recorded" : "No distractions this session" : `${formatDuration(record.averageRecoveryMs)} (${record.recoveryCount})`,
    record.engagedPct === null ? "No classified time" : `${record.engagedPct.toFixed(1)}% / ${record.goalEngagementPct}%`,
    record.distractionCount, record.phonePolicy === "phone-free" ? "Phone-free" : "Studying with phone",
  ]), "No saved sessions yet. Turn on history before your next session to start a record.");
  get("history-rows").querySelector("td[colspan]")?.setAttribute("colspan", "6");
  const chart = get("history-chart");
  chart.replaceChildren();
  const hasRecovery = records.some((record) => record.averageRecoveryMs !== null);
  chart.toggleAttribute("hidden", !hasRecovery);
  if (!hasRecovery) return;
  const svg = (tag, attributes, text) => {
    const node = document.createElementNS("http://www.w3.org/2000/svg", tag);
    for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, value);
    if (text !== undefined) node.textContent = text;
    return node;
  };
  chart.append(svg("title", {}, "Average recovery speed by session"), svg("desc", {}, "Oldest session on the left, newest on the right. Lower is faster. Gaps mean no qualifying recoveries. Full values are in the table below."));
  const maxSeconds = Math.max(1, Math.ceil(Math.max(...records.map((record) => record.averageRecoveryMs ?? 0)) / 1000));
  for (const [y, seconds] of [[24, maxSeconds], [174, 0]]) {
    chart.append(svg("line", { x1: 58, x2: 614, y1: y, y2: y, class: "chart-grid" }), svg("text", { x: 48, y: y + 4, "text-anchor": "end" }, `${seconds}s`));
  }
  let previous = null;
  records.forEach((record, index) => {
    if (record.averageRecoveryMs === null) { previous = null; return; }
    const point = { x: records.length === 1 ? 336 : 58 + index / (records.length - 1) * 556, y: 174 - record.averageRecoveryMs / 1000 / maxSeconds * 150 };
    if (previous) chart.append(svg("line", { x1: previous.x, y1: previous.y, x2: point.x, y2: point.y, class: "chart-line" }));
    const dot = svg("circle", { cx: point.x, cy: point.y, r: 4, class: "chart-dot" });
    dot.append(svg("title", {}, `${date(record.endTime)}: ${formatDuration(record.averageRecoveryMs)}`));
    chart.append(dot); previous = point;
  });
  chart.append(svg("text", { x: 58, y: 206 }, "Oldest session"), svg("text", { x: 614, y: 206, "text-anchor": "end" }, "Newest session"));
}
