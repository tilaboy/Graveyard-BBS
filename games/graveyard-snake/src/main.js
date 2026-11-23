// @ts-check
// Browser shell (design §13). Requirements R1.2, R6.2 to R6.5, R7.3, R7.5, R7.6, R9.3.
//
// `boot` takes every side effect as a dependency (document, window, clock, frame scheduler,
// seed source, AudioContext factory), so the smoke test runs it with fakes. The simulation
// itself stays pure in `sim.js`.
import {
  FLASH_HZ,
  FLASH_MS,
  KINDS,
  MAX_STEPS_PER_FRAME,
  TICK_HZ,
} from "./config.js";
import { initialState, step } from "./sim.js";
import { draw } from "./render.js";
import { hudText, loadBest, saveBest, updateHud } from "./hud.js";
import { bindInput } from "./input.js";
import { createSound } from "./sound.js";

/** @typedef {import("./config.js").State} State */
/** @typedef {import("./config.js").Input} Input */
/** @typedef {import("./sound.js").Voice} Voice */

/** Length of one simulation tick in ms (R1.2: 60 Hz, independent of frame rate). */
export const TICK_MS = 1000 / TICK_HZ;
/** Canvas element id in index.html. */
export const CANVAS_ID = "screen";
/** Float tolerance for the tick accumulator in ms, so 60 frames of TICK_MS give 60 ticks. */
const EPSILON_MS = 1e-6;

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
 * @typedef {{
 *   getState: () => State,
 *   getBest: () => number,
 *   soundOn: () => boolean,
 *   stop: () => void,
 * }} Game
 */

/**
 * Catch flash state (R7.6): on for the first half of each 1 / FLASH_HZ period, for FLASH_MS
 * after the catch. 2 Hz is under the 3 flashes per second limit.
 * @param {number} sinceCatchMs
 * @returns {boolean}
 */
export function flashOn(sinceCatchMs) {
  if (sinceCatchMs < 0 || sinceCatchMs >= FLASH_MS) return false;
  const period = 1000 / FLASH_HZ;
  return sinceCatchMs % period < period / 2;
}

/**
 * Sounds for one tick, found by comparing the state before and after (design §13):
 * one eat blip per kind eaten, and the low organ chord when the run is lost (R8.3).
 * @param {State} prev
 * @param {State} next
 * @returns {Voice[]}
 */
export function soundEvents(prev, next) {
  /** @type {Voice[]} */
  const out = [];
  for (const kind of KINDS) {
    if (next.eaten[kind] > prev.eaten[kind]) {
      out.push(/** @type {Voice} */ (`eat-${kind}`));
    }
  }
  if (prev.phase !== "over" && next.phase === "over" && next.end !== "full") {
    out.push("caught");
  }
  return out;
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
 * Start the game on the title screen and run the fixed-tick loop.
 * - Each frame adds the elapsed ms to an accumulator and runs `step` once per TICK_MS, at most
 *   MAX_STEPS_PER_FRAME times; time beyond that is dropped so a background tab does not
 *   fast-forward the run.
 * - Key actions collected since the last tick are fed one per tick, so two quick turns both
 *   reach the sim's 2-turn buffer.
 * - `R` starts a new run with a fresh `seed()` (R6.4); `M` toggles sound (R6.5, R8.1).
 * - On game over the best score is stored under `graveyard-snake.best` (R7.3).
 * @param {BootDeps} deps
 * @returns {Game}
 */
export function boot(deps) {
  const { doc, win, now, raf, seed } = deps;

  let state = initialState(seed());
  let best = loadBest(win);
  const reducedMotion = prefersReducedMotion(win);
  const sound = createSound(deps.makeAudio);
  /** @type {Input[]} */
  const queue = [];
  /** Clock time of the last catch by a web, or null. */
  let caughtAt = /** @type {number | null} */ (null);

  const canvas = /** @type {HTMLCanvasElement | null} */ (
    doc.getElementById(CANVAS_ID)
  );
  const ctx =
    canvas && typeof canvas.getContext === "function"
      ? canvas.getContext("2d")
      : null;

  function restart() {
    queue.length = 0;
    caughtAt = null;
    state = step(initialState(seed()), { start: true });
  }

  function toggleSound() {
    try {
      sound.toggle();
    } catch {
      // No Web Audio in this browser: the game stays silent.
    }
  }

  const unbind = bindInput(doc, (action) => {
    if (action === "restart") restart();
    else if (action === "mute") toggleSound();
    else queue.push(action);
  });

  /** @param {State} prev @param {State} next */
  function afterTick(prev, next) {
    for (const voice of soundEvents(prev, next)) sound.play(voice);
    if (prev.phase !== "over" && next.phase === "over") {
      if (next.end === "web") caughtAt = now();
      if (next.score > best) best = next.score;
      saveBest(win, next.score);
    }
  }

  function render() {
    const t = now();
    if (ctx) {
      draw(ctx, state, {
        reducedMotion,
        flashOn: caughtAt !== null && !reducedMotion && flashOn(t - caughtAt),
      });
    }
    updateHud(doc, hudText(state, best));
  }

  let stopped = false;
  let acc = 0;
  let last = now();

  function onFrame() {
    if (stopped) return;
    const t = now();
    acc += Math.max(0, t - last);
    last = t;

    let steps = 0;
    while (acc + EPSILON_MS >= TICK_MS && steps < MAX_STEPS_PER_FRAME) {
      const prev = state;
      state = step(prev, queue.shift() ?? {});
      afterTick(prev, state);
      acc -= TICK_MS;
      steps += 1;
    }
    if (acc + EPSILON_MS >= TICK_MS) acc = 0;
    if (acc < 0) acc = 0;

    render();
    raf(onFrame);
  }

  render();
  raf(onFrame);

  return {
    getState: () => state,
    getBest: () => best,
    soundOn: () => sound.enabled,
    stop: () => {
      stopped = true;
      unbind();
    },
  };
}

/**
 * A fresh uint32 seed from the browser's crypto source (design §4).
 * @returns {number}
 */
function cryptoSeed() {
  const buf = new Uint32Array(1);
  globalThis.crypto.getRandomValues(buf);
  return buf[0] >>> 0;
}

/**
 * The browser's AudioContext, created only when the player presses M (R8.1).
 * @returns {AudioContext}
 */
function browserAudio() {
  const w =
    /** @type {{ AudioContext?: typeof AudioContext, webkitAudioContext?: typeof AudioContext }} */ (
      /** @type {unknown} */ (window)
    );
  const Ctor = w.AudioContext ?? w.webkitAudioContext;
  if (!Ctor) throw new Error("Web Audio is not available");
  return new Ctor();
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
    seed: cryptoSeed,
    makeAudio: browserAudio,
  });
}
