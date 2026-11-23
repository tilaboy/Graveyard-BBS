// @ts-check
// Pure simulation (design §8). Requirements R1.3 to R1.6, R3.3, R3.4, R3.6, R4.1, R4.2,
// R4.7, R5.1 to R5.4. No clock, no DOM, no Math.random: every random choice reads and
// returns the mulberry32 word kept in `state.rng`.
import {
  CREATURES,
  MAX_SPIDERS,
  MIN_STEP_TICKS,
  SPEEDUP_EVERY,
  SPIDER_EVERY,
  START_CELLS,
  START_DIR,
  START_SPIDERS,
  START_STEP_TICKS,
} from "./config.js";
import { seedWord } from "./rng.js";
import { hazardSet, inBounds, key } from "./grid.js";
import { advance, hitsSelf, nextHead, queueTurn } from "./snake.js";
import { spawnCreature, spawnSpider } from "./spawn.js";

/** @typedef {import("./config.js").State} State */
/** @typedef {import("./config.js").Input} Input */
/** @typedef {import("./config.js").Cell} Cell */
/** @typedef {import("./config.js").Spider} Spider */
/** @typedef {import("./config.js").EndReason} EndReason */

/**
 * A fresh run on the title screen (R2.1, R1.3). Spiders and the creature are placed when
 * the run starts, not here.
 * @param {number} seed
 * @returns {State} phase 'title'
 */
export function initialState(seed) {
  return {
    phase: "title",
    tick: 0,
    sinceMove: 0,
    stepTicks: START_STEP_TICKS,
    rng: seedWord(seed),
    snake: START_CELLS.map(([x, y]) => ({ x, y })),
    dir: START_DIR,
    turns: [],
    grow: 0,
    creature: null,
    spiders: [],
    score: 0,
    eaten: { ghost: 0, skeleton: 0, dinosaur: 0 },
    end: null,
  };
}

/**
 * Deep copy of the state, so `step` never shares or mutates its argument.
 * @param {State} s
 * @returns {State}
 */
function clone(s) {
  return {
    ...s,
    snake: s.snake.map((c) => ({ x: c.x, y: c.y })),
    turns: [...s.turns],
    creature: s.creature
      ? {
          kind: s.creature.kind,
          at: { x: s.creature.at.x, y: s.creature.at.y },
        }
      : null,
    spiders: s.spiders.map((sp) => ({
      at: { x: sp.at.x, y: sp.at.y },
      r: sp.r,
    })),
    eaten: { ...s.eaten },
  };
}

/**
 * End the run in place: phase 'over', snake untouched (R5.2).
 * @param {State} s
 * @param {EndReason} reason
 */
function endRun(s, reason) {
  s.phase = "over";
  s.end = reason;
}

/**
 * Spawn one spider into `s` if a legal place exists (R4.5, R4.6: null means skip).
 * @param {State} s
 */
function addSpider(s) {
  const [spider, rng] = spawnSpider(s.rng, s.snake, s.creature, s.spiders);
  s.rng = rng;
  if (spider) s.spiders.push(spider);
}

/**
 * Spawn the next creature into `s`, or end the run `full` (R3.4, R3.7).
 * @param {State} s
 */
function addCreature(s) {
  const [creature, rng] = spawnCreature(s.rng, s.snake, s.spiders);
  s.rng = rng;
  s.creature = creature;
  if (!creature) endRun(s, "full");
}

/**
 * Start the run: 2 spiders first, then the creature, so R3.5 holds from tick 0 (R4.1).
 * @param {State} s
 */
function startRun(s) {
  s.phase = "play";
  for (let i = 0; i < START_SPIDERS; i += 1) addSpider(s);
  addCreature(s);
}

/**
 * One snake move (design §8 step 3).
 * @param {State} s
 */
function move(s) {
  s.sinceMove = 0;
  const turn = s.turns.shift();
  if (turn) s.dir = turn;
  const head = nextHead(s.snake, s.dir);

  // R5.3 order: wall, web, self. On any end the snake does not move or grow (R5.1).
  if (!inBounds(head)) return endRun(s, "wall");
  if (hazardSet(s.spiders).has(key(head))) return endRun(s, "web");
  if (hitsSelf(s.snake, head, s.grow)) return endRun(s, "self");

  const moved = advance(s.snake, head, s.grow);
  s.snake = moved.snake;
  s.grow = moved.grow;

  const food = s.creature;
  if (!food || food.at.x !== head.x || food.at.y !== head.y) return;

  // R3.3: points and growth by kind.
  const { points, growth } = CREATURES[food.kind];
  s.score += points;
  s.grow += growth;
  s.eaten[food.kind] += 1;
  s.creature = null;
  const total = s.eaten.ghost + s.eaten.skeleton + s.eaten.dinosaur;

  // R1.4 speed-up, then R4.2 spider growth, then R3.4 next creature.
  if (total % SPEEDUP_EVERY === 0) {
    s.stepTicks = Math.max(MIN_STEP_TICKS, s.stepTicks - 1);
  }
  if (total % SPIDER_EVERY === 0 && s.spiders.length < MAX_SPIDERS)
    addSpider(s);
  addCreature(s);
}

/**
 * One fixed 60 Hz tick (R1.2, R1.6). Pure: returns a new state, never mutates `state`.
 * @param {State} state
 * @param {Input} input
 * @returns {State} a new state; the argument is not mutated
 */
export function step(state, input) {
  const s = clone(state);
  const inp = input ?? {};

  switch (s.phase) {
    case "title":
      if (inp.start) startRun(s);
      return s;
    case "paused":
      if (inp.pause) s.phase = "play";
      return s;
    case "over":
      return s;
    case "play":
      break;
    default:
      return s;
  }

  if (inp.pause) {
    s.phase = "paused";
    return s;
  }
  if (inp.turn) s.turns = queueTurn(s.turns, inp.turn, s.dir);

  s.tick += 1;
  s.sinceMove += 1;
  if (s.sinceMove >= s.stepTicks) move(s);
  return s;
}
