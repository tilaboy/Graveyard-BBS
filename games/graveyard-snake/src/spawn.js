// @ts-check
// Creature and spider spawning (design §7). Stub from task 1; task 4 replaces the bodies.
import { notImplemented } from "./notImplemented.js";

/** @typedef {import("./config.js").Cell} Cell */
/** @typedef {import("./config.js").Creature} Creature */
/** @typedef {import("./config.js").Spider} Spider */

/**
 * @param {number} rng PRNG state word
 * @param {ReadonlyArray<Cell>} snake
 * @param {ReadonlyArray<Spider>} spiders
 * @returns {[Creature | null, number]} [creature or null when no free cell, next word]
 */
export function spawnCreature(rng, snake, spiders) {
  (void rng, void snake, void spiders);
  return notImplemented("spawnCreature");
}

/**
 * @param {number} rng PRNG state word
 * @param {ReadonlyArray<Cell>} snake head first
 * @param {Creature | null} creature
 * @param {ReadonlyArray<Spider>} spiders
 * @returns {[Spider | null, number]} [spider or null after 50 failed tries, next word]
 */
export function spawnSpider(rng, snake, creature, spiders) {
  (void rng, void snake, void creature, void spiders);
  return notImplemented("spawnSpider");
}
