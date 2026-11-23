// @ts-check
// Every constant from .kiro/specs/arcade-flip-ghost/design.md §3.

/** Simulation ticks per second (R1.4). */
export const TICK_HZ = 60;
/** Logical canvas size in px (R6.1). */
export const WIDTH = 480;
export const HEIGHT = 640;
/** Top of the ground strip in px (R1.5). */
export const GROUND_Y = 600;
/** Fixed horizontal position of the ghost in px (R2.3). */
export const GHOST_X = 120;
/** Ghost hitbox in px. */
export const GHOST_W = 40;
export const GHOST_H = 44;
/** Downward acceleration in px/tick² (R2.2). */
export const GRAVITY = 0.45;
/** Upward velocity set by a flip in px/tick (R2.1). Negative is up. */
export const FLIP_VY = -7.5;
/** Maximum fall speed in px/tick (R2.2). */
export const MAX_FALL_VY = 10;
/** Leftward scroll speed of obstacles in px/tick (R2.3). */
export const SCROLL_VX = 2.5;
/** Obstacle width in px (R3). */
export const OBSTACLE_W = 64;
/** Px of scroll between obstacle spawns (R3.1). */
export const OBSTACLE_SPACING = 220;
/** Constant gap height in px (R3.3). */
export const GAP_H = 170;
/** Minimum distance of a gap from ceiling and ground in px (R3.2, R3.5). */
export const GAP_MARGIN = 40;
/** Phase-through length in ticks, 10 s (R5.2). Fixed by the goal. */
export const PHASE_TICKS = 600;
/** Cooldown length in ticks, 20 s (R5.7). Fixed by the Sysop. */
export const COOLDOWN_TICKS = 1200;
/** Phase warning window in ticks (R6.4). */
export const PHASE_WARN_TICKS = 60;
/** Ticks after death before a restart is accepted (R1.6). */
export const RESTART_DELAY_TICKS = 30;

/** @typedef {{ x: number, gapY: number, scored: boolean, id: number }} Obstacle */
/** @typedef {'ready'|'active'|'cooldown'} PowerMode */
/**
 * @typedef {{
 *   mode: 'ready'|'playing'|'dead',
 *   tick: number,
 *   ghost: { y: number, vy: number },
 *   obstacles: Obstacle[],
 *   nextId: number,
 *   scrolled: number,
 *   rng: number,
 *   score: number,
 *   power: { mode: PowerMode, left: number },
 *   graceId: number | null,
 *   deadAt: number | null,
 *   events: string[]
 * }} State
 */
/** @typedef {'flip'|'phase'} Input */
