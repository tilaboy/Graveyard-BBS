// @ts-check
// Keyboard input (design §9, R6.1 to R6.5).
// Arrow keys and W A S D turn, Space or Enter start, P pauses, R restarts, M toggles sound.

/** @typedef {import("./config.js").Dir} Dir */
/** @typedef {{turn: Dir} | {start: true} | {pause: true} | 'restart' | 'mute' | null} Action */

/** @type {Readonly<Record<string, Dir>>} */
const TURNS = Object.freeze({
  arrowup: "up",
  w: "up",
  arrowdown: "down",
  s: "down",
  arrowleft: "left",
  a: "left",
  arrowright: "right",
  d: "right",
});

/**
 * Map a `KeyboardEvent.key` value to a game action. Letters are case-insensitive.
 * `" "` is the Space key; `"Spacebar"` is the old IE / Edge spelling.
 * @param {string} key KeyboardEvent.key
 * @returns {Action}
 */
export function keyToAction(key) {
  if (typeof key !== "string") return null;
  const k = key.toLowerCase();
  const turn = Object.hasOwn(TURNS, k) ? TURNS[k] : undefined;
  if (turn) return { turn };
  if (k === " " || k === "spacebar" || k === "enter") return { start: true };
  if (k === "p") return { pause: true };
  if (k === "r") return "restart";
  if (k === "m") return "mute";
  return null;
}

/**
 * Add one `keydown` listener to `target`. Mapped keys call `preventDefault` (so arrows and
 * Space do not scroll the page) and `onAction`; unmapped keys pass through untouched.
 * Keys held with Ctrl, Meta or Alt are ignored so browser shortcuts (Ctrl+R, Cmd+W) keep
 * working. Auto-repeat is ignored for every key except turns, so holding P or M does not
 * flicker pause or sound.
 * @param {{addEventListener: Function, removeEventListener: Function}} target
 * @param {(action: Exclude<Action, null>) => void} onAction
 * @returns {() => void} unbind
 */
export function bindInput(target, onAction) {
  /** @param {KeyboardEvent} e */
  const onKey = (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const action = keyToAction(e.key);
    if (action === null) return;
    e.preventDefault();
    if (e.repeat && !(typeof action === "object" && "turn" in action)) return;
    onAction(action);
  };
  target.addEventListener("keydown", onKey);
  let bound = true;
  return () => {
    if (!bound) return;
    bound = false;
    target.removeEventListener("keydown", onKey);
  };
}
