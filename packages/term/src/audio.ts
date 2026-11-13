/** Task 17: plays the synthesised samples through Web Audio. Created only after the user unmutes. */
import { SAMPLE_RATE, synth } from "./sounds.js";
import type { SoundName } from "./theme.js";

export function createAudio() {
  let ctx: AudioContext | undefined;
  const cache = new Map<SoundName, AudioBuffer>();
  return {
    play(name: SoundName): void {
      ctx ??= new AudioContext();
      if (ctx.state === "suspended") void ctx.resume();
      let b = cache.get(name);
      if (!b) {
        const s = synth(name);
        b = ctx.createBuffer(1, s.length, SAMPLE_RATE);
        b.copyToChannel(s, 0);
        cache.set(name, b);
      }
      const src = ctx.createBufferSource();
      const gain = ctx.createGain();
      gain.gain.value = 0.5;
      src.buffer = b;
      src.connect(gain).connect(ctx.destination);
      src.start();
    },
  };
}
