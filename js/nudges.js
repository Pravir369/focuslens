export const FIRST_NUDGE_MS = 15000;
export const SECOND_NUDGE_MS = 45000;

export class DistractionNudges {
  constructor() { this.reset(); }
  reset() {
    this.event = null;
    this.firstFired = false;
    this.secondFired = false;
    this.dismissed = false;
  }
  update(event, now, running = true, usable = true) {
    if (!running || event?.type !== "distracted" || event.end !== null) {
      this.reset();
      return [];
    }
    if (this.event !== event) { this.reset(); this.event = event; }
    if (!usable) return [];
    const elapsed = now - event.start;
    if (elapsed >= SECOND_NUDGE_MS && !this.secondFired) {
      // A delayed UI tick emits only the highest cue due, not two at once.
      this.firstFired = this.secondFired = true;
      return [2];
    }
    if (elapsed >= FIRST_NUDGE_MS && !this.firstFired) {
      this.firstFired = true;
      return [1];
    }
    return [];
  }
  dismiss() { this.dismissed = true; }
  get bannerVisible() { return this.secondFired && !this.dismissed; }
}
