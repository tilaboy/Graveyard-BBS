// @ts-check
// Browser shell (design §13). Stub from task 1; task 10 replaces the body and adds the
// auto-boot when `document` is present.
import { notImplemented } from "./notImplemented.js";

/**
 * @typedef {{
 *   doc: Document,
 *   win: Window,
 *   now: () => number,
 *   raf: (cb: (t: number) => void) => number,
 *   seed: () => number,
 *   makeAudio: () => AudioContext,
 * }} BootDeps
 */

/**
 * @param {BootDeps} deps
 * @returns {{stop: () => void}}
 */
export function boot(deps) {
  void deps;
  return notImplemented("boot");
}
