// @ts-check
// AABB collision with phase rules and exit grace (R1.5, R5.3-R5.6, design §7). Task 4.
import {
  GAP_H,
  GHOST_H,
  GHOST_W,
  GHOST_X,
  GROUND_Y,
  OBSTACLE_W,
} from "./config.js";

/** @typedef {import('./config.js').State} State */
/** @typedef {{ x: number, y: number, w: number, h: number }} Box */
/** @typedef {import('./config.js').Obstacle} Obstacle */

/**
 * Strict AABB overlap: boxes that only touch along an edge do not overlap.
 * @param {Box} a
 * @param {Box} b
 * @returns {boolean}
 */
function overlaps(a, b) {
  return (
    a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h
  );
}

/**
 * The two gravestone boxes of an obstacle (design §7). A box of height 0 is never hit.
 * @param {Obstacle} o
 * @returns {[Box, Box]}
 */
export function obstacleBoxes(o) {
  const bottomY = o.gapY + GAP_H;
  return [
    { x: o.x, y: 0, w: OBSTACLE_W, h: o.gapY },
    { x: o.x, y: bottomY, w: OBSTACLE_W, h: GROUND_Y - bottomY },
  ];
}

/**
 * The fixed ghost hitbox at height `y` (design §7).
 * @param {number} y
 * @returns {Box}
 */
export function ghostBox(y) {
  return { x: GHOST_X, y, w: GHOST_W, h: GHOST_H };
}

/**
 * Whether `box` overlaps the top or bottom gravestone of `obstacle`.
 * @param {Box} box
 * @param {Obstacle} obstacle
 * @returns {boolean}
 */
export function hits(box, obstacle) {
  return obstacleBoxes(obstacle).some(
    (b) => b.h > 0 && b.w > 0 && overlaps(box, b),
  );
}

/**
 * Design §5 step 7. Only acts in `playing`; returns the same object when nothing changes.
 * - Ceiling (`y < 0`) or ground (`y + GHOST_H > GROUND_Y`) kills, even while phasing (R1.5, R5.4).
 * - Obstacles are skipped while `power.mode === 'active'` (R5.3).
 * - The `graceId` obstacle is skipped while the ghost overlaps it; `graceId` is cleared once it
 *   no longer overlaps or the obstacle is gone. Every other obstacle is live (R5.5, R5.6).
 * @param {State} state
 * @returns {State}
 */
export function collide(state) {
  if (state.mode !== "playing") return state;
  const box = ghostBox(state.ghost.y);
  const edge = box.y < 0 || box.y + box.h > GROUND_Y;

  let graceId = state.graceId;
  if (graceId !== null) {
    const graced = state.obstacles.find((o) => o.id === graceId);
    if (!graced || !hits(box, graced)) graceId = null;
  }

  const phasing = state.power.mode === "active";
  const hitObstacle =
    !phasing && state.obstacles.some((o) => o.id !== graceId && hits(box, o));

  if (edge || hitObstacle) {
    return {
      ...state,
      mode: "dead",
      deadAt: state.tick,
      graceId,
      events: [...state.events, "die"],
    };
  }
  if (graceId === state.graceId) return state;
  return { ...state, graceId };
}
