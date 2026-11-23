// @ts-check
// Canvas render (design §10; R7.5, R7.6, R7.7). Pure canvas 2D calls, no state changes.
import { COLS, ROWS, CELL_PX } from "./config.js";

/** @typedef {import("./config.js").State} State */
/** @typedef {import("./config.js").Cell} Cell */
/** @typedef {import("./config.js").Spider} Spider */
/** @typedef {import("./config.js").Creature} Creature */
/** @typedef {import("./config.js").Kind} Kind */
/** @typedef {import("./config.js").EndReason} EndReason */

/** Theme colours (R7.7). */
export const COLORS = Object.freeze({
  black: "#000000",
  ghost: "#f8f8f8",
  green: "#39ff14",
  bone: "#bdb7a8",
  blood: "#c8102e",
  candle: "#ffd23f",
});

/** Canvas size in px (R1.1). */
export const WIDTH = COLS * CELL_PX;
export const HEIGHT = ROWS * CELL_PX;

/** Width of the static red border drawn on a catch under reduced motion (R7.5). */
export const BORDER_PX = 6;

/** Name initial shown on each creature so it is never a picture alone (R7.4). */
export const INITIALS = Object.freeze({
  ghost: "G",
  skeleton: "S",
  dinosaur: "D",
});

/** Plain end reason words for the game over overlay (R7.2, R7.4). */
export const END_WORDS = Object.freeze({
  wall: "Hit the graveyard wall",
  web: "Caught in a spider web",
  self: "Bit its own tail",
  full: "The graveyard is full",
});

/**
 * Overlay text lines for a phase, or [] during play.
 * @param {State} state
 * @returns {string[]}
 */
export function overlayLines(state) {
  switch (state.phase) {
    case "title":
      return ["GRAVEYARD SNAKE", "Press Space or Enter to start"];
    case "paused":
      return ["PAUSED", "Press P to resume"];
    case "over": {
      const reason = state.end ?? "wall";
      return [
        END_WORDS[reason],
        `GAME OVER · reason: ${reason} · score ${state.score}`,
        "Press R to rise again",
      ];
    }
    default:
      return [];
  }
}

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {State} state
 * @param {{reducedMotion: boolean, flashOn: boolean}} opts
 * @returns {void}
 */
export function draw(ctx, state, opts) {
  ctx.save();
  ctx.fillStyle = COLORS.black;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);
  for (const spider of state.spiders) drawWeb(ctx, spider);
  for (const spider of state.spiders) drawSpider(ctx, spider);
  if (state.creature) drawCreature(ctx, state.creature);
  drawSnake(ctx, state.snake, state.dir);
  if (state.phase === "over" && state.end === "web") drawCatch(ctx, opts);
  drawOverlay(ctx, state);
  ctx.restore();
}

/**
 * Centre of a cell in px.
 * @param {Cell} c
 * @returns {[number, number]}
 */
function centre(c) {
  return [c.x * CELL_PX + CELL_PX / 2, c.y * CELL_PX + CELL_PX / 2];
}

/**
 * Bone grey web: one concentric square per radius step, plus diagonals and axes.
 * @param {CanvasRenderingContext2D} ctx
 * @param {Spider} spider
 */
function drawWeb(ctx, spider) {
  const [cx, cy] = centre(spider.at);
  const span = spider.r * CELL_PX + CELL_PX / 2;
  ctx.strokeStyle = COLORS.bone;
  ctx.lineWidth = 1;
  for (let i = 1; i <= spider.r; i++) {
    const h = i * CELL_PX + CELL_PX / 2 - 1;
    ctx.strokeRect(cx - h, cy - h, 2 * h, 2 * h);
  }
  ctx.beginPath();
  for (const [dx, dy] of [
    [1, 1],
    [1, -1],
    [1, 0],
    [0, 1],
  ]) {
    ctx.moveTo(cx - dx * span, cy - dy * span);
    ctx.lineTo(cx + dx * span, cy + dy * span);
  }
  ctx.stroke();
}

/**
 * Blood red spider: a body circle with 8 legs.
 * @param {CanvasRenderingContext2D} ctx
 * @param {Spider} spider
 */
function drawSpider(ctx, spider) {
  const [cx, cy] = centre(spider.at);
  const body = CELL_PX * 0.3;
  ctx.strokeStyle = COLORS.blood;
  ctx.fillStyle = COLORS.blood;
  ctx.lineWidth = 2;
  ctx.beginPath();
  for (let i = 0; i < 4; i++) {
    const dy = (i - 1.5) * (CELL_PX * 0.18);
    ctx.moveTo(cx - body, cy + dy);
    ctx.lineTo(cx - CELL_PX / 2, cy + dy * 1.6);
    ctx.moveTo(cx + body, cy + dy);
    ctx.lineTo(cx + CELL_PX / 2, cy + dy * 1.6);
  }
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(cx, cy, body, 0, Math.PI * 2);
  ctx.fill();
}

/**
 * Creature glyph with a poison green outline and its name initial.
 * @param {CanvasRenderingContext2D} ctx
 * @param {Creature} creature
 */
