// @ts-check
// mulberry32 seeded PRNG. The state word lives in State.rng so replay is deterministic (R1.7).

/**
 * Normalise any number to an unsigned 32-bit seed word.
 * @param {number} seed
 * @returns {number}
 */
export function seedWord(seed) {
  return Number.isFinite(seed) ? Math.trunc(seed) >>> 0 : 0;
}

/**
 * One mulberry32 step.
 * @param {number} word current PRNG state (uint32)
 * @returns {[number, number]} [value in [0, 1), next state word]
 */
export function next(word) {
  const nextWord = (seedWord(word) + 0x6d2b79f5) >>> 0;
  let t = nextWord;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  const value = ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  return [value, nextWord];
}
