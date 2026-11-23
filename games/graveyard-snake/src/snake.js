// @ts-check
// Snake movement (design §6). Stub from task 1; task 3 replaces the bodies.
import { notImplemented } from "./notImplemented.js";

/** @typedef {import("./config.js").Cell} Cell */
/** @typedef {import("./config.js").Dir} Dir */

/**
 * @param {ReadonlyArray<Dir>} turns buffered turns
 * @param {Dir} dir requested turn
 * @param {Dir} current current direction
 * @returns {Dir[]} new buffer
 */
export function queueTurn(turns, dir, current) {
  (void turns, void dir, void current);
  return notImplemented("queueTurn");
}

/**
 * @param {ReadonlyArray<Cell>} snake head first
 * @param {Dir} dir
 * @returns {Cell}
 */
export function nextHead(snake, dir) {
  (void snake, void dir);
  return notImplemented("nextHead");
}

/**
 * @param {ReadonlyArray<Cell>} snake head first
 * @param {Cell} head
 * @param {number} grow pending growth
 * @returns {{snake: Cell[], grow: number}}
 */
export function advance(snake, head, grow) {
  (void snake, void head, void grow);
  return notImplemented("advance");
}

/**
 * @param {ReadonlyArray<Cell>} snake head first
 * @param {Cell} head
 * @param {number} grow pending growth
 * @returns {boolean}
 */
export function hitsSelf(snake, head, grow) {
  (void snake, void head, void grow);
  return notImplemented("hitsSelf");
}
