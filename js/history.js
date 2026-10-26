import { sessionMetrics } from "./session.js";
import { getCurrentProfileId, validProfileId } from "./profile.js";

export const HISTORY_KEY = "focuslens.history.v1";
export const HISTORY_LIMIT = 100;
const empty = () => ({ version: 1, enabled: false, records: [] });
const finite = (value, min = 0, max = Number.MAX_VALUE) => Number.isFinite(value) && value >= min && value <= max;
const count = (value) => Number.isSafeInteger(value) && value >= 0;

// Persist only this whitelist of summary values. Never serialize a session,
// calibration, frame, pose, image, or event timeline into browser storage.
export function validateRecord(record) {
  if (!record || typeof record !== "object") return null;
  const { id, profileId, startTime, endTime, goalMinutes, goalEngagementPct, phonePolicy, endReason,
    activeMs, engagedPct, averageRecoveryMs, distractionCount, recoveryCount, longestDistractionMs } = record;
  if (!validProfileId(profileId) || typeof id !== "string" || !id.length || id.length > 100
    || !finite(startTime, 0, 8.64e15) || !finite(endTime, startTime, 8.64e15)
    || !finite(goalMinutes, Number.MIN_VALUE) || !finite(goalMinutes * 60000)
    || !finite(goalEngagementPct, 0, 100) || !["phone-free", "phone-allowed"].includes(phonePolicy)
    || !["completed", "ended-early"].includes(endReason) || !finite(activeMs, 0, Math.min(endTime - startTime, goalMinutes * 60000))
    || !(engagedPct === null || finite(engagedPct, 0, 100))
    || !count(distractionCount) || !count(recoveryCount) || recoveryCount > distractionCount
    || !(averageRecoveryMs === null ? recoveryCount === 0 : recoveryCount > 0 && finite(averageRecoveryMs, 0, activeMs))
    || !finite(longestDistractionMs, 0, activeMs)) return null;
  return { id, profileId, startTime, endTime, goalMinutes, goalEngagementPct, phonePolicy, endReason,
    activeMs, engagedPct, averageRecoveryMs, distractionCount, recoveryCount, longestDistractionMs };
}

export function summarizeSession(session, id = globalThis.crypto.randomUUID(), profileId = getCurrentProfileId()) {
  if (session.state !== "ended") throw new Error("Only ended sessions can be saved.");
  const metrics = sessionMetrics(session);
  const record = validateRecord({
    id, profileId, startTime: session.startTime, endTime: session.endTime,
    goalMinutes: session.goalMinutes, goalEngagementPct: session.goalEngagementPct,
    phonePolicy: session.phonePolicy, endReason: session.endReason,
    activeMs: session.elapsedMs(session.endTime), engagedPct: metrics.engagedPct,
    averageRecoveryMs: metrics.averageRecoveryMs, distractionCount: metrics.distractionCount,
    recoveryCount: metrics.recoveryCount, longestDistractionMs: metrics.longestDistractionMs,
  });
  if (!record) throw new Error("This session summary could not be saved.");
  return record;
}

export class HistoryStore {
  constructor(getStorage = () => globalThis.localStorage, profileId = getCurrentProfileId()) {
    if (!validProfileId(profileId)) throw new Error("A profileId is required for summary history.");
    this.profileId = profileId;
    this.otherRecords = [];
    this.getStorage = getStorage;
    this.data = empty();
    this.load();
  }

  load() {
    try {
      const raw = this.getStorage().getItem(HISTORY_KEY);
      const parsed = raw === null ? empty() : JSON.parse(raw);
      if (parsed?.version !== 1 || typeof parsed.enabled !== "boolean" || !Array.isArray(parsed.records)) throw new Error("format");
      // Old local-only summaries predate profiles. Assign those legacy records
      // to the current browser profile, retaining their existing metrics.
      const records = parsed.records.map((record) => validateRecord({ ...record, profileId: record?.profileId ?? this.profileId }));
      if (records.some((record) => !record) || new Set(records.map((record) => record.id)).size !== records.length) throw new Error("format");
      this.otherRecords = records.filter((record) => record.profileId !== this.profileId);
      this.data = { version: 1, enabled: parsed.enabled, records: records.filter((record) => record.profileId === this.profileId).sort((a, b) => a.endTime - b.endTime).slice(-HISTORY_LIMIT) };
      this.available = true; this.message = "";
    } catch {
      this.available = false;
      this.message = "Saved history is unavailable or could not be read. Sessions still work. Allow browser storage, or clear history to reset it.";
    }
    return this.data;
  }

  write(next) {
    try {
      this.getStorage().setItem(HISTORY_KEY, JSON.stringify({ ...next, records: [...this.otherRecords, ...next.records] }));
      this.data = next; this.available = true; this.message = "";
      return true;
    } catch {
      this.available = false;
      this.message = "History could not be saved. Browser storage may be blocked or full. Your session summary is still available here.";
      return false;
    }
  }

  setEnabled(enabled) {
    this.load();
    return this.available && this.write({ ...this.data, enabled: Boolean(enabled) });
  }

  save(session) {
    this.load(); // Read again so another tab's recent saves are preserved.
    if (!this.available) return { saved: false, message: this.message };
    if (!this.data.enabled) return { saved: false, message: "History is off. This summary stays in this tab until you leave or reload." };
    let record;
    try { record = summarizeSession(session, globalThis.crypto.randomUUID(), this.profileId); }
    catch (error) { return { saved: false, message: error.message }; }
    const records = [...this.data.records, record].sort((a, b) => a.endTime - b.endTime).slice(-HISTORY_LIMIT);
    const saved = this.write({ ...this.data, records });
    return { saved, message: saved ? "Summary saved to history on this device. Camera stopped." : this.message };
  }

  clear() {
    this.load();
    try {
      if (this.otherRecords.length) this.getStorage().setItem(HISTORY_KEY, JSON.stringify({ ...empty(), records: this.otherRecords }));
      else this.getStorage().removeItem(HISTORY_KEY);
      this.data = empty(); this.available = true; this.message = "";
      return true;
    } catch {
      this.message = "History could not be cleared. Allow browser storage and try again.";
      return false;
    }
  }
}

export function recoveryTrend(records) {
  const eligible = records.filter((record) => record.averageRecoveryMs !== null);
  if (eligible.length < 2) return { direction: "waiting", count: eligible.length, differenceMs: null };
  const differenceMs = eligible.at(-1).averageRecoveryMs - eligible[0].averageRecoveryMs;
  return { direction: Math.abs(differenceMs) < 50 ? "steady" : differenceMs < 0 ? "faster" : "slower", count: eligible.length, differenceMs: Math.abs(differenceMs) };
}
