import { EventLog } from "./event-log.js";

// All times are milliseconds from a single monotonic-derived clock. Events
// keep their original schema; pauses and unknown observations are metadata.
export class StudySession {
  constructor({ goalMinutes = 25, goalEngagementPct = 80, phonePolicy = "phone-free" } = {}) {
    if (!Number.isFinite(goalMinutes) || !Number.isFinite(goalMinutes * 60000) || goalMinutes <= 0) throw new Error("Choose a positive session length.");
    if (!Number.isFinite(goalEngagementPct) || goalEngagementPct < 0 || goalEngagementPct > 100) {
      throw new Error("Choose an engagement goal between 0 and 100%.");
    }
    Object.assign(this, { goalMinutes, goalEngagementPct, phonePolicy });
    this.durationMs = goalMinutes * 60000;
    this.state = "idle";
    this.startTime = null;
    this.endTime = null;
    this.activeSegments = [];
    this.unclassifiedPeriods = [];
    this.log = new EventLog();
    this.pauseReason = "";
  }

  get events() { return this.log.events; }
  get segment() { return this.activeSegments.at(-1); }

  start(now) {
    if (this.state !== "idle") throw new Error("This session has already started.");
    this.startTime = now;
    this.openSegment(now);
  }

  openSegment(now) {
    this.state = "running";
    this.pauseReason = "";
    this.activeSegments.push({ start: now, end: null, eventStartIndex: this.events.length, eventEndIndex: null });
    this.unclassifiedPeriods.push({ start: now, end: null });
  }

  elapsedMs(now) {
    return Math.min(this.durationMs, this.activeSegments.reduce((sum, segment) =>
      sum + Math.max(0, (segment.end ?? now) - segment.start), 0));
  }

  remainingMs(now) { return Math.max(0, this.durationMs - this.elapsedMs(now)); }

  advance(now) {
    if (this.state !== "running") return false;
    const completed = this.activeSegments.slice(0, -1).reduce((sum, segment) => sum + segment.end - segment.start, 0);
    const deadline = this.segment.start + this.durationMs - completed;
    if (now < deadline) return false;
    this.finish(deadline, "completed");
    return true;
  }

  observe(usable, now) {
    if (this.state !== "running" || this.advance(now)) return;
    const ongoing = this.events.at(-1);
    const hasConfirmedState = ongoing?.end === null;
    const unknown = this.unclassifiedPeriods.at(-1);
    if (!usable || !hasConfirmedState) {
      if (unknown?.end !== null) this.unclassifiedPeriods.push({ start: now, end: null });
    } else this.closeUnknown(now);
  }

  confirm(transition) {
    if (this.state !== "running" || this.advance(transition.at)) return;
    this.closeUnknown(transition.at);
    this.log.transition(transition);
  }

  closeUnknown(now) {
    const unknown = this.unclassifiedPeriods.at(-1);
    if (unknown?.end === null) unknown.end = Math.max(unknown.start, now);
  }

  closeSegment(now) {
    const at = Math.max(this.segment.start, now);
    this.log.close(at);
    this.closeUnknown(at);
    this.segment.end = at;
    this.segment.eventEndIndex = this.events.length;
  }

  pause(now, reason = "Paused. Resume when you’re ready.") {
    if (this.state !== "running" || this.advance(now)) return false;
    this.closeSegment(now);
    this.state = "paused";
    this.pauseReason = reason;
    return true;
  }

  resume(now) {
    if (this.state !== "paused") return false;
    this.openSegment(now);
    return true;
  }

  finish(now, reason) {
    if (this.state === "running") this.closeSegment(now);
    this.state = "ended";
    this.endTime = now;
    this.endReason = reason;
  }

  end(now) {
    if (this.state === "idle" || this.state === "ended") return false;
    if (!this.advance(now)) this.finish(now, "ended-early");
    return true;
  }
}

function overlap(start, end, interval, now) {
  return Math.max(0, Math.min(end, interval.end ?? now) - Math.max(start, interval.start));
}

export function sessionMetrics(session, now = session.endTime) {
  const at = now ?? session.startTime;
  const totals = { engaged: 0, distracted: 0, drowsy: 0, away: 0 };
  const recoveries = [];
  let distractionCount = 0;
  let longestDistractionMs = 0;
  for (let index = 0; index < session.events.length; index++) {
    const event = session.events[index];
    const end = event.end ?? at;
    const unknownMs = session.unclassifiedPeriods.reduce((sum, period) => sum + overlap(event.start, end, period, at), 0);
    const observedMs = Math.max(0, end - event.start - unknownMs);
    totals[event.type] += observedMs;
    if (event.type !== "distracted") continue;
    distractionCount++;
    longestDistractionMs = Math.max(longestDistractionMs, observedMs);
    const next = session.events[index + 1];
    const sameSegment = session.activeSegments.some((segment) =>
      index >= segment.eventStartIndex && index + 1 < (segment.eventEndIndex ?? session.events.length));
    if (event.end !== null && next?.type === "engaged" && next.start === event.end && sameSegment && unknownMs === 0) {
      recoveries.push(event.duration);
    }
  }
  const classifiedMs = totals.engaged + totals.distracted + totals.drowsy;
  return {
    totals, classifiedMs, distractionCount, longestDistractionMs, recoveryCount: recoveries.length,
    engagedPct: classifiedMs > 0 ? totals.engaged / classifiedMs * 100 : null,
    averageRecoveryMs: recoveries.length ? recoveries.reduce((sum, duration) => sum + duration, 0) / recoveries.length : null,
  };
}

export function goalFeedback(engagedPct, goal) {
  if (engagedPct === null) return { outcome: "waiting", text: "Not enough classified time to compare with your goal." };
  if (engagedPct >= goal) return { outcome: "pass", text: "You hit your goal." };
  const difference = goal - engagedPct;
  return difference <= 10 + 1e-9
    ? { outcome: "near", text: `Close — ${difference.toFixed(1)} percentage points below your goal.` }
    : { outcome: "below", text: `Below your goal by ${difference.toFixed(1)} percentage points. Every session is a fresh start.` };
}

export function sessionTimeline(session) {
  if (session.startTime === null || session.endTime === null || session.endTime <= session.startTime) return [];
  const start = session.startTime;
  const end = session.endTime;
  const boundaries = new Set([start, end]);
  for (const interval of [...session.events, ...session.activeSegments, ...session.unclassifiedPeriods]) {
    boundaries.add(Math.max(start, Math.min(end, interval.start)));
    boundaries.add(Math.max(start, Math.min(end, interval.end ?? end)));
  }
  const sorted = [...boundaries].sort((a, b) => a - b);
  const spans = [];
  const contains = (interval, time) => time >= interval.start && time < (interval.end ?? end);
  for (let index = 0; index < sorted.length - 1; index++) {
    const from = sorted[index];
    const to = sorted[index + 1];
    if (to <= from) continue;
    const midpoint = (from + to) / 2;
    const active = session.activeSegments.some((segment) => contains(segment, midpoint));
    const unknown = session.unclassifiedPeriods.some((period) => contains(period, midpoint));
    const event = session.events.find((entry) => contains(entry, midpoint));
    const type = !active ? "paused" : unknown || !event ? "unclassified" : event.type;
    const previous = spans.at(-1);
    if (previous?.type === type) { previous.end = to; previous.duration += to - from; }
    else spans.push({ type, start: from, end: to, duration: to - from });
  }
  return spans;
}