function drawCreature(ctx, creature) {
  const [cx, cy] = centre(creature.at);
  const r = CELL_PX * 0.42;
  ctx.strokeStyle = COLORS.green;
  ctx.lineWidth = 2;
  ctx.beginPath();
  if (creature.kind === "ghost") {
    // dome top with a wavy hem
    ctx.arc(cx, cy - r * 0.2, r * 0.8, Math.PI, 0);
    ctx.lineTo(cx + r * 0.8, cy + r);
    ctx.lineTo(cx + r * 0.27, cy + r * 0.6);
    ctx.lineTo(cx - r * 0.27, cy + r);
    ctx.lineTo(cx - r * 0.8, cy + r * 0.6);
    ctx.closePath();
  } else if (creature.kind === "skeleton") {
    // skull circle and jaw
    ctx.arc(cx, cy - r * 0.15, r * 0.75, 0, Math.PI * 2);
    ctx.moveTo(cx - r * 0.4, cy + r);
    ctx.lineTo(cx + r * 0.4, cy + r);
  } else {
    // dinosaur: head with a row of back spikes
    ctx.moveTo(cx - r, cy + r);
    ctx.lineTo(cx - r * 0.5, cy - r * 0.2);
    ctx.lineTo(cx - r * 0.25, cy - r);
    ctx.lineTo(cx, cy - r * 0.3);
    ctx.lineTo(cx + r * 0.25, cy - r);
    ctx.lineTo(cx + r * 0.5, cy - r * 0.2);
    ctx.lineTo(cx + r, cy + r);
    ctx.closePath();
  }
  ctx.stroke();
  ctx.fillStyle = COLORS.green;
  ctx.font = `bold ${Math.round(CELL_PX * 0.5)}px monospace`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(INITIALS[creature.kind], cx, cy + 1);
}

/**
 * Ghost white snake, head first, head with two eyes facing its direction.
 * @param {CanvasRenderingContext2D} ctx
 * @param {Cell[]} snake
 * @param {import("./config.js").Dir} dir
 */
function drawSnake(ctx, snake, dir) {
  ctx.fillStyle = COLORS.ghost;
  const pad = 1;
  const size = CELL_PX - 2 * pad;
  for (const c of snake) {
    roundRect(ctx, c.x * CELL_PX + pad, c.y * CELL_PX + pad, size, size, 5);
    ctx.fill();
  }
  const head = snake[0];
  if (!head) return;
  const [cx, cy] = centre(head);
  const f = CELL_PX * 0.2;
  const [fx, fy] = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] }[
    dir
  ];
  ctx.fillStyle = COLORS.black;
  for (const side of [-1, 1]) {
    ctx.beginPath();
    ctx.arc(
      cx + fx * f + fy * side * f,
      cy + fy * f + fx * side * f,
      2,
      0,
      Math.PI * 2,
    );
    ctx.fill();
  }
}

/**
 * Rounded rectangle path built from lines and arcs (works without ctx.roundRect).
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} x
 * @param {number} y
 * @param {number} w
 * @param {number} h
 * @param {number} r
 */
function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.arc(x + w - r, y + r, r, -Math.PI / 2, 0);
  ctx.lineTo(x + w, y + h - r);
  ctx.arc(x + w - r, y + h - r, r, 0, Math.PI / 2);
  ctx.lineTo(x + r, y + h);
  ctx.arc(x + r, y + h - r, r, Math.PI / 2, Math.PI);
  ctx.lineTo(x, y + r);
  ctx.arc(x + r, y + r, r, Math.PI, (3 * Math.PI) / 2);
  ctx.closePath();
}

/**
 * Catch on a web: a red flash while the shell's 2 Hz `flashOn` is set, or a static red
 * border under reduced motion (R7.5, R7.6). This function never toggles anything itself.
 * @param {CanvasRenderingContext2D} ctx
 * @param {{reducedMotion: boolean, flashOn: boolean}} opts
 */
function drawCatch(ctx, opts) {
  if (opts.reducedMotion) {
    ctx.strokeStyle = COLORS.blood;
    ctx.lineWidth = BORDER_PX;
    ctx.strokeRect(
      BORDER_PX / 2,
      BORDER_PX / 2,
      WIDTH - BORDER_PX,
      HEIGHT - BORDER_PX,
    );
  } else if (opts.flashOn) {
    ctx.save();
    ctx.globalAlpha = 0.35;
    ctx.fillStyle = COLORS.blood;
    ctx.fillRect(0, 0, WIDTH, HEIGHT);
    ctx.restore();
  }
}

/**
 * Title, paused or game over text over a dimmed board.
 * @param {CanvasRenderingContext2D} ctx
 * @param {State} state
 */
function drawOverlay(ctx, state) {
  const lines = overlayLines(state);
  if (lines.length === 0) return;
  ctx.save();
  ctx.globalAlpha = 0.6;
  ctx.fillStyle = COLORS.black;
  ctx.fillRect(0, HEIGHT / 2 - 60, WIDTH, 120);
  ctx.restore();
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const top = HEIGHT / 2 - ((lines.length - 1) * 26) / 2;
  lines.forEach((line, i) => {
    const lead = i === 0;
    ctx.font = lead ? "bold 24px monospace" : "14px monospace";
    ctx.fillStyle =
      state.phase === "over" && i < 2
        ? COLORS.blood
        : lead
          ? COLORS.candle
          : COLORS.ghost;
    ctx.fillText(line, WIDTH / 2, top + i * 26);
  });
}
