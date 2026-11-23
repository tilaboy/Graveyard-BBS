// @ts-check
// Superpower machine ready -> active -> cooldown -> ready (R5, design §6). Task 3.
import { notImplemented } from './notImplemented.js';

/** @typedef {import('./config.js').State} State */
/** @typedef {State['power']} Power */

/**
 * @param {State} _state
 * @returns {State}
 */
export function trigger(_state) {
  return notImplemented('power.trigger');
}

/**
 * @param {State} _state
 * @returns {State}
 */
export function tickPower(_state) {
  return notImplemented('power.tickPower');
}

/**
 * @param {Power} _power
 * @returns {string} `PHASE (P)`, `PHASING 7s` or `COOLDOWN 12s`
 */
export function powerLabel(_power) {
  return notImplemented('power.powerLabel');
}
