/**
 * Task 17 (R5.5): every sound is synthesised here from sine waves and seeded noise.
 * No audio file, sample or third-party library is involved. The browser wraps the samples in
 * Web Audio buffers (audio.ts); tests check them without a browser.
 */
import type { SoundName } from "./theme.js";

export const SAMPLE_RATE = 22_050;
const TAU = Math.PI * 2;

/** Deterministic white noise in [-1, 1) (LCG), so a sound is the same every time. */
function noise(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 2 ** 31 - 1;
  };
}

const buf = (seconds: number) =>
  new Float32Array(Math.round(seconds * SAMPLE_RATE));

function addTone(
  out: Float32Array,
  at: number,
  dur: number,
  hz: number,
  amp: number,
  decay = 0,
): void {
  const n = Math.round(dur * SAMPLE_RATE);
  const i0 = Math.round(at * SAMPLE_RATE);
  for (let i = 0; i < n && i0 + i < out.length; i++) {
    const t = i / SAMPLE_RATE;
    const env = decay > 0 ? Math.exp(-t / decay) : 1;
    const edge = Math.min(1, i / 200, (n - i) / 200); // no clicks at the ends
    out[i0 + i]! += Math.sin(TAU * hz * t) * amp * env * edge;
  }
}

function addNoise(
  out: Float32Array,
  at: number,
  dur: number,
  amp: number,
  rnd: () => number,
  decay = 0,
): void {
  const n = Math.round(dur * SAMPLE_RATE);
  const i0 = Math.round(at * SAMPLE_RATE);
  for (let i = 0; i < n && i0 + i < out.length; i++)
    out[i0 + i]! +=
      rnd() * amp * (decay > 0 ? Math.exp(-i / SAMPLE_RATE / decay) : 1);
}

const clip = (a: Float32Array<ArrayBuffer>): Float32Array<ArrayBuffer> =>
  a.map((x) => Math.max(-1, Math.min(1, x)));

const MAKE: Record<SoundName, () => Float32Array<ArrayBuffer>> = {
  /** 14400 modem handshake flavour: answer tone, carrier warble, hiss. About 3 s. */
  modem() {
    const o = buf(3);
    const r = noise(14400);
    addTone(o, 0, 0.5, 2100, 0.3);
    for (let k = 0; k < 20; k++)
      addTone(o, 0.7 + k * 0.04, 0.04, k % 2 ? 2400 : 1200, 0.25);
    addNoise(o, 1.5, 1.5, 0.12, r, 1.2);
    for (let k = 0; k < 8; k++)
      addTone(o, 1.6 + k * 0.15, 0.1, 1800 + (k % 3) * 300, 0.1);
    return clip(o);
  },
  /** Church bell, two tolls. */
  bell() {
    const o = buf(3.4);
    for (const at of [0, 1.6])
      [1, 2, 2.4, 3, 4.2].forEach((p, i) =>
        addTone(o, at, 1.6, 196 * p, 0.3 / (i + 1), 0.5),
      );
    return clip(o);
  },
  /** Low organ chord (C minor). */
  organ() {
    const o = buf(1.8);
    for (const hz of [65.4, 77.8, 98, 130.8])
      [1, 2, 3].forEach((h) => addTone(o, 0, 1.8, hz * h, 0.2 / h, 0.9));
    return clip(o);
  },
  /** Coffin lid thud. */
  thud() {
    const o = buf(0.5);
    const n = o.length;
    let phase = 0;
    for (let i = 0; i < n; i++) {
      const t = i / SAMPLE_RATE;
      phase += (TAU * (40 + 80 * Math.exp(-t / 0.05))) / SAMPLE_RATE;
      o[i] = Math.sin(phase) * 0.9 * Math.exp(-t / 0.12);
    }
    addNoise(o, 0, 0.03, 0.4, noise(7), 0.01);
    return clip(o);
  },
  /** Soft wind howl: low-passed noise, slowly swelling. */
  wind() {
    const o = buf(2);
    const r = noise(31);
    let lp = 0;
    for (let i = 0; i < o.length; i++) {
      const t = i / SAMPLE_RATE;
      lp += 0.05 * (r() - lp);
      o[i] =
        lp *
        2.5 *
        Math.sin((Math.PI * t) / 2) *
        (0.6 + 0.4 * Math.sin(TAU * 0.8 * t));
    }
    return clip(o);
  },
  /** NO CARRIER: a relay click, then static. */
  nocarrier() {
    const o = buf(0.7);
    addTone(o, 0, 0.004, 900, 0.8);
    addNoise(o, 0.05, 0.6, 0.25, noise(99), 0.25);
    return clip(o);
  },
};

export function synth(name: SoundName): Float32Array<ArrayBuffer> {
  return MAKE[name]();
}
