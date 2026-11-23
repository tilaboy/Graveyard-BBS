// @ts-check
// Pure simulation (design §8). Stub from task 1; task 5 replaces the bodies.
import { notImplemented } from "./notImplemented.js";

/** @typedef {import("./config.js").State} State */
/** @typedef {import("./config.js").Input} Input */

/**
 * @param {number} seed
 * @returns {State} phase 'title'
 */
export function initialState(seed) {
  void seed;
  return notImplemented("initialState");
}

/**
 * @param {State} state
 * @param {Input} input
 * @returns {State} a new state; the argument is not mutated
 */
export function step(state, input) {
  (void state, void input);
  return notImplemented("step");
}
