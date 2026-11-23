// @ts-check
// Synthesised Web Audio sound (design §12, R8.1 to R8.3). No audio files (R8.2).

/** @typedef {'chime'|'eat-ghost'|'eat-skeleton'|'eat-dinosaur'|'caught'} Voice */
/** @typedef {{enabled: boolean, toggle: () => boolean, play: (name: Voice) => void}} Sound */

/**
 * One oscillator note: `freq` Hz starting `at` seconds after the call, lasting `dur` seconds.
 * The gain rises to `peak` in 10 ms and decays exponentially to silence at `dur`.
 * @typedef {{type: OscillatorType, freq: number, dur: number, peak: number, at: number}} Note
 */

/** @type {Record<Voice, Note[]>} */
export const VOICES = {
  // two sine notes, 660 then 880 Hz, 120 ms each
  chime: [
    { type: "sine", freq: 660, dur: 0.12, peak: 0.15, at: 0 },
    { type: "sine", freq: 880, dur: 0.12, peak: 0.15, at: 0.12 },
  ],
  // square blips, 80 ms, pitch by kind
  "eat-ghost": [{ type: "square", freq: 520, dur: 0.08, peak: 0.08, at: 0 }],
  "eat-skeleton": [{ type: "square", freq: 392, dur: 0.08, peak: 0.08, at: 0 }],
  "eat-dinosaur": [{ type: "square", freq: 196, dur: 0.08, peak: 0.08, at: 0 }],
  // low organ chord: 65, 98, 131 Hz with a 900 ms decay
  caught: [
    { type: "sine", freq: 65, dur: 0.9, peak: 0.2, at: 0 },
    { type: "sine", freq: 98, dur: 0.9, peak: 0.15, at: 0 },
    { type: "sine", freq: 131, dur: 0.9, peak: 0.1, at: 0 },
  ],
};

/**
 * Sound starts disabled. The AudioContext is created lazily on the first `toggle()` (the M key)
 * to respect browser autoplay rules (R8.1). Turning sound on plays the chime (R8.3).
 * @param {() => AudioContext} makeCtx called lazily on the first toggle()
 * @returns {Sound}
 */
export function createSound(makeCtx) {
  /** @type {AudioContext | null} */
  let ctx = null;
  let enabled = false;

  /** @param {AudioContext} c @param {Note} n */
  function note(c, n) {
    const t0 = c.currentTime + n.at;
    const osc = c.createOscillator();
    const gain = c.createGain();
    osc.type = n.type;
    osc.frequency.setValueAtTime(n.freq, t0);
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(n.peak, t0 + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + n.dur);
    osc.connect(gain);
    gain.connect(c.destination);
    osc.start(t0);
    osc.stop(t0 + n.dur + 0.02);
  }

  /** @param {Voice} name */
  function play(name) {
    if (!enabled || !ctx) return;
    const notes = VOICES[name];
    if (!notes) return;
    for (const n of notes) note(ctx, n);
  }

  return {
    get enabled() {
      return enabled;
    },
    toggle() {
      enabled = !enabled;
      if (enabled) {
        if (!ctx) ctx = makeCtx();
        if (ctx.state === "suspended") void ctx.resume();
        play("chime");
      }
      return enabled;
    },
    play,
  };
}
