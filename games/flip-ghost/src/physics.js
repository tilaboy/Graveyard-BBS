// @ts-check
import { FLIP_VY, GRAVITY, MAX_FALL_VY } from './config.js';

/** @typedef {{ y: number, vy: number }} Ghost */

/**
 * Clamp a vertical velocity to [FLIP_VY, MAX_FALL_VY] (R2.2, R2.4).
 * @param {number} vy
 * @returns {number}
 */
export function clampVy(vy) {
  return Math.min(MAX_FALL_VY, Math.max(FLIP_VY, vy));
}

/**
 * A flip replaces the current velocity with the flip velocity (R2.1).
 * @param {Ghost} ghost
 * @returns {Ghost}
 */
export function flip(ghost) {
  return { y: ghost.y, vy: FLIP_VY };
}

/**
 * One tick of gravity: add GRAVITY, clamp, then move by the new velocity (R2.2).
 * @param {Ghost} ghost
 * @returns {Ghost}
 */
export function applyGravity(ghost) {
  const vy = clampVy(ghost.vy + GRAVITY);
  return { y: ghost.y + vy, vy };
}
