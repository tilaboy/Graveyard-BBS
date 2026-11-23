// @ts-check
// Canvas renderer: gravestones, fog, ground, Kiro ghost, phase effects (R6). Task 5.
import {
  GAP_H,
  GHOST_H,
  GHOST_W,
  GHOST_X,
  GROUND_Y,
  HEIGHT,
  OBSTACLE_W,
  PHASE_WARN_TICKS,
  SCROLL_VX,
  WIDTH,
} from "./config.js";

/** @typedef {import('./config.js').State} State */

/** BBS 16-colour palette (R6.5), same values as style.css. */
export const COLORS = Object.freeze({
  black: "#000000",
  ghost: "#ffffff",
  bone: "#aaaaaa",
  darkGrey: "#555555",
  blood: "#aa0000",
  cyan: "#55ffff",
  candle: "#ffff55",
});

/** Sprite draw size; larger than the 40 × 44 hitbox, centred on it (design §7). */
export const SPRITE_W = 48;
export const SPRITE_H = 52;
/** Ghost opacity while phasing (R6.3). */
export const PHASE_ALPHA = 0.5;
/** Ghost opacity in the "off" half of a warning blink (R6.4). */
export const BLINK_DIM_ALPHA = 0.15;
/**
 * Ticks per blink state change in the last PHASE_WARN_TICKS of a phase.
 * 20 ticks = 1.5 blinks per second at 60 Hz, inside the "no more than 3 per second" rule (R6.4).
 */
export const BLINK_HALF_TICKS = 20;
/** Ticks of screen shake after death when motion is allowed (R6.7). */
export const SHAKE_TICKS = 18;
const SHAKE_PX = 4;
const CROSS_SPACING = 40;

/**
 * @typedef {{
 *   alpha: number,
 *   outline: string | null,
 *   tint: string | null
 * }} GhostLook
 */

/**
 * How the ghost looks this tick. Pure, so the phase and blink rules are tested directly.
 * @param {State} state
 * @param {boolean} reducedMotion
 * @returns {GhostLook}
 */
export function ghostLook(state, reducedMotion) {
  const { mode, left } = state.power;
  if (mode !== "active") return { alpha: 1, outline: null, tint: null };
  if (left >= PHASE_WARN_TICKS)
    return { alpha: PHASE_ALPHA, outline: COLORS.cyan, tint: null };
  // Warning window (R6.4). Reduced motion: a steady cyan tint instead of a blink (R6.7).
  if (reducedMotion)
    return { alpha: PHASE_ALPHA, outline: COLORS.cyan, tint: COLORS.cyan };
  const into = PHASE_WARN_TICKS - 1 - left; // 0 on the first warning tick
  const on = Math.floor(into / BLINK_HALF_TICKS) % 2 === 0;
  return {
    alpha: on ? PHASE_ALPHA : BLINK_DIM_ALPHA,
    outline: COLORS.cyan,
    tint: null,
  };
}

/**
 * Screen shake offset in px after death; always 0 under reduced motion (R6.7).
 * @param {State} state
 * @param {boolean} reducedMotion
 * @returns {{ dx: number, dy: number }}
 */
export function shakeOffset(state, reducedMotion) {
  if (reducedMotion || state.mode !== "dead" || state.deadAt === null)
    return { dx: 0, dy: 0 };
  const since = state.tick - state.deadAt;
  if (since < 0 || since >= SHAKE_TICKS) return { dx: 0, dy: 0 };
  const sign = since % 2 === 0 ? 1 : -1;
  return { dx: sign * SHAKE_PX, dy: -sign * (SHAKE_PX / 2) };
}

/**
 * Trace the ghost silhouette (same shape as assets/kiro-ghost.svg, 48 × 52) at (x, y).
 * Used as the fallback body when the sprite is not loaded yet, and as the phase outline.
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} x
 * @param {number} y
 */
function ghostPath(ctx, x, y) {
  ctx.beginPath();
  ctx.moveTo(x + 5, y + 47);
  ctx.lineTo(x + 5, y + 22);
  ctx.arc(x + 24, y + 22, 19, Math.PI, 0);
  ctx.lineTo(x + 43, y + 47);
  ctx.lineTo(x + 36, y + 43);
  ctx.lineTo(x + 30, y + 49);
  ctx.lineTo(x + 24, y + 43);
  ctx.lineTo(x + 18, y + 49);
  ctx.lineTo(x + 12, y + 43);
  ctx.closePath();
}

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {State} state
 * @param {boolean} reducedMotion
 */
