import { MOTION } from "./theme.js";
import type { View } from "./state.js";

/** 0..1 progress of animation `key`. Reduced motion (or never started) is the final frame. */
export function progress(v: View, key: string, ms: number): number {
  const t0 = v.fx[key];
  if (v.reducedMotion || t0 === undefined) return 1;
  return Math.min(1, Math.max(0, (v.now - t0) / ms));
}

/** Lantern flicker: on/off at most twice a second. Reduced motion: always on, no loop. */
export function lit(v: View): boolean {
  return (
    v.reducedMotion || Math.floor(v.now / MOTION.flickerHalfPeriod) % 2 === 0
  );
}
