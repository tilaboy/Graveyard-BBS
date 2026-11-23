// @ts-check
// HUD text and best score (design §11, R7.1 to R7.4).
// Every themed line carries the plain fact (reason, score), and every creature and end
// reason is named in words, never by emoji alone (R7.4).
import { BEST_KEY } from "./config.js";

/** @typedef {import("./config.js").State} State */
/** @typedef {import("./config.js").EndReason} EndReason */
/**
 * @typedef {{score: string, length: string, eaten: string, spiders: string,
 *   best: string, status: string}} HudText
 */

/** Element ids written by `updateHud`, in index.html. */
export const HUD_IDS = Object.freeze(
  /** @type {const} */ ([
    "score",
    "length",
    "eaten",
    "spiders",
    "best",
    "status",
  ]),
);

/** Status line per phase (design §11). */
export const TITLE_LINE = "🎃 Press Space to rise from the grave";
export const PAUSED_LINE = "💤 Paused · press P";

/**
 * Themed lead of the game-over line per end reason (design §11 table).
 * @type {Readonly<Record<EndReason, string>>}
 */
export const END_LINES = Object.freeze({
  web: "💀 Caught in a spider web · GAME OVER",
  wall: "💀 Crashed into the graveyard fence · GAME OVER",
  self: "💀 Bit your own bones · GAME OVER",
  full: "✅ The graveyard is full · YOU WIN",
});

/**
 * @param {State} state
 * @returns {string}
 */
function statusLine(state) {
  switch (state.phase) {
    case "title":
      return TITLE_LINE;
    case "paused":
      return PAUSED_LINE;
    case "over": {
      const reason = state.end ?? "wall";
      return `${END_LINES[reason]} · reason: ${reason} · score ${state.score}`;
    }
    default:
      return `👻 Slithering through the graveyard · playing · score ${state.score}`;
  }
}

/**
 * HUD strings for a state. `best` shows the higher of the stored best and the live score,
 * so a new record is visible during the run.
 * @param {State} state
 * @param {number} best
 * @returns {HudText}
 */
export function hudText(state, best) {
  const { ghost, skeleton, dinosaur } = state.eaten;
  return {
    score: String(state.score),
    length: String(state.snake.length),
    eaten: `ghost ${ghost} · skeleton ${skeleton} · dinosaur ${dinosaur}`,
    spiders: String(state.spiders.length),
    best: String(Math.max(best, state.score)),
    status: statusLine(state),
  };
}

/**
 * Writes each HUD string into the `textContent` of its element. Missing elements are
 * skipped. `#status` is the `aria-live="polite"` region in index.html (R7.4).
 * @param {Pick<Document, "getElementById">} doc
 * @param {HudText} text
 * @returns {void}
 */
export function updateHud(doc, text) {
  for (const id of HUD_IDS) {
    const el = doc.getElementById(id);
    if (el && el.textContent !== text[id]) el.textContent = text[id];
  }
}

/**
 * Reads the best score from `localStorage` key `graveyard-snake.best` (R7.3).
 * @param {{localStorage: Pick<Storage, "getItem">}} win
 * @returns {number} best score, 0 when missing, bad or unreadable
 */
export function loadBest(win) {
  try {
    const raw = win.localStorage.getItem(BEST_KEY);
    if (raw === null || !/^\d+$/.test(raw.trim())) return 0;
    const n = Number(raw.trim());
    return Number.isSafeInteger(n) ? n : 0;
  } catch {
    return 0;
  }
}

/**
 * Stores `n` as the best score when it beats the stored one (never lowers it).
 * Bad values and storage errors (private mode, quota) are ignored.
 * @param {{localStorage: Pick<Storage, "getItem" | "setItem">}} win
 * @param {number} n
 * @returns {void}
 */
export function saveBest(win, n) {
  if (!Number.isSafeInteger(n) || n < 0) return;
  if (n <= loadBest(win)) return;
  try {
    win.localStorage.setItem(BEST_KEY, String(n));
  } catch {
    // Storage unavailable: the best score lives only for this page.
  }
}
