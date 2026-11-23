// @ts-check
// Keyboard input (design §9). Stub from task 1; task 6 replaces the bodies.
import { notImplemented } from "./notImplemented.js";

/** @typedef {import("./config.js").Dir} Dir */
/** @typedef {{turn: Dir} | {start: true} | {pause: true} | 'restart' | 'mute' | null} Action */

/**
 * @param {string} key KeyboardEvent.key
 * @returns {Action}
 */
export function keyToAction(key) {
  void key;
  return notImplemented("keyToAction");
}

/**
 * @param {{addEventListener: Function, removeEventListener: Function}} target
 * @param {(action: Exclude<Action, null>) => void} onAction
 * @returns {() => void} unbind
 */
export function bindInput(target, onAction) {
  (void target, void onAction);
  return notImplemented("bindInput");
}
