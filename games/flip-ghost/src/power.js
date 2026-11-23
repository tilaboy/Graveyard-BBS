// @ts-check
// Superpower machine ready -> active -> cooldown -> ready (R5, design §6). Task 3.
//
// `power.left` counts the ticks still to come in the current mode AFTER the tick that was
// just stepped. With the step order of design §5 (trigger in step 2, tickPower in step 6,
// collide in step 7) this makes collide see `active` on exactly PHASE_TICKS ticks and
// `cooldown` on exactly COOLDOWN_TICKS ticks (R5.2, R5.7, R5.10):
//
//   tick t        trigger -> active, left 600; tickPower -> left 599
//   tick t+599    tickPower -> left 0 (still active: 600th phase tick)
//   tick t+600    tickPower -> cooldown, left 1199, 'phase-off'
//   tick t+1799   tickPower -> left 0 (1200th cooldown tick)
//   tick t+1800   tickPower -> ready, 'power-ready'
import {
  COOLDOWN_TICKS,
  GHOST_H,
  GHOST_W,
  GHOST_X,
  GAP_H,
  GROUND_Y,
  OBSTACLE_W,
  PHASE_TICKS,
  TICK_HZ,
} from "./config.js";

/** @typedef {import('./config.js').State} State */
/** @typedef {State['power']} Power */
/** @typedef {import('./config.js').Obstacle} Obstacle */

/**
 * The superpower at the start of every run (R5.9).
 * @returns {Power}
 */
export function initialPower() {
  return { mode: "ready", left: 0 };
}

/**
 * Handle a `phase` input (R5.2, R5.8). Only a `ready` power in `playing` changes anything;
 * every other call returns the same state object.
 * @param {State} state
 * @returns {State}
 */
export function trigger(state) {
  if (state.mode !== "playing" || state.power.mode !== "ready") return state;
  return {
    ...state,
    power: { mode: "active", left: PHASE_TICKS },
    events: [...state.events, "phase-on"],
  };
}

/**
 * Advance the power by one tick (design §5 step 6). When phase-through ends, `graceId` is
 * set to the obstacle the ghost is inside, if any, so collide can apply exit grace (R5.6).
 * @param {State} state
 * @returns {State}
 */
export function tickPower(state) {
  const { mode, left } = state.power;
  if (mode === "ready") return state;
  if (left > 0) return { ...state, power: { mode, left: left - 1 } };
  if (mode === "active") {
    const inside = state.obstacles.find((o) => ghostInside(state.ghost.y, o));
    return {
      ...state,
      power: { mode: "cooldown", left: COOLDOWN_TICKS - 1 },
      graceId: inside ? inside.id : null,
      events: [...state.events, "phase-off"],
    };
  }
  return {
    ...state,
    power: initialPower(),
    events: [...state.events, "power-ready"],
  };
}

/**
 * Button and HUD label (R5.8): `PHASE (P)`, `PHASING 7s` or `COOLDOWN 12s`.
 * Seconds are the ticks left including the current one, rounded up.
 * @param {Power} power
 * @returns {string}
 */
export function powerLabel(power) {
  if (power.mode === "ready") return "PHASE (P)";
  const secs = Math.ceil((power.left + 1) / TICK_HZ);
  return power.mode === "active" ? `PHASING ${secs}s` : `COOLDOWN ${secs}s`;
}

/**
 * Whether the ghost box overlaps either gravestone of an obstacle (design §7 boxes).
 * Kept local so power.js does not depend on collide.js (task 4).
 * @param {number} y
 * @param {Obstacle} o
 * @returns {boolean}
 */
function ghostInside(y, o) {
  const xOverlap = GHOST_X < o.x + OBSTACLE_W && o.x < GHOST_X + GHOST_W;
  if (!xOverlap) return false;
  const inTop = y < o.gapY;
  const inBottom = y + GHOST_H > o.gapY + GAP_H && o.gapY + GAP_H < GROUND_Y;
  return inTop || inBottom;
}
