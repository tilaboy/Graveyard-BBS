// @ts-check
// Grid helpers (design §5). Requirements R4.3, R4.4.
import { COLS, ROWS } from "./config.js";

/** @typedef {import("./config.js").Cell} Cell */
/** @typedef {import("./config.js").Spider} Spider */

/**
 * @param {Cell} cell
 * @returns {string} "x,y"
 */
export function key(cell) {
  return `${cell.x},${cell.y}`;
}

/**
 * @param {Cell} cell
 * @returns {boolean}
 */
export function inBounds(cell) {
  return (
    Number.isInteger(cell.x) &&
    Number.isInteger(cell.y) &&
    cell.x >= 0 &&
    cell.x < COLS &&
    cell.y >= 0 &&
    cell.y < ROWS
  );
}

/**
 * Chebyshev distance.
 * @param {Cell} a
 * @param {Cell} b
 * @returns {number}
 */
export function cheb(a, b) {
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
}

/**
 * Every cell with cheb(cell, spider.at) <= spider.r, row-major: (2r+1)^2 cells.
 * The spider cell is the web centre, so it is included.
 * @param {Spider} spider
 * @returns {Cell[]}
 */
export function webCells(spider) {
  const { at, r } = spider;
  /** @type {Cell[]} */
  const cells = [];
  for (let y = at.y - r; y <= at.y + r; y += 1) {
    for (let x = at.x - r; x <= at.x + r; x += 1) {
      cells.push({ x, y });
    }
  }
  return cells;
}

/**
 * Keys of every spider and web cell.
 * @param {ReadonlyArray<Spider>} spiders
 * @returns {Set<string>}
 */
export function hazardSet(spiders) {
  /** @type {Set<string>} */
  const set = new Set();
  for (const spider of spiders) {
    for (const cell of webCells(spider)) set.add(key(cell));
  }
  return set;
}

/**
 * The whole web lies inside the grid (R4.4): r <= x <= COLS-1-r, same for y.
 * @param {Spider} spider
 * @returns {boolean}
 */
export function fitsGrid(spider) {
  const { at, r } = spider;
  return at.x >= r && at.x <= COLS - 1 - r && at.y >= r && at.y <= ROWS - 1 - r;
}
