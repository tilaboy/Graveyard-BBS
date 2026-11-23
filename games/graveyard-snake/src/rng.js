// @ts-check
// mulberry32 seeded PRNG (design §4). Every function takes the state word and returns
// [value, nextWord]; nothing holds hidden state, so replay is deterministic (R1.5, R1.6).

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

/**
 * Uniform integer in [lo, hi], both inclusive. One draw per call.
 * @param {number} word
 * @param {number} lo integer
 * @param {number} hi integer, hi >= lo
 * @returns {[number, number]} [int in [lo, hi], next state word]
 */
export function randInt(word, lo, hi) {
  const [value, nextWord] = next(word);
  const span = hi - lo + 1;
  return [lo + Math.min(span - 1, Math.floor(value * span)), nextWord];
}

/**
 * Pick a key by positive integer weights. One draw per call; entries are read in order.
 * @template {string} K
 * @param {number} word
 * @param {ReadonlyArray<readonly [K, number]>} entries [key, weight] pairs
 * @returns {[K, number]} [picked key, next state word]
 */
export function pickWeighted(word, entries) {
  if (entries.length === 0) throw new Error("pickWeighted: no entries");
  let total = 0;
  for (const [, weight] of entries) total += weight;
  const [roll, nextWord] = randInt(word, 0, total - 1);
  let acc = 0;
  for (const [key, weight] of entries) {
    acc += weight;
    if (roll < acc) return [key, nextWord];
  }
  return [entries[entries.length - 1][0], nextWord];
}
