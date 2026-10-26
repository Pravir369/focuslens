export class EventLog {
  constructor() { this.events = []; }

  transition({ from, to, at, triggerSource }) {
    const ongoing = this.events.at(-1);
    if (ongoing?.end === null) {
      if (ongoing.type !== from) throw new Error("Event log and classifier are out of sync.");
      this.close(at);
    }
    this.events.push({ type: to, start: at, end: null, duration: null,
      ...(to === "distracted" && ["cameraA", "cameraB", "window"].includes(triggerSource) ? { triggerSource } : {}) });
  }

  close(at) {
    const ongoing = this.events.at(-1);
    if (ongoing?.end === null) {
      ongoing.end = at;
      ongoing.duration = Math.max(0, at - ongoing.start);
    }
  }
}

