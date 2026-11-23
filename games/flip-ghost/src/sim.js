// @ts-check
// Pure, deterministic simulation step (R1, R4, R5.11, design §5). Task 8.
import { notImplemented } from './notImplemented.js';

/** @typedef {import('./config.js').State} State */
/** @typedef {import('./config.js').Input} Input */

/**
 * @param {number} _seed
 * @returns {State}
 */
export function initialState(_seed) {
  return notImplemented('sim.initialState');
}

/**
 * @param {State} _state
 * @param {Input[]} _inputs
 * @returns {State}
 */
export function step(_state, _inputs) {
  return notImplemented('sim.step');
}
