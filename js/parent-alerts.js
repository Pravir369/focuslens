// Read-only observer of confirmed records. It never changes classification,
// events, the two audio stages, or the session's clocks and pause behavior.
export const PARENT_ALERT_MS = 10 * 60 * 1000;
export const ALERT_OBSERVATION_GAP_MS = 1000;

export class ParentAlertObserver {
  constructor(send, { notify = () => {} } = {}) {
    this.send = send; this.notify = notify;
    this.sessions = new WeakMap(); this.disposed = false;
  }
  update(session, now, usable) {
    if (this.disposed || !session) return;
    let state = this.sessions.get(session);
    if (!state) { state = { event: null, since: null, last: null, fired: new WeakSet() }; this.sessions.set(session, state); }
    const event = session.events.at(-1);
    if (session.state !== 'running' || !usable || event?.type !== 'distracted' || event.end !== null) {
      state.event = null; state.since = state.last = null; return;
    }
    if (state.event !== event || state.last === null || now < state.last || now - state.last > ALERT_OBSERVATION_GAP_MS) {
      state.event = event; state.since = now;
    }
    state.last = now;
    if (now - state.since < PARENT_ALERT_MS || state.fired.has(event)) return;
    // Mark before making a request. A timeout may already have sent it; neither
    // a render tick nor a resumed observation can resend this event.
    state.fired.add(event);
    const since = state.since;
    const isCurrent = () => !this.disposed && session.state === 'running' && event.end === null &&
      state.event === event && state.since === since && session.events.at(-1) === event;
    const payload = { eventStartMs: Math.round(event.start), distractionDurationMs: Math.floor(now - state.since) };
    void Promise.resolve().then(() => isCurrent() ? this.send(session, payload, isCurrent) : null).then(result => {
      if (this.disposed || !result) return;
      this.notify(result.status === 'noRecipients' ? 'No linked parent phone is connected for this check-in.'
        : 'A parent check-in was requested. Provider acceptance does not confirm phone delivery.');
    }).catch(() => { if (!this.disposed) this.notify('The parent check-in could not be confirmed. It will not be sent again for this distraction; study tracking continues.'); });
  }
  dispose() { this.disposed = true; }
}
