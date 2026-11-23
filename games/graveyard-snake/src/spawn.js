// @ts-check
// Creature and spider spawning (design §7). Requirements R3.1, R3.2, R3.5, R3.7, R4.3 to R4.6.
import {
  COLS,
  ROWS,
  CREATURES,
  KINDS,
  WEB_MIN_R,
  WEB_MAX_R,
  HEAD_SAFE_DIST,
  SPAWN_TRIES,
} from "./config.js";
import { randInt, pickWeighted } from "./rng.js";
import { key, cheb, webCells, hazardSet } from "./grid.js";

/** @typedef {import("./config.js").Cell} Cell */
/** @typedef {import("./config.js").Kind} Kind */
/** @typedef {import("./config.js").Creature} Creature */
/** @typedef {import("./config.js").Spider} Spider */

/** @type {ReadonlyArray<readonly [Kind, number]>} */
const KIND_WEIGHTS = Object.freeze(
  KINDS.map((kind) => /** @type {const} */ ([kind, CREATURES[kind].weight])),
);

/**
 * @param {ReadonlyArray<Cell>} cells
 * @returns {Set<string>}
 */
function keySet(cells) {
  return new Set(cells.map(key));
}

/**
 * Pick a kind by weight, then a free cell (not snake, spider or web) in row-major order.
 * Two draws when a free cell exists; one draw (the kind) when none does.
 * @param {number} rng PRNG state word
 * @param {ReadonlyArray<Cell>} snake
 * @param {ReadonlyArray<Spider>} spiders
 * @returns {[Creature | null, number]} [creature or null when no free cell, next word]
 */
export function spawnCreature(rng, snake, spiders) {
  const blocked = hazardSet(spiders);
  for (const cell of snake) blocked.add(key(cell));
  /** @type {Cell[]} */
  const free = [];
  for (let y = 0; y < ROWS; y += 1) {
    for (let x = 0; x < COLS; x += 1) {
      if (!blocked.has(`${x},${y}`)) free.push({ x, y });
    }
  }
  const [kind, afterKind] = pickWeighted(rng, KIND_WEIGHTS);
  if (free.length === 0) return [null, afterKind];
  const [index, afterCell] = randInt(afterKind, 0, free.length - 1);
  const at = free[index];
  return [{ kind, at: { x: at.x, y: at.y } }, afterCell];
}

/**
 * Draw a web radius once, then up to SPAWN_TRIES centres that keep the web inside the grid.
 * A try is legal when no web cell is a snake cell, the creature cell, a cell of another web,
 * or within Chebyshev distance HEAD_SAFE_DIST of the head. Each try costs exactly two draws.
 * @param {number} rng PRNG state word
 * @param {ReadonlyArray<Cell>} snake head first
 * @param {Creature | null} creature
 * @param {ReadonlyArray<Spider>} spiders
 * @returns {[Spider | null, number]} [spider or null after 50 failed tries, next word]
 */
export function spawnSpider(rng, snake, creature, spiders) {
  const [rDraw, afterR] = randInt(rng, WEB_MIN_R, WEB_MAX_R);
  const r = /** @type {1|2|3} */ (rDraw);
  const blocked = hazardSet(spiders);
  for (const k of keySet(snake)) blocked.add(k);
  if (creature) blocked.add(key(creature.at));
  const head = snake.length > 0 ? snake[0] : null;

  let word = afterR;
  for (let attempt = 0; attempt < SPAWN_TRIES; attempt += 1) {
    const [x, afterX] = randInt(word, r, COLS - 1 - r);
    const [y, afterY] = randInt(afterX, r, ROWS - 1 - r);
    word = afterY;
    /** @type {Spider} */
    const spider = { at: { x, y }, r };
    const legal = webCells(spider).every(
      (cell) =>
        !blocked.has(key(cell)) &&
        (head === null || cheb(cell, head) > HEAD_SAFE_DIST),
    );
    if (legal) return [spider, word];
  }
  return [null, word];
}
