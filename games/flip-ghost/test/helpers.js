// @ts-check
// Test helper from design §11: fold `step` over an input tape.
import { initialState, step } from "../src/sim.js";

/** @typedef {import('../src/config.js').State} State */
/** @typedef {'flip'|'phase'|'none'} TapeCell */

/**
 * Run a tape of one input per tick from `initialState(seed)`.
 * @param {number} seed
 * @param {TapeCell[]} tape
 * @returns {State[]} every state: index 0 is the initial state, index i is after tick i
 */
export function runTape(seed, tape) {
  /** @type {State[]} */
  const states = [initialState(seed)];
  let s = states[0];
  for (const cell of tape) {
    s = step(s, cell === "none" ? [] : [cell]);
    states.push(s);
  }
  return states;
}
