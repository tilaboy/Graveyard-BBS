import { describe, expect, it } from "vitest";
import { synth, SAMPLE_RATE } from "../src/sounds.js";
import { SOUNDS } from "../src/theme.js";

describe("R5.5 synthesised sounds", () => {
  for (const name of SOUNDS)
    it(`${name} is audible, bounded and deterministic`, () => {
      const a = synth(name);
      expect(a.length).toBeGreaterThan(SAMPLE_RATE / 4);
      expect(Math.max(...a.map(Math.abs))).toBeGreaterThan(0.05);
      expect(Math.max(...a.map(Math.abs))).toBeLessThanOrEqual(1);
      expect(synth(name)).toEqual(a);
    });
});
