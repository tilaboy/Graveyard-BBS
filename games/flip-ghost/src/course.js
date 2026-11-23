// @ts-check
import { GAP_H, GAP_MARGIN, GROUND_Y, OBSTACLE_SPACING, OBSTACLE_W, SCROLL_VX, WIDTH } from './config.js';
import { next } from './rng.js';

/** @typedef {import('./config.js').Obstacle} Obstacle */
/** @typedef {{ obstacles: Obstacle[], nextId: number, scrolled: number, rng: number }} Course */

/**
 * Allowed range for an obstacle's gapY, so the whole gap is on screen (R3.2, R3.5).
 * @returns {[number, number]}
 */
export function gapBounds() {
  return [GAP_MARGIN, GROUND_Y - GAP_MARGIN - GAP_H];
}

/**
 * Move every obstacle left by `dx` and count the scroll distance (R2.3).
 * @template {Course} T
 * @param {T} course
 * @param {number} [dx]
 * @returns {T}
 */
export function scroll(course, dx = SCROLL_VX) {
  return {
    ...course,
    obstacles: course.obstacles.map((o) => ({ ...o, x: o.x - dx })),
    scrolled: course.scrolled + dx,
  };
}

/**
 * Spawn a new obstacle at x = WIDTH when the first one is due (nextId 0) or when
 * OBSTACLE_SPACING px have scrolled since the last spawn (R3.1). The gap comes from the
 * seeded PRNG in `course.rng` (R3.2); the gap height is always GAP_H (R3.3).
 * @template {Course} T
 * @param {T} course
 * @returns {T}
 */
export function spawnIfDue(course) {
  if (course.nextId > 0 && course.scrolled < OBSTACLE_SPACING) return course;
  const [value, rng] = next(course.rng);
  const [lo, hi] = gapBounds();
  const gapY = lo + value * (hi - lo);
  /** @type {Obstacle} */
  const obstacle = { x: WIDTH, gapY, scored: false, id: course.nextId };
  return {
    ...course,
    obstacles: [...course.obstacles, obstacle],
    nextId: course.nextId + 1,
    scrolled: course.nextId > 0 ? course.scrolled - OBSTACLE_SPACING : 0,
    rng,
  };
}

/**
 * Remove obstacles that have scrolled fully off the left edge (R3.4).
 * @template {Course} T
 * @param {T} course
 * @returns {T}
 */
export function cull(course) {
  const kept = course.obstacles.filter((o) => o.x + OBSTACLE_W > 0);
  return kept.length === course.obstacles.length ? course : { ...course, obstacles: kept };
}
