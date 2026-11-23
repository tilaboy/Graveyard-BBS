// @ts-check
// Space / click / tap -> flip, P and the PHASE button -> phase, M -> sound toggle (design §9).
// `M` never enters the queue: sound lives in the shell, not in `sim` (R7).

/** @typedef {import('./config.js').Input} Input */

/**
 * @param {unknown} node
 * @param {EventTarget | undefined} button
 * @returns {boolean}
 */
function onButton(node, button) {
  if (!button || node === null || node === undefined) return false;
  if (node === button) return true;
  const b = /** @type {{ contains?: (n: unknown) => boolean }} */ (button);
  return typeof b.contains === 'function' && b.contains(node) === true;
}

/**
 * Listen for player input and push it onto `queue` for the next tick.
 * - `keydown` Space -> `flip` (with `preventDefault`, so the page does not scroll)
 * - `pointerdown` anywhere on `target` (mouse click or touch tap) -> `flip`,
 *   except on the PHASE button
 * - `keydown` P, or `click` on `opts.phaseButton` -> `phase` (R5.1)
 * - `keydown` M -> `opts.onSound()`
 * Key repeats and keys held with Ctrl, Meta or Alt are ignored.
 * @param {EventTarget} target
 * @param {Input[]} queue
 * @param {{ onSound?: () => void, phaseButton?: EventTarget }} [opts]
 * @returns {() => void} unbind
 */
export function bindInput(target, queue, opts = {}) {
  const { onSound, phaseButton } = opts;

  /** @param {Event} ev */
  const onKey = (ev) => {
    const e = /** @type {KeyboardEvent} */ (ev);
    if (e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
    const key = typeof e.key === 'string' ? e.key.toLowerCase() : '';
    if (e.code === 'Space' || key === ' ') {
      e.preventDefault();
      queue.push('flip');
    } else if (e.code === 'KeyP' || key === 'p') {
      queue.push('phase');
    } else if (e.code === 'KeyM' || key === 'm') {
      if (onSound) onSound();
    }
  };

  /** @param {Event} ev */
  const onPointer = (ev) => {
    if (onButton(ev.target, phaseButton)) return;
    queue.push('flip');
  };

  /** @param {Event} ev */
  const onPhaseClick = (ev) => {
    ev.stopPropagation();
    queue.push('phase');
  };

  target.addEventListener('keydown', onKey);
  target.addEventListener('pointerdown', onPointer);
  if (phaseButton) phaseButton.addEventListener('click', onPhaseClick);

  return () => {
    target.removeEventListener('keydown', onKey);
    target.removeEventListener('pointerdown', onPointer);
    if (phaseButton) phaseButton.removeEventListener('click', onPhaseClick);
  };
}
