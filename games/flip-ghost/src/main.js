// @ts-check
// Browser shell: fixed-tick loop wiring input, sim, render, HUD, sound (design §9). Task 9.
//
// `boot` takes every side effect as a dependency (document, window, clock, frame scheduler),
// so the smoke test can run it with fakes. The simulation itself stays in `sim.js`.
import { TICK_HZ } from "./config.js";
import { initialState, step } from "./sim.js";
import { draw } from "./render.js";
import { updateHud, HUD_IDS } from "./hud.js";
import { bindInput } from "./input.js";
import { createSound, VOICES } from "./sound.js";

/** @typedef {import('./config.js').State} State */
/** @typedef {import('./config.js').Input} Input */
/** @typedef {import('./sound.js').SoundName} SoundName */

/** Length of one simulation tick in ms (R1.4). */
export const TICK_MS = 1000 / TICK_HZ;
/** Most ticks run in one frame, so a background tab does not fast-forward the game (design §9). */
export const MAX_STEPS_PER_FRAME = 5;
/** Float tolerance for the tick accumulator in ms. */
const EPSILON_MS = 1e-6;
/** `localStorage` key of the best score (R4.4). */
export const BEST_KEY = "flip-ghost.best";
/** Canvas element id in index.html. */
export const CANVAS_ID = "screen";

/**
 * Read the stored best score. Private mode or a bad value reads as 0.
 * @param {Window} win
 * @returns {number}
 */
export function loadBest(win) {
  try {
    const raw = win.localStorage ? win.localStorage.getItem(BEST_KEY) : null;
    const n = raw === null ? 0 : Number.parseInt(raw, 10);
    return Number.isFinite(n) && n > 0 ? n : 0;
  } catch {
    return 0;
  }
}

/**
 * Store the best score; errors (private mode, quota) are ignored (R4.4).
 * @param {Window} win
 * @param {number} best
 * @returns {void}
 */
export function saveBest(win, best) {
  try {
    if (win.localStorage) win.localStorage.setItem(BEST_KEY, String(best));
  } catch {
    // Storage is optional; the best score still lives for this page.
  }
}

/**
 * @param {Window} win
 * @returns {boolean}
 */
function prefersReducedMotion(win) {
  try {
    return typeof win.matchMedia === "function"
      ? win.matchMedia("(prefers-reduced-motion: reduce)").matches === true
      : false;
  } catch {
    return false;
  }
}

/**
 * Sound is created lazily by `createSound`; a window without Web Audio gets a silent stand-in.
 * @param {Window} win
 * @returns {{ toggle: () => boolean, play: (name: SoundName) => void }}
 */
function makeSound(win) {
  const w =
    /** @type {{ AudioContext?: typeof AudioContext, webkitAudioContext?: typeof AudioContext }} */ (
      /** @type {unknown} */ (win)
    );
  const Ctor = w.AudioContext ?? w.webkitAudioContext;
  if (!Ctor) return { toggle: () => false, play: () => {} };
  return createSound(Ctor);
}

/**
 * Load the Kiro ghost sprite once. Until it loads (or without `Image`) the renderer draws its
 * vector fallback.
 * @param {Window} win
 * @param {(img: CanvasImageSource) => void} onLoad
 * @returns {void}
 */
function loadSprite(win, onLoad) {
  const w = /** @type {{ Image?: typeof Image }} */ (
    /** @type {unknown} */ (win)
  );
  if (typeof w.Image !== "function") return;
  try {
    const img = new w.Image();
    img.onload = () => onLoad(img);
    img.src = new URL("../assets/kiro-ghost.svg", import.meta.url).href;
  } catch {
    // No sprite: the fallback body is drawn.
  }
}

/** @param {string} name @returns {name is SoundName} */
function isSoundName(name) {
  return Object.prototype.hasOwnProperty.call(VOICES, name);
}

/**
 * Start the game loop.
 * - Each frame adds the elapsed ms to an accumulator and runs `step` once per TICK_MS, at most
 *   MAX_STEPS_PER_FRAME times; leftover time beyond that is dropped (R1.4).
 * - Inputs queued between ticks are applied together on the next tick.
 * - After the ticks, the frame is drawn once and the HUD is updated.
 * - When a run ends above the best score, the best is stored under `flip-ghost.best` (R4.4).
 * @param {{
 *   doc: Document,
 *   win: Window,
 *   now: () => number,
 *   raf: (cb: (t: number) => void) => number,
 *   seed?: number
 * }} deps `seed` fixes the first run's seed (tests); by default it comes from `now()`
 * @returns {{ getState: () => State, getBest: () => number, stop: () => void }}
 */
export function boot(deps) {
  const { doc, win, now, raf } = deps;
  const seedFromClock = () => Math.floor(now() * 1000) >>> 0;

  let state = initialState(deps.seed ?? seedFromClock());
  let best = loadBest(win);
  /** @type {Input[]} */
  const queue = [];
  const sound = makeSound(win);
  const reducedMotion = prefersReducedMotion(win);

  /** @type {CanvasImageSource | null} */
  let sprite = null;
  loadSprite(win, (img) => {
    sprite = img;
  });

  const canvas = /** @type {HTMLCanvasElement | null} */ (
    doc.getElementById(CANVAS_ID)
  );
  const ctx =
    canvas && typeof canvas.getContext === "function"
      ? canvas.getContext("2d")
      : null;

  const phaseButton = doc.getElementById(HUD_IDS.button) ?? undefined;
  const unbind = bindInput(doc, queue, {
    phaseButton,
    onSound: () => {
      sound.toggle();
    },
  });

  let stopped = false;
  let frame = 0;
  let acc = 0;
  let last = now();

  /** @param {State} prev @param {State} next */
  function afterTick(prev, next) {
    for (const ev of next.events) {
      if (isSoundName(ev)) sound.play(ev);
    }
    if (prev.mode === "playing" && next.mode === "dead" && next.score > best) {
      best = next.score;
      saveBest(win, best);
    }
  }

  function render() {
    if (ctx) draw(ctx, state, sprite, { reducedMotion, frame });
    updateHud(doc, state, best);
  }

  function onFrame() {
    if (stopped) return;
    const t = now();
    acc += Math.max(0, t - last);
    last = t;

    let steps = 0;
    // EPSILON_MS absorbs float drift, so 60 frames of TICK_MS give exactly 60 ticks.
    while (acc + EPSILON_MS >= TICK_MS && steps < MAX_STEPS_PER_FRAME) {
      const inputs = queue.splice(0, queue.length);
      const prev = state;
      state = step(prev, inputs, seedFromClock());
      afterTick(prev, state);
      acc -= TICK_MS;
      steps += 1;
    }
    if (steps === MAX_STEPS_PER_FRAME && acc + EPSILON_MS >= TICK_MS) acc = 0;
    if (acc < 0) acc = 0;

    frame += 1;
    render();
    raf(onFrame);
  }

  render();
  raf(onFrame);

  return {
    getState: () => state,
    getBest: () => best,
    stop: () => {
      stopped = true;
      unbind();
    },
  };
}

// Auto-start in a real browser page; tests import `boot` and pass fakes instead.
if (
  typeof window !== "undefined" &&
  typeof document !== "undefined" &&
  document.getElementById(CANVAS_ID)
) {
  boot({
    doc: document,
    win: window,
    now: () => performance.now(),
    raf: (cb) => window.requestAnimationFrame(cb),
  });
}
