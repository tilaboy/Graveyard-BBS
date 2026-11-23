// @ts-check
// DOM HUD: score, best, power label, state lines (design §9, R1.2, R4.3, R5.8, R6.3, R6.6).
// Every themed line carries the plain fact (score, best, seconds).
import { TICK_HZ } from './config.js';
import { powerLabel } from './power.js';

/** @typedef {import('./config.js').State} State */

/** Element ids in index.html. */
export const HUD_IDS = { score: 'hud-score', line: 'hud-line', button: 'phase-btn' };

/** @param {number} score @param {number} best */
export function scoreText(score, best) {
  return `Score ${score} · Best ${best}`;
}

/**
 * The state line under the score (design §9).
 * @param {State} state
 * @param {number} best
 * @returns {string}
 */
export function stateLine(state, best) {
  if (state.mode === 'ready') {
    return '👻 FLIP GHOST · Space / click / tap to flip · P phase · M sound';
  }
  if (state.mode === 'dead') {
    return `💀 The veil took you. ${scoreText(state.score, best)} · press Space to rise again`;
  }
  if (state.power.mode === 'active') {
    // Same seconds as the button label; no emoji (🔮 means awaiting-review on the BBS).
    return `Phase-through: ${Math.ceil((state.power.left + 1) / TICK_HZ)}s`;
  }
  return 'Space / click / tap to flip · P phase';
}

/**
 * Write the HUD. Missing elements are skipped. Text is only written when it changed,
 * so `aria-live` does not re-announce every frame.
 * @param {Document} doc
 * @param {State} state
 * @param {number} best
 * @returns {void}
 */
export function updateHud(doc, state, best) {
  const shownBest = Math.max(best, state.score);
  setText(doc.getElementById(HUD_IDS.score), scoreText(state.score, shownBest));
  setText(doc.getElementById(HUD_IDS.line), stateLine(state, shownBest));
  const button = doc.getElementById(HUD_IDS.button);
  setText(button, powerLabel(state.power));
  if (button) {
    // aria-disabled, not disabled: the button stays clickable and shows why (R5.8).
    button.setAttribute('aria-disabled', state.power.mode === 'ready' ? 'false' : 'true');
    button.setAttribute('data-power', state.power.mode);
  }
}

/** @param {{ textContent: string | null } | null} el @param {string} text */
function setText(el, text) {
  if (el && el.textContent !== text) el.textContent = text;
}
