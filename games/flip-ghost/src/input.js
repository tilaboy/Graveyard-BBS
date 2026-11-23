// @ts-check
// Space / click / tap -> flip, P and the PHASE button -> phase, M -> sound toggle. Task 6.
import { notImplemented } from './notImplemented.js';

/** @typedef {import('./config.js').Input} Input */

/**
 * @param {EventTarget} _target
 * @param {Input[]} _queue
 * @param {{ onSound?: () => void, phaseButton?: EventTarget }} [_opts]
 * @returns {() => void} unbind
 */
export function bindInput(_target, _queue, _opts) {
  return notImplemented('input.bindInput');
}
