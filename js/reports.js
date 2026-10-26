import { sessionMetrics, sessionTimeline, goalFeedback } from "./session.js";
import { headlineSentences, patternTip } from "./insights.js?v=7";
import { formatDuration } from "./summary.js";

export function sessionReport(session) {
  if (session.state !== "ended") throw new Error("Reports use ended sessions only.");
  const metrics = sessionMetrics(session);
  return {
    title: "FocusLens session report", completedAt: new Date(session.endTime).toISOString(),
    headlineStats: headlineSentences(metrics, session.goalEngagementPct),
    goalFeedback: goalFeedback(metrics.engagedPct, session.goalEngagementPct).text,
    patternTip: patternTip(session.events).message,
    timeline: sessionTimeline(session).map((span) => {
      const event = span.type === "distracted" && session.events.find((entry) => entry.start <= span.start && entry.end >= span.end);
      const source = event?.triggerSource;
      return { state: `${span.type}${source ? ` · ${source === "cameraB" ? "Camera B (desk)" : source === "window" ? "Active app" : "Camera A"}` : ""}`,
        start: formatDuration(span.start - session.startTime), end: formatDuration(span.end - session.startTime), duration: formatDuration(span.duration) };
    }),
  };
}

export class ReportController {
  constructor(document, profileId, { fetcher = (...args) => fetch(...args), delay = (callback) => setTimeout(callback, 1000), cancelDelay = (timer) => clearTimeout(timer) } = {}) {
    Object.assign(this, { document, profileId, fetcher, delay, cancelDelay });
    this.form = document.getElementById("report-form");
    this.output = document.getElementById("report-status");
    this.button = document.getElementById("send-report");
    this.generation = 0;
    this.listener = (event) => { event.preventDefault(); void this.send(); };
    this.form.addEventListener("submit", this.listener);
  }

  setSession(session) {
    this.generation++; this.abort?.abort();
    if (this.timer !== null && this.timer !== undefined) { this.cancelDelay(this.timer); this.wake?.(); this.timer = null; }
    this.session = session; this.form.reset(); this.busy = false;
    this.form.querySelectorAll("input").forEach((input) => { input.disabled = false; });
    this.button.disabled = !session;
    this.output.textContent = "";
  }

  async send() {
    if (!this.session || this.busy || !this.form.reportValidity()) return;
    const generation = this.generation;
    const addresses = ["report-email", "report-email-extra"].map((id) => this.document.getElementById(id).value.trim()).filter(Boolean);
    const body = { profileId: this.profileId, sessionSummary: sessionReport(this.session), recipientEmails: addresses };
    this.busy = true; this.button.disabled = true;
    this.form.querySelectorAll("input").forEach((input) => { input.disabled = true; });
    this.output.textContent = "Sending…";
    const abort = new AbortController(); this.abort = abort;
    // Stop awaiting a broken/slow connection without blocking any session UI.
    const timeout = setTimeout(() => abort.abort(), 65000);
    try {
      let response = await this.fetcher("/send-report", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: this.abort.signal });
      let data = await response.json();
      if (!response.ok) throw new Error(data.error || "Report could not be sent.");
      const reportId = data.reportId;
      while (data.status === "sending") {
        await new Promise((resolve) => { this.wake = resolve; this.timer = this.delay(resolve); });
        this.timer = null;
        if (generation !== this.generation) return;
        response = await this.fetcher(`/reports/${encodeURIComponent(reportId)}?profileId=${encodeURIComponent(this.profileId)}`, { signal: this.abort.signal });
        data = await response.json();
        if (!response.ok) throw new Error(data.error || "Delivery status could not be read.");
      }
      if (generation !== this.generation) return;
      if (data.status !== "sent") throw new Error(data.error || "Delivery was not confirmed. Check your inbox before retrying.");
      this.output.textContent = `Report sent to ${data.sentCount} ${data.sentCount === 1 ? "address" : "addresses"}.`;
      this.form.reset();
    } catch (error) {
      if (generation === this.generation) this.output.textContent = error.name === "AbortError"
        ? "Delivery status is unknown. Check your inbox before trying again."
        : `Could not send report: ${error.message}`;
    } finally {
      clearTimeout(timeout);
      if (generation === this.generation) {
        this.busy = false; this.button.disabled = !this.session;
        this.form.querySelectorAll("input").forEach((input) => { input.disabled = false; });
      }
    }
  }

  dispose() { this.setSession(null); this.form.removeEventListener("submit", this.listener); }
}
