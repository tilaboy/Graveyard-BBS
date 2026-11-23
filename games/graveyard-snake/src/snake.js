// @ts-check
// Snake movement (design §6, requirements R2.1 to R2.8). Pure functions, no I/O.
import { TURN_BUFFER } from "./config.js";

/** @typedef {import("./config.js").Cell} Cell */
/** @typedef {import("./config.js").Dir} Dir */

/** @type {Readonly<Record<Dir, Readonly<{dx: number, dy: number}>>>} */
const DELTA = Object.freeze({
  up: Object.freeze({ dx: 0, dy: -1 }),
  down: Object.freeze({ dx: 0, dy: 1 }),
  left: Object.freeze({ dx: -1, dy: 0 }),
  right: Object.freeze({ dx: 1, dy: 0 }),
});

/** @type {Readonly<Record<Dir, Dir>>} */
const OPPOSITE = Object.freeze({
  up: "down",
  down: "up",
  left: "right",
  right: "left",
});

/**
 * Buffer a turn (R2.4, R2.5). The turn is dropped when the buffer already holds
 * TURN_BUFFER items, or when it equals or reverses the last queued direction
 * (the current direction when the buffer is empty).
 * @param {ReadonlyArray<Dir>} turns buffered turns
 * @param {Dir} dir requested turn
 * @param {Dir} current current direction
 * @returns {Dir[]} new buffer
 */
export function queueTurn(turns, dir, current) {
  if (!Object.hasOwn(DELTA, dir)) return [...turns];
  if (turns.length >= TURN_BUFFER) return [...turns];
  const last = turns.length > 0 ? turns[turns.length - 1] : current;
  if (dir === last || dir === OPPOSITE[last]) return [...turns];
  return [...turns, dir];
}

/**
 * The cell the head moves to (R2.2). May lie outside the grid; the caller checks walls.
 * @param {ReadonlyArray<Cell>} snake head first
 * @param {Dir} dir
 * @returns {Cell}
 */
export function nextHead(snake, dir) {
  const head = snake[0];
  const d = DELTA[dir];
  return { x: head.x + d.dx, y: head.y + d.dy };
}

/**
 * Move the snake onto `head` (R2.3): prepend the head, keep the tail while growth is
 * pending (and spend 1), otherwise drop the tail.
 * @param {ReadonlyArray<Cell>} snake head first
 * @param {Cell} head
 * @param {number} grow pending growth
 * @returns {{snake: Cell[], grow: number}}
 */
export function advance(snake, head, grow) {
  const cells = [
    { x: head.x, y: head.y },
    ...snake.map((c) => ({ x: c.x, y: c.y })),
  ];
  if (grow > 0) return { snake: cells, grow: grow - 1 };
  cells.pop();
  return { snake: cells, grow: 0 };
}

/**
 * Does moving onto `head` hit the body (R2.7)? The tail cell is not body when
 * `grow === 0`, because the tail frees it on the same move.
 * @param {ReadonlyArray<Cell>} snake head first
 * @param {Cell} head
 * @param {number} grow pending growth
 * @returns {boolean}
 */
export function hitsSelf(snake, head, grow) {
  const end = grow > 0 ? snake.length : snake.length - 1;
  for (let i = 0; i < end; i++) {
    const c = snake[i];
    if (c.x === head.x && c.y === head.y) return true;
  }
  return false;
}
