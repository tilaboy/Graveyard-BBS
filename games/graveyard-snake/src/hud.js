// @ts-check
// HUD text and best score (design §11). Stub from task 1; task 8 replaces the bodies.
import { notImplemented } from "./notImplemented.js";

/** @typedef {import("./config.js").State} State */
/**
 * @typedef {{score: string, length: string, eaten: string, spiders: string,
 *   best: string, status: string}} HudText
 */

/**
 * @param {State} state
 * @param {number} best
 * @returns {HudText}
 */
export function hudText(state, best) {
  (void state, void best);
  return notImplemented("hudText");
}

/**
 * @param {Document} doc
 * @param {HudText} text
 * @returns {void}
 */
export function updateHud(doc, text) {
  (void doc, void text);
  notImplemented("updateHud");
}

/**
 * @param {{localStorage: Storage}} win
 * @returns {number} best score, 0 when missing or bad
 */
export function loadBest(win) {
  void win;
  return notImplemented("loadBest");
}

/**
 * @param {{localStorage: Storage}} win
 * @param {number} n
 * @returns {void}
 */
export function saveBest(win, n) {
  (void win, void n);
  notImplemented("saveBest");
}
