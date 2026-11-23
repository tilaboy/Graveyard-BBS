// @ts-check
// Synthesised Web Audio sound, off until M (R7). No audio files (R7.1).

/** @typedef {'flip'|'phase-on'|'phase-off'|'score'|'die'} SoundName */

/**
 * One oscillator voice: frequency glides from `from` to `to` over `dur` seconds while the gain
 * rises to `peak` in 10 ms and decays back to silence.
 * @typedef {{ type: OscillatorType, from: number, to: number, dur: number, peak: number, at?: number }} Voice
 */

/** @type {Record<SoundName, Voice[]>} */
export const VOICES = {
  // short whoosh: a quick downward sweep
  flip: [{ type: 'triangle', from: 700, to: 250, dur: 0.12, peak: 0.18 }],
  // rising shimmer: two detuned voices sweeping up
  'phase-on': [
    { type: 'sine', from: 400, to: 1600, dur: 0.5, peak: 0.15 },
    { type: 'sine', from: 404, to: 1616, dur: 0.5, peak: 0.1 },
  ],
  // low tone: steady sine
  'phase-off': [{ type: 'sine', from: 180, to: 140, dur: 0.4, peak: 0.2 }],
  // soft tick: very short high blip
  score: [{ type: 'square', from: 1200, to: 1200, dur: 0.04, peak: 0.06 }],
  // coffin thud: low sine falling fast, plus a knock
  die: [
    { type: 'sine', from: 110, to: 40, dur: 0.6, peak: 0.4 },
    { type: 'square', from: 70, to: 50, dur: 0.08, peak: 0.12, at: 0.02 },
  ],
};

/**
 * Sound is off until `toggle()` is first called (the M key), and the AudioContext is created
 * only then, to respect browser autoplay rules (R7.2).
 * @param {typeof AudioContext} AudioContextCtor
 * @returns {{ toggle: () => boolean, play: (name: SoundName) => void }}
 */
export function createSound(AudioContextCtor) {
  /** @type {AudioContext | null} */
  let ctx = null;
  let on = false;

  /** @param {AudioContext} c @param {Voice} v */
  function voice(c, v) {
    const t0 = c.currentTime + (v.at ?? 0);
    const osc = c.createOscillator();
    const gain = c.createGain();
    osc.type = v.type;
    osc.frequency.setValueAtTime(v.from, t0);
    if (v.to !== v.from) osc.frequency.exponentialRampToValueAtTime(v.to, t0 + v.dur);
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(v.peak, t0 + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + v.dur);
    osc.connect(gain);
    gain.connect(c.destination);
    osc.start(t0);
    osc.stop(t0 + v.dur + 0.02);
  }

  return {
    toggle() {
      on = !on;
      if (on) {
        if (!ctx) ctx = new AudioContextCtor();
        if (ctx.state === 'suspended') void ctx.resume();
      }
      return on;
    },
    play(name) {
      if (!on || !ctx) return;
      const voices = VOICES[name];
      if (!voices) return;
      for (const v of voices) voice(ctx, v);
    },
  };
}