function drawFog(ctx, state, reducedMotion) {
  const drift = reducedMotion ? 0 : (state.tick * 0.5) % WIDTH;
  ctx.save();
  ctx.globalAlpha = 0.18;
  ctx.fillStyle = COLORS.darkGrey;
  for (const base of [0, WIDTH]) {
    const x = base - drift;
    ctx.beginPath();
    ctx.ellipse(x + 120, GROUND_Y - 40, 160, 28, 0, 0, Math.PI * 2);
    ctx.ellipse(x + 360, GROUND_Y - 70, 140, 22, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

/**
 * Bone grey gravestone pillars with rounded ends facing the gap.
 * @param {CanvasRenderingContext2D} ctx
 * @param {State} state
 */
function drawGravestones(ctx, state) {
  const r = OBSTACLE_W / 2;
  ctx.fillStyle = COLORS.bone;
  for (const o of state.obstacles) {
    const bottomY = o.gapY + GAP_H;
    // Top stone hangs from the ceiling, rounded at its lower end.
    if (o.gapY > r) {
      ctx.fillRect(o.x, 0, OBSTACLE_W, o.gapY - r);
      ctx.beginPath();
      ctx.arc(o.x + r, o.gapY - r, r, 0, Math.PI);
      ctx.fill();
    } else if (o.gapY > 0) {
      ctx.fillRect(o.x, 0, OBSTACLE_W, o.gapY);
    }
    // Bottom stone rises from the ground with a rounded top.
    const h = GROUND_Y - bottomY;
    if (h > r) {
      ctx.beginPath();
      ctx.arc(o.x + r, bottomY + r, r, Math.PI, 0);
      ctx.fill();
      ctx.fillRect(o.x, bottomY + r, OBSTACLE_W, h - r);
    } else if (h > 0) {
      ctx.fillRect(o.x, bottomY, OBSTACLE_W, h);
    }
  }
}

/**
 * Ground strip of crosses, scrolling with the course.
 * @param {CanvasRenderingContext2D} ctx
 * @param {State} state
 */
function drawGround(ctx, state) {
  ctx.fillStyle = COLORS.darkGrey;
  ctx.fillRect(0, GROUND_Y, WIDTH, HEIGHT - GROUND_Y);
  ctx.fillStyle = COLORS.bone;
  const offset = (state.tick * SCROLL_VX) % CROSS_SPACING;
  for (let x = -offset; x < WIDTH; x += CROSS_SPACING) {
    ctx.fillRect(x + 18, GROUND_Y + 8, 4, 22);
    ctx.fillRect(x + 12, GROUND_Y + 14, 16, 4);
  }
}

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {State} state
 * @param {CanvasImageSource | null} sprite
 * @param {boolean} reducedMotion
 * @param {number} frame
 */
function drawGhost(ctx, state, sprite, reducedMotion, frame) {
  const look = ghostLook(state, reducedMotion);
  // The ready screen bobs the ghost in the render only (design §5); still under reduced motion.
  const bob =
    state.mode === "ready" && !reducedMotion ? Math.sin(frame / 20) * 4 : 0;
  const x = GHOST_X - (SPRITE_W - GHOST_W) / 2;
  const y = state.ghost.y - (SPRITE_H - GHOST_H) / 2 + bob;

  ctx.save();
  ctx.globalAlpha = look.alpha;
  if (sprite) {
    ctx.drawImage(sprite, x, y, SPRITE_W, SPRITE_H);
  } else {
    ctx.fillStyle = COLORS.ghost;
    ghostPath(ctx, x, y);
    ctx.fill();
  }
  if (look.tint) {
    ctx.fillStyle = look.tint;
    ghostPath(ctx, x, y);
    ctx.fill();
  }
  if (look.outline) {
    ctx.globalAlpha = 1;
    ctx.strokeStyle = look.outline;
    ctx.lineWidth = 2;
    ghostPath(ctx, x, y);
    ctx.stroke();
  }
  ctx.restore();
}

/**
 * Draw one frame. Reads state only; never mutates it.
 * `frame` is an optional render counter from the shell for the ready-screen bob.
 * @param {CanvasRenderingContext2D} ctx
 * @param {State} state
 * @param {CanvasImageSource | null} sprite
 * @param {{ reducedMotion: boolean, frame?: number }} opts
 * @returns {void}
 */
export function draw(ctx, state, sprite, opts) {
  const reducedMotion = Boolean(opts.reducedMotion);
  const frame = opts.frame ?? state.tick;
  const shake = shakeOffset(state, reducedMotion);

  ctx.save();
  ctx.globalAlpha = 1;
  ctx.fillStyle = COLORS.black;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);
  ctx.translate(shake.dx, shake.dy);

  drawFog(ctx, state, reducedMotion);
  drawGravestones(ctx, state);
  drawGround(ctx, state);
  drawGhost(ctx, state, sprite, reducedMotion, frame);
  ctx.restore();

  // Death: a static blood red frame, the motion-free signal (R6.5, R6.7).
  if (state.mode === "dead") {
    ctx.save();
    ctx.strokeStyle = COLORS.blood;
    ctx.lineWidth = 6;
    ctx.strokeRect(3, 3, WIDTH - 6, HEIGHT - 6);
    ctx.restore();
  }
}
