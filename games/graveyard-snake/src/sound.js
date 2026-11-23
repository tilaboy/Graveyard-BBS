// @ts-check
// Synthesised Web Audio sound (design §12). Stub from task 1; task 9 replaces the body.
import { notImplemented } from "./notImplemented.js";

/** @typedef {'chime'|'eat-ghost'|'eat-skeleton'|'eat-dinosaur'|'caught'} Voice */
/** @typedef {{enabled: boolean, toggle: () => boolean, play: (name: Voice) => void}} Sound */

/**
 * @param {() => AudioContext} makeCtx called lazily on the first toggle()
 * @returns {Sound}
 */
export function createSound(makeCtx) {
  void makeCtx;
  return notImplemented("createSound");
}
