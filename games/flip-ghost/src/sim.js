// @ts-check
// Pure, deterministic simulation step (R1, R4, R5.11, design §5). Task 8.
//
// `step` never mutates its argument and never reads a clock or Math.random: the PRNG word
// lives in `state.rng` and the seed for a new run comes from the caller (R1.7).
import {
  GHOST_H,
  GHOST_W,
  GHOST_X,
  HEIGHT,
  GROUND_Y,
  OBSTACLE_W,
  RESTART_DELAY_TICKS,
} from "./config.js";
import { applyGravity, flip } from "./physics.js";
import { cull, scroll, spawnIfDue } from "./course.js";
import { initialPower, tickPower, trigger } from "./power.js";
import { collide } from "./collide.js";
import { seedWord } from "./rng.js";

/** @typedef {import('./config.js').State} State */
/** @typedef {import('./config.js').Input} Input */

/** Starting height of the ghost: centred between the ceiling and the ground. */
export const START_Y = Math.round((Math.min(HEIGHT, GROUND_Y) - GHOST_H) / 2);

/**
 * A fresh run in `ready` with score 0 and the superpower ready (R1.2, R1.6, R5.9).
 * @param {number} seed
 * @returns {State}
 */
export function initialState(seed) {
  return {
    mode: "ready",
    tick: 0,
    ghost: { y: START_Y, vy: 0 },
    obstacles: [],
    nextId: 0,
    scrolled: 0,
    rng: seedWord(seed),
    score: 0,
    power: initialPower(),
    graceId: null,
    deadAt: null,
    events: [],
  };
}

/**
 * Advance the game by one tick (design §5).
 * - `ready`: a `flip` starts the run and the tick is played as `playing` (R1.3); otherwise
 *   nothing moves.
 * - `playing`: inputs, gravity, course, score, power, collision, tick (R1.4, R1.5, R4.1, R4.2).
 * - `dead`: the tick counter keeps running; a `flip` at least RESTART_DELAY_TICKS after death
 *   returns `initialState(nextSeed)` (R1.6, R5.9).
 * @param {State} state
 * @param {Input[]} inputs inputs queued for this tick, applied in order
 * @param {number} [nextSeed] seed for the next run, chosen by the shell (main.js); defaults to
 *   the current PRNG word so a replay without a shell is still deterministic
 * @returns {State}
 */
export function step(state, inputs, nextSeed = state.rng) {
  /** @type {State} */
  const s = { ...state, events: [] };
  const flips = inputs.includes("flip");

  if (s.mode === "ready") {
    if (!flips) return s;
    return playTick({ ...s, mode: "playing" }, inputs);
  }
  if (s.mode === "dead") {
    const deadAt = s.deadAt ?? s.tick;
    if (flips && s.tick - deadAt >= RESTART_DELAY_TICKS)
      return initialState(nextSeed);
    return { ...s, tick: s.tick + 1 };
  }
  return playTick(s, inputs);
}

/**
 * Steps 2-8 of design §5 on a `playing` state whose events are already cleared.
 * @param {State} start
 * @param {Input[]} inputs
 * @returns {State}
 */
function playTick(start, inputs) {
  let s = start;

  // 2. Inputs.
  for (const input of inputs) {
    if (input === "flip") {
      s = { ...s, ghost: flip(s.ghost), events: [...s.events, "flip"] };
    } else if (input === "phase") {
      s = trigger(s);
    }
  }

  // 3. Gravity and clamp.
  s = { ...s, ghost: applyGravity(s.ghost) };

  // 4. Course.
  s = cull(spawnIfDue(scroll(s)));

  // 5. Score: once per obstacle when the ghost's centre passes its right edge.
  const centre = GHOST_X + GHOST_W / 2;
  let gained = 0;
  const obstacles = s.obstacles.map((o) => {
    if (o.scored || o.x + OBSTACLE_W >= centre) return o;
    gained += 1;
    return { ...o, scored: true };
  });
  if (gained > 0) {
    s = {
      ...s,
      obstacles,
      score: s.score + gained,
      events: [...s.events, ...Array.from({ length: gained }, () => "score")],
    };
  }

  // 6. Power. 7. Collision. 8. Tick.
  s = collide(tickPower(s));
  return { ...s, tick: s.tick + 1 };
}
