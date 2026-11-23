// @ts-check
// Every constant and shared type from .kiro/specs/arcade-graveyard-snake/design.md §2, §3.

/** Grid size in cells (R1.1). */
export const COLS = 24;
export const ROWS = 24;
/** Cell size in px; the canvas is COLS * CELL_PX square (R1.1). */
export const CELL_PX = 20;
/** Simulation ticks per second (R1.2). */
export const TICK_HZ = 60;
/** Ticks per snake move at run start (R1.3). */
export const START_STEP_TICKS = 8;
/** Floor of ticks per move (R1.4). */
export const MIN_STEP_TICKS = 4;
/** Creatures eaten between speed-ups (R1.4). */
export const SPEEDUP_EVERY = 10;
/**
 * Start cells as [x, y], head first, heading right (R2.1).
 * @type {ReadonlyArray<readonly [number, number]>}
 */
export const START_CELLS = Object.freeze([
  Object.freeze(/** @type {const} */ ([12, 12])),
  Object.freeze(/** @type {const} */ ([11, 12])),
  Object.freeze(/** @type {const} */ ([10, 12])),
]);
/** @type {Dir} */
export const START_DIR = "right";
/** Max buffered turns (R2.5). */
export const TURN_BUFFER = 2;

/**
 * Creature kinds with spawn weight, points and growth (R3.2, R3.3).
 * @type {Readonly<Record<Kind, Readonly<{weight: number, points: number, growth: number}>>>}
 */
export const CREATURES = Object.freeze({
  ghost: Object.freeze({ weight: 60, points: 1, growth: 1 }),
  skeleton: Object.freeze({ weight: 30, points: 3, growth: 2 }),
  dinosaur: Object.freeze({ weight: 10, points: 5, growth: 3 }),
});
/**
 * Creature kinds in a fixed order, so weighted picks replay the same way.
 * @type {ReadonlyArray<Kind>}
 */
export const KINDS = Object.freeze(["ghost", "skeleton", "dinosaur"]);

/** Spiders placed at run start (R4.1). */
export const START_SPIDERS = 2;
/** Creatures eaten between spider spawns (R4.2). */
export const SPIDER_EVERY = 3;
/** Most spiders on the grid (R4.2). */
export const MAX_SPIDERS = 6;
/** Web radius range, inclusive (R4.3). */
export const WEB_MIN_R = 1;
export const WEB_MAX_R = 3;
/** Every web cell must be farther than this Chebyshev distance from the head (R4.5). */
export const HEAD_SAFE_DIST = 3;
/** Placement tries per spider spawn (R4.6). */
export const SPAWN_TRIES = 50;

/** localStorage key of the best score (R7.3). */
export const BEST_KEY = "graveyard-snake.best";

/** Catch flash: 2 Hz for 1.5 s, under the 3 flashes per second limit (R7.6). */
export const FLASH_HZ = 2;
export const FLASH_MS = 1500;
/** Most simulation steps per animation frame, so a background tab does not fast-forward. */
export const MAX_STEPS_PER_FRAME = 5;

/** @typedef {'up'|'down'|'left'|'right'} Dir */
/** @typedef {'ghost'|'skeleton'|'dinosaur'} Kind */
/** @typedef {{x: number, y: number}} Cell */
/** @typedef {{kind: Kind, at: Cell}} Creature */
/** @typedef {{at: Cell, r: 1|2|3}} Spider */
/** @typedef {'wall'|'web'|'self'|'full'} EndReason */
/**
 * @typedef {{
 *   phase: 'title'|'play'|'paused'|'over',
 *   tick: number,
 *   sinceMove: number,
 *   stepTicks: number,
 *   rng: number,
 *   snake: Cell[],
 *   dir: Dir,
 *   turns: Dir[],
 *   grow: number,
 *   creature: Creature | null,
 *   spiders: Spider[],
 *   score: number,
 *   eaten: {ghost: number, skeleton: number, dinosaur: number},
 *   end: EndReason | null,
 * }} State
 */
/** @typedef {{turn?: Dir, start?: boolean, pause?: boolean}} Input */
