import { validProfileId } from "./profile.js";

export const PACING_KEY = "focuslens.pacing.v1";

export function firstDistractionTime(session) {
  if (session.state !== "ended" || !Number.isFinite(session.startTime) || !Number.isFinite(session.endTime)) {
    throw new Error("Pacing uses ended sessions only.");
  }
  const first = session.events.find((event) => event.type === "distracted");
  if (!first) return null; // No distraction is not a zero-minute data point.
  const elapsed = first.start - session.startTime;
  if (!Number.isFinite(elapsed) || elapsed < 0 || first.start > session.endTime) throw new Error("Invalid first-distraction timestamp.");
  return elapsed; // Milliseconds, at confirmation; includes pauses by definition.
}

function validRecord(record) {
  return record && validProfileId(record.profileId) && typeof record.date === "string" && Number.isFinite(Date.parse(record.date))
    && (record.timeToFirstDistraction === null || Number.isFinite(record.timeToFirstDistraction) && record.timeToFirstDistraction >= 0);
}

export function suggestedMinutes(history, profileId) {
  const times = history.filter((record) => validRecord(record) && record.profileId === profileId && record.timeToFirstDistraction !== null)
    .map((record) => record.timeToFirstDistraction).sort((a, b) => a - b);
  if (!times.length) return null;
  // The spec selects the upper middle value for an even-sized history.
  const medianMinutes = times[Math.floor(times.length / 2)] / 60000;
  return Math.max(5, Math.min(45, Math.round(medianMinutes / 5) * 5));
}

export class PacingStore {
  constructor(profileId, getStorage = () => globalThis.localStorage) {
    if (!validProfileId(profileId)) throw new Error("A profileId is required for pacing history.");
    Object.assign(this, { profileId, getStorage });
    this.records = [];
    this.message = "";
    this.load();
  }

  load() {
    try {
      const raw = this.getStorage().getItem(PACING_KEY);
      const records = raw === null ? [] : JSON.parse(raw);
      if (!Array.isArray(records) || !records.every(validRecord)) throw new Error("Invalid pacing history");
      this.records = records.map(({ profileId, date, timeToFirstDistraction }) => ({ profileId, date, timeToFirstDistraction }));
      this.available = true; this.message = "";
    } catch {
      this.available = false;
      this.message = "Pacing history is unavailable. Your session length stays editable.";
    }
    return this.records;
  }

  suggestion() { return suggestedMinutes(this.load(), this.profileId); }

  clear() {
    this.load();
    if (!this.available) return false;
    try {
      const others = this.records.filter((record) => record.profileId !== this.profileId);
      this.getStorage().setItem(PACING_KEY, JSON.stringify(others));
      this.records = others; this.message = "";
      return true;
    } catch { this.message = "Pacing history could not be cleared."; return false; }
  }

  save(session) {
    this.load();
    if (!this.available) return false;
    try {
      const record = { profileId: this.profileId, date: new Date(session.endTime).toISOString(), timeToFirstDistraction: firstDistractionTime(session) };
      const records = [...this.records, record];
      this.getStorage().setItem(PACING_KEY, JSON.stringify(records));
      this.records = records;
      return true;
    } catch {
      this.message = "Pacing history could not be saved. The session summary is still available.";
      return false;
    }
  }
}
