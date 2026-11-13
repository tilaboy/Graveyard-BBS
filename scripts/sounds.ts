/** Task 15: render the theme's synthesised effects to 16-bit mono WAV in assets/sounds/. */
import { mkdirSync, writeFileSync } from "node:fs";
import { SAMPLE_RATE, synth } from "../packages/term/src/sounds.ts";
import { SOUNDS } from "../packages/term/src/theme.ts";

function wav(samples: Float32Array): Buffer {
  const data = Buffer.alloc(samples.length * 2);
  samples.forEach((x, i) => data.writeInt16LE(Math.round(x * 32767), i * 2));
  const h = Buffer.alloc(44);
  h.write("RIFF", 0);
  h.writeUInt32LE(36 + data.length, 4);
  h.write("WAVEfmt ", 8);
  h.writeUInt32LE(16, 16); // fmt chunk size
  h.writeUInt16LE(1, 20); // PCM
  h.writeUInt16LE(1, 22); // mono
  h.writeUInt32LE(SAMPLE_RATE, 24);
  h.writeUInt32LE(SAMPLE_RATE * 2, 28);
  h.writeUInt16LE(2, 32);
  h.writeUInt16LE(16, 34);
  h.write("data", 36);
  h.writeUInt32LE(data.length, 40);
  return Buffer.concat([h, data]);
}

const out = new URL("../assets/sounds/", import.meta.url);
mkdirSync(out, { recursive: true });
for (const name of SOUNDS)
  writeFileSync(new URL(`${name}.wav`, out), wav(synth(name)));
console.log(`wrote ${SOUNDS.length} WAVs to assets/sounds/`);
