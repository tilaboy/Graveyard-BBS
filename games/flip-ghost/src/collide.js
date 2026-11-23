// @ts-check
// AABB collision with phase rules and exit grace (R1.5, R5.3-R5.6, design §7). Task 4.
import { notImplemented } from './notImplemented.js';

/** @typedef {import('./config.js').State} State */
/** @typedef {{ x: number, y: number, w: number, h: number }} Box */
/** @typedef {import('./config.js').Obstacle} Obstacle */

/**
 * @param {Box} _box
 * @param {Obstacle} _obstacle
 * @returns {boolean}
 */
export function hits(_box, _obstacle) {
  return notImplemented('collide.hits');
}

/**
 * @param {State} _state
 * @returns {State}
 */
export function collide(_state) {
  return notImplemented('collide.collide');
}
