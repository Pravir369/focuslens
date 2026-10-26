export class AudioCues {
  constructor(createContext = () => new (window.AudioContext || window.webkitAudioContext)()) {
    this.createContext = createContext;
    this.context = null;
    this.voices = new Set();
  }
  async unlock() {
    try {
      this.context ??= this.createContext();
      await this.context.resume();
      return this.context.state === "running";
    } catch { return false; }
  }
  play(stage) {
    if (this.context?.state !== "running") return false;
    const notes = stage === 2 ? [440, 554] : [440];
    const level = stage === 2 ? 0.15 : 0.08;
    try {
    notes.forEach((frequency, index) => {
      const oscillator = this.context.createOscillator();
      const gain = this.context.createGain();
      const start = this.context.currentTime + index * 0.2;
      oscillator.type = "sine";
      oscillator.frequency.setValueAtTime(frequency, start);
      gain.gain.setValueAtTime(0, start);
      gain.gain.linearRampToValueAtTime(level, start + 0.01);
      gain.gain.setValueAtTime(level, start + 0.12);
      gain.gain.linearRampToValueAtTime(0, start + 0.15);
      oscillator.connect(gain);
      gain.connect(this.context.destination);
      const voice = { oscillator, gain };
      this.voices.add(voice);
      oscillator.onended = () => {
        oscillator.disconnect(); gain.disconnect(); this.voices.delete(voice);
      };
      oscillator.start(start);
      oscillator.stop(start + 0.16);
    });
      return true;
    } catch {
      this.cancel();
      return false;
    }
  }
  cancel() {
    for (const { oscillator, gain } of this.voices) {
      try { oscillator.stop(); } catch { /* Already ended. */ }
      oscillator.disconnect(); gain.disconnect();
    }
    this.voices.clear();
  }
  close() {
    this.cancel();
    const context = this.context;
    this.context = null;
    return context?.close().catch(() => {});
  }
}
