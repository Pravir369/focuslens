export const WINDOW_FRESHNESS_MS = 7000;
export const WINDOW_POLL_MS = 2000;

export class WindowSignal {
  constructor(profileId, { fetcher = (...args) => fetch(...args), now = () => Date.now(),
    onStatus = () => {}, setTimer = (fn, ms) => setInterval(fn, ms), clearTimer = (timer) => clearInterval(timer) } = {}) {
    Object.assign(this, { profileId, fetcher, now, onStatus, setTimer, clearTimer });
    this.active = this.enabled = this.busy = false;
    this.generation = 0; this.revision = 0; this.latest = null; this.allowedApps = [];
    this.timer = this.setTimer(() => { void this.poll(); }, WINDOW_POLL_MS);
  }

  start(sessionId, { enabled, allowedApps }) {
    this.sessionId = sessionId; this.revision = 0;
    this.enabled = enabled; this.allowedApps = allowedApps;
    this.active = true; this.reset();
    this.onStatus(enabled ? "Waiting for the local app monitor…" : "App monitoring is off.");
    if (enabled) void this.poll();
  }

  reset() {
    this.generation++; this.latest = null; this.minimumObservedAt = this.now();
    this.abort?.abort(); this.busy = false;
  }

  payload() {
    return { profileId: this.profileId, sessionId: this.sessionId, revision: ++this.revision,
      active: this.active, monitorEnabled: this.enabled, allowedApps: this.allowedApps };
  }

  async notifyStopped() {
    if (!this.sessionId || !this.enabled) return;
    try { await this.fetcher(`/sessions/${encodeURIComponent(this.sessionId)}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(this.payload()), keepalive: true }); }
    catch { /* Server leases expire if the page/server disappears. */ }
  }

  pause() { this.active = false; this.reset(); void this.notifyStopped(); this.onStatus(this.enabled ? "App monitoring is paused." : "App monitoring is off."); }
  resume() { this.active = true; this.reset(); if (this.enabled) { this.onStatus("Waiting for a fresh app reading…"); void this.poll(); } }
  stop() { this.active = false; this.reset(); void this.notifyStopped(); this.enabled = false; this.onStatus("App monitoring is off."); }

  async poll() {
    if (!this.active || !this.enabled || this.busy) return;
    this.busy = true;
    const generation = this.generation;
    const abort = new AbortController(); this.abort = abort;
    const timeout = setTimeout(() => abort.abort(), 1500);
    try {
      let response = await this.fetcher(`/sessions/${encodeURIComponent(this.sessionId)}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(this.payload()), signal: abort.signal });
      if (!response.ok) throw new Error("Local session registration unavailable");
      response = await this.fetcher(`/active-window-status?profileId=${encodeURIComponent(this.profileId)}`, { signal: abort.signal });
      if (!response.ok) throw new Error("Local app monitor unavailable");
      const row = await response.json();
      if (generation !== this.generation) return;
      this.latest = row.profileId === this.profileId && row.sessionId === this.sessionId && row.available && typeof row.isOnTask === "boolean"
        && Number.isFinite(row.observedAt) && row.observedAt >= this.minimumObservedAt && row.observedAt <= this.now() ? row : null;
      this.onStatus(this.fresh() ? `${this.latest.appName}: ${this.latest.isOnTask ? "on your study list" : "outside your study list"}. App name only; no screen capture.`
        : "No fresh app reading. Camera tracking continues.");
    } catch {
      if (generation === this.generation) { this.latest = null; this.onStatus("App monitor unavailable. Camera tracking continues."); }
    } finally {
      clearTimeout(timeout);
      if (generation === this.generation) this.busy = false;
    }
  }

  fresh() {
    const age = this.latest ? this.now() - this.latest.observedAt : Infinity;
    return this.enabled && this.active && age >= 0 && age <= WINDOW_FRESHNESS_MS;
  }
  offTask() { try { return this.fresh() && !this.latest.isOnTask; } catch { return false; } }
  dispose() { this.stop(); this.clearTimer(this.timer); }
}
