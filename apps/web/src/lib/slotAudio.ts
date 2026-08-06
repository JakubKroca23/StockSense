"use client";

/** Lightweight procedural SFX via Web Audio — no asset files. */
class SlotAudio {
  private ctx: AudioContext | null = null;
  muted = false;

  private ensure(): AudioContext | null {
    if (typeof window === "undefined") return null;
    if (this.muted) return null;
    if (!this.ctx) {
      const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new AC();
    }
    if (this.ctx.state === "suspended") void this.ctx.resume();
    return this.ctx;
  }

  setMuted(v: boolean) {
    this.muted = v;
  }

  private tone(
    freq: number,
    duration: number,
    type: OscillatorType,
    gain = 0.08,
    when = 0,
    slideTo?: number
  ) {
    const ctx = this.ensure();
    if (!ctx) return;
    const t0 = ctx.currentTime + when;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (slideTo != null) osc.frequency.exponentialRampToValueAtTime(Math.max(40, slideTo), t0 + duration);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain, t0 + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
    osc.connect(g);
    g.connect(ctx.destination);
    osc.start(t0);
    osc.stop(t0 + duration + 0.02);
  }

  click() {
    this.tone(420, 0.05, "triangle", 0.05);
  }

  spinStart() {
    this.tone(180, 0.12, "sawtooth", 0.04, 0, 90);
    this.tone(320, 0.18, "square", 0.03, 0.04, 160);
  }

  reelTick() {
    this.tone(620 + Math.random() * 80, 0.035, "square", 0.025);
  }

  reelStop() {
    this.tone(240, 0.08, "triangle", 0.06, 0, 140);
  }

  winSmall() {
    this.tone(523, 0.1, "sine", 0.07);
    this.tone(659, 0.12, "sine", 0.06, 0.08);
    this.tone(784, 0.16, "sine", 0.05, 0.16);
  }

  winBig() {
    [523, 659, 784, 1046].forEach((f, i) => this.tone(f, 0.22, "sine", 0.08, i * 0.09));
    this.tone(200, 0.4, "triangle", 0.04, 0, 400);
  }

  lose() {
    this.tone(220, 0.15, "triangle", 0.04, 0, 110);
  }

  coin() {
    this.tone(880, 0.08, "sine", 0.06);
    this.tone(1320, 0.1, "sine", 0.04, 0.05);
  }

  freeSpin() {
    this.tone(400, 0.12, "sawtooth", 0.05, 0, 800);
    this.tone(600, 0.18, "sine", 0.06, 0.1);
    this.tone(900, 0.22, "sine", 0.05, 0.2);
  }

  expand() {
    this.tone(150, 0.35, "sawtooth", 0.05, 0, 500);
  }
}

export const slotAudio = new SlotAudio();
