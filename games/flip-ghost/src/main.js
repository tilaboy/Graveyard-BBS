// @ts-check
// Browser shell: fixed-tick loop wiring input, sim, render, HUD, sound (design §9). Task 9.
import { notImplemented } from './notImplemented.js';

/** @typedef {import('./config.js').State} State */

/**
 * @param {{
 *   doc: Document,
 *   win: Window,
 *   now: () => number,
 *   raf: (cb: (t: number) => void) => number
 * }} _deps
 * @returns {{ getState: () => State, stop: () => void }}
 */
export function boot(_deps) {
  return notImplemented('main.boot');
}
