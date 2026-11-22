/**
 * Task 17: plays the synthesised samples through Web Audio. The context is made on the first
 * [M] (a key press, so a user gesture) and resumed there: browsers keep a context "suspended"
 * until a gesture resumes it, and a suspended context plays nothing.
 */
import { SAMPLE_RATE, synth } from "./sounds.js";
import type { SoundName } from "./theme.js";

/** The slice of AudioContext we use (tests pass a fake). */
export type AudioCtx = Pick<
  AudioContext,
  | "state"
  | "resume"
  | "createBuffer"
  | "createBufferSource"
  | "createGain"
  | "destination"
>;

export function createAudio(make: () => AudioCtx = () => new AudioContext()) {
  let ctx: AudioCtx | undefined;
  const cache = new Map<SoundName, AudioBuffer>();
  const ready = (): AudioCtx => {
    ctx ??= make();
    // "suspended" before a gesture; Safari also uses "interrupted". A refused resume stays silent.
    if (ctx.state !== "running") ctx.resume().catch(() => undefined);
    return ctx;
  };
  return {
    /** Call from the key handler that turns sound on. */
    resume(): void {
      ready();
    },
    play(name: SoundName): void {
      const c = ready();
      let b = cache.get(name);
      if (!b) {
        const s = synth(name);
        b = c.createBuffer(1, s.length, SAMPLE_RATE);
        b.copyToChannel(s, 0);
        cache.set(name, b);
      }
      const src = c.createBufferSource();
      const gain = c.createGain();
      gain.gain.value = 0.5;
      src.buffer = b;
      src.connect(gain).connect(c.destination);
      src.start();
    },
  };
}
