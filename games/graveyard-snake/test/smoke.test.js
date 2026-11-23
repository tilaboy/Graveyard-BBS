// @ts-check
// Smoke test (R9.3, R1.2, R6.2 to R6.5, R7.3, R7.6): the page script loads, the loop starts
// on a fake clock, and a scripted run through a fixed seed raises the score.
import { describe, it, expect } from "vitest";
import { boot, flashOn, soundEvents, TICK_MS, CANVAS_ID } from "../src/main.js";
import {
  BEST_KEY,
  COLS,
  FLASH_MS,
  MAX_STEPS_PER_FRAME,
  ROWS,
} from "../src/config.js";
import { initialState, step } from "../src/sim.js";
import { hazardSet, key } from "../src/grid.js";
import { TITLE_LINE } from "../src/hud.js";

/** @typedef {import("../src/config.js").State} State */
/** @typedef {import("../src/config.js").Dir} Dir */

/** A canvas 2D context that accepts every call and property write. */
function fakeCtx() {
  /** @type {string[]} */
  const calls = [];
  const target = /** @type {Record<string, unknown>} */ ({});
  const ctx = new Proxy(target, {
    get(t, k) {
      if (typeof k !== "string") return undefined;
      if (k in t) return t[k];
      if (k === "measureText") return () => ({ width: 10 });
      return () => {
        calls.push(k);
      };
    },
    set(t, k, value) {
      if (typeof k === "string") t[k] = value;
      return true;
    },
  });
  return { ctx, calls };
}

/** A fake AudioContext that counts oscillators started. */
function fakeAudio() {
  const log = { created: 0, oscillators: /** @type {number[]} */ ([]) };
  const param = () => ({
    setValueAtTime() {},
    exponentialRampToValueAtTime() {},
  });
  const make = () => {
    log.created += 1;
    return /** @type {AudioContext} */ (
      /** @type {unknown} */ ({
        currentTime: 0,
        state: "running",
        destination: {},
        resume: async () => {},
        createOscillator() {
          const osc = {
            type: "sine",
            frequency: {
              ...param(),
              /** @param {number} f */
              setValueAtTime(f) {
                osc.freq = f;
              },
            },
            freq: 0,
            connect() {},
            start() {
              log.oscillators.push(osc.freq);
            },
            stop() {},
          };
          return osc;
        },
        createGain: () => ({ gain: param(), connect() {} }),
      })
    );
  };
  return { make, log };
}

/**
 * @param {{seeds?: number[], reducedMotion?: boolean, stored?: string}} [opts]
 */
function makeWorld(opts = {}) {
  const { ctx, calls } = fakeCtx();
  /** @type {Record<string, {textContent: string}>} */
  const els = {};
  for (const id of ["score", "length", "eaten", "spiders", "best", "status"]) {
    els[id] = { textContent: "" };
  }
  /** @type {Set<(e: unknown) => void>} */
  const keyListeners = new Set();
  const doc = {
    /** @param {string} id */
    getElementById: (id) =>
      id === CANVAS_ID ? { getContext: () => ctx } : (els[id] ?? null),
    /** @param {string} type @param {(e: unknown) => void} fn */
    addEventListener(type, fn) {
      if (type === "keydown") keyListeners.add(fn);
    },
    /** @param {string} type @param {(e: unknown) => void} fn */
    removeEventListener(type, fn) {
      if (type === "keydown") keyListeners.delete(fn);
    },
  };
  /** @param {string} k */
  const press = (k) => {
    for (const fn of keyListeners) {
      fn({ key: k, repeat: false, preventDefault() {} });
    }
  };

  /** @type {Map<string, string>} */
  const store = new Map();
  if (opts.stored !== undefined) store.set(BEST_KEY, opts.stored);
  const win = {
    localStorage: {
      /** @param {string} k */
      getItem: (k) => store.get(k) ?? null,
      /** @param {string} k @param {string} v */
      setItem: (k, v) => {
        store.set(k, v);
      },
    },
    matchMedia: () => ({ matches: opts.reducedMotion === true }),
  };

  const seeds = [...(opts.seeds ?? [7, 99, 1234])];
  let seedCalls = 0;
  const seed = () => {
    seedCalls += 1;
    return seeds.length > 1 ? /** @type {number} */ (seeds.shift()) : seeds[0];
  };

  let clock = 0;
  /** @type {((t: number) => void) | null} */
  let pending = null;
  let frames = 0;
  const raf = (/** @type {(t: number) => void} */ cb) => {
    pending = cb;
    return ++frames;
  };
  const audio = fakeAudio();

  const game = boot({
    doc: /** @type {Document} */ (/** @type {unknown} */ (doc)),
    win: /** @type {Window} */ (/** @type {unknown} */ (win)),
    now: () => clock,
    raf,
    seed,
    makeAudio: audio.make,
  });

  /** Advance the fake clock by `ms` and run one animation frame. */
  const frame = (ms = TICK_MS) => {
    clock += ms;
    const cb = pending;
    pending = null;
    if (cb) cb(clock);
  };

  return {
    game,
    els,
    calls,
    store,
    press,
    frame,
    audio,
    keyListeners,
    seedCalls: () => seedCalls,
    frames: () => frames,
  };
}

/** @type {Record<Dir, [number, number]>} */
const DELTA = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };
/** @type {Record<Dir, string>} */
const KEY = {
  up: "ArrowUp",
  down: "ArrowDown",
  left: "ArrowLeft",
  right: "ArrowRight",
};

/**
 * First direction of a shortest safe path from the head to the creature, avoiding walls,
 * webs and the body. Null when there is no path.
 * @param {State} s
 * @returns {Dir | null}
 */
function pathTo(s) {
  if (!s.creature) return null;
  const blocked = hazardSet(s.spiders);
  for (const c of s.snake.slice(0, -1)) blocked.add(key(c));
  const head = s.snake[0];
  const goal = key(s.creature.at);
  /** @type {Map<string, Dir>} */
  const first = new Map();
  /** @type {{x: number, y: number}[]} */
  const todo = [];
  for (const d of /** @type {Dir[]} */ (Object.keys(DELTA))) {
    const n = { x: head.x + DELTA[d][0], y: head.y + DELTA[d][1] };
    const k = key(n);
    if (n.x < 0 || n.y < 0 || n.x >= COLS || n.y >= ROWS) continue;
    if (blocked.has(k) || first.has(k)) continue;
    // The sim drops a reverse turn, so never plan one.
    const [dx, dy] = DELTA[s.dir];
    if (DELTA[d][0] === -dx && DELTA[d][1] === -dy) continue;
    first.set(k, d);
    todo.push(n);
  }
  while (todo.length) {
    const c = /** @type {{x: number, y: number}} */ (todo.shift());
    const d = /** @type {Dir} */ (first.get(key(c)));
    if (key(c) === goal) return d;
    for (const [dx, dy] of Object.values(DELTA)) {
      const n = { x: c.x + dx, y: c.y + dy };
      const k = key(n);
      if (n.x < 0 || n.y < 0 || n.x >= COLS || n.y >= ROWS) continue;
      if (blocked.has(k) || first.has(k)) continue;
      first.set(k, d);
      todo.push(n);
    }
  }
  return null;
}

describe("smoke: page script and loop (R9.3)", () => {
  it("R9.3 src/main.js loads in Node without a DOM and does not auto-boot", async () => {
    const mod = await import("../src/main.js");
    expect(typeof mod.boot).toBe("function");
  });

  it("R1.2 boot draws the title, then runs one 60 Hz tick per 16.7 ms frame", () => {
    const w = makeWorld();
    expect(w.calls).toContain("fillRect");
    expect(w.els.status.textContent).toBe(TITLE_LINE);
    expect(w.els.length.textContent).toBe("3");
    expect(w.frames()).toBe(1);

    w.press(" ");
    w.frame();
    expect(w.game.getState().phase).toBe("play");
    for (let i = 0; i < 59; i += 1) w.frame();
    expect(w.game.getState().tick).toBe(59);
    expect(w.frames()).toBe(61);
    w.game.stop();
  });

  it("R1.2 a long frame runs at most MAX_STEPS_PER_FRAME ticks and drops the rest", () => {
    const w = makeWorld();
    w.press("Enter");
    w.frame();
    const before = w.game.getState().tick;
    w.frame(10_000);
    expect(w.game.getState().tick - before).toBe(MAX_STEPS_PER_FRAME);
    w.frame(TICK_MS);
    expect(w.game.getState().tick - before).toBe(MAX_STEPS_PER_FRAME + 1);
  });

  it("R6.3 P pauses and resumes the run", () => {
    const w = makeWorld();
    w.press(" ");
    w.frame();
    w.press("p");
    w.frame();
    const t = w.game.getState().tick;
    for (let i = 0; i < 30; i += 1) w.frame();
    expect(w.game.getState().phase).toBe("paused");
    expect(w.game.getState().tick).toBe(t);
    expect(w.els.status.textContent).toContain("Paused");
    w.press("P");
    w.frame();
    w.frame();
    expect(w.game.getState().phase).toBe("play");
    expect(w.game.getState().tick).toBeGreaterThan(t);
  });

  it("R6.4 R starts a new run with a new seed from seed()", () => {
    const w = makeWorld({ seeds: [7, 99] });
    expect(w.seedCalls()).toBe(1);
    w.press("r");
    expect(w.seedCalls()).toBe(2);
    const s = w.game.getState();
    expect(s.phase).toBe("play");
    expect(s).toEqual(step(initialState(99), { start: true }));
  });

  it("R6.5 R8.1 M toggles sound; the AudioContext is made only on the first M", () => {
    const w = makeWorld();
    expect(w.game.soundOn()).toBe(false);
    expect(w.audio.log.created).toBe(0);
    w.press("m");
    expect(w.game.soundOn()).toBe(true);
    expect(w.audio.log.created).toBe(1);
    expect(w.audio.log.oscillators).toEqual([660, 880]);
    w.press("M");
    expect(w.game.soundOn()).toBe(false);
    w.press("m");
    expect(w.audio.log.created).toBe(1);
  });

  it("stop() removes the key listener and ends the loop", () => {
    const w = makeWorld();
    expect(w.keyListeners.size).toBe(1);
    w.game.stop();
    expect(w.keyListeners.size).toBe(0);
    const n = w.frames();
    w.frame();
    expect(w.frames()).toBe(n);
  });

  it("R9.3 R7.3 R8.3 a scripted run raises the score, plays eat blips and saves the best", () => {
    const w = makeWorld({ seeds: [7], stored: "garbage" });
    expect(w.els.best.textContent).toBe("0");
    w.press("m");
    w.press(" ");

    // Autopilot: steer along a safe shortest path until 3 creatures are eaten.
    let guard = 0;
    while (w.game.getState().score < 3 && guard < 20_000) {
      const s = w.game.getState();
      expect(s.phase, `run ended early: ${s.end}`).not.toBe("over");
      if (s.phase === "play" && s.turns.length === 0) {
        const d = pathTo(s);
        if (d && d !== s.dir) w.press(KEY[d]);
      }
      w.frame();
      guard += 1;
    }
    const s = w.game.getState();
    expect(s.score).toBeGreaterThanOrEqual(3);
    expect(Number(w.els.score.textContent)).toBe(s.score);
    expect(Number(w.els.length.textContent)).toBe(s.snake.length);
    const eatFreqs = new Set([520, 392, 196]);
    expect(w.audio.log.oscillators.some((f) => eatFreqs.has(f))).toBe(true);

    // Let go of the keys: the snake runs into a wall, a web or itself.
    guard = 0;
    while (w.game.getState().phase !== "over" && guard < 20_000) {
      w.frame();
      guard += 1;
    }
    const over = w.game.getState();
    expect(over.phase).toBe("over");
    expect(w.els.status.textContent).toContain(`reason: ${over.end}`);
    expect(w.els.status.textContent).toContain(`score ${over.score}`);
    expect(w.store.get(BEST_KEY)).toBe(String(over.score));
    expect(w.game.getBest()).toBe(over.score);
    if (over.end !== "full") {
      expect(w.audio.log.oscillators.slice(-3)).toEqual([65, 98, 131]);
    }
  });

  it("R7.3 a stored best score above the run is kept", () => {
    const w = makeWorld({ stored: "500" });
    expect(w.els.best.textContent).toBe("500");
    w.press(" ");
    while (w.game.getState().phase !== "over") w.frame();
    expect(w.store.get(BEST_KEY)).toBe("500");
  });
});

describe("smoke: helpers", () => {
  it("R7.6 the catch flash runs at 2 Hz for 1.5 s, under 3 flashes per second", () => {
    expect(flashOn(0)).toBe(true);
    expect(flashOn(249)).toBe(true);
    expect(flashOn(250)).toBe(false);
    expect(flashOn(500)).toBe(true);
    expect(flashOn(FLASH_MS)).toBe(false);
    expect(flashOn(-1)).toBe(false);
    let rises = 0;
    for (let t = 1; t < 1000; t += 1) {
      if (flashOn(t) && !flashOn(t - 1)) rises += 1;
    }
    expect(rises).toBeLessThan(3);
  });

  it("R8.3 soundEvents: one blip per kind eaten, organ chord on a loss only", () => {
    const a = step(initialState(7), { start: true });
    const b = { ...a, eaten: { ...a.eaten, skeleton: 1 } };
    expect(soundEvents(a, b)).toEqual(["eat-skeleton"]);
    /** @type {State} */
    const lost = { ...a, phase: "over", end: "web" };
    expect(soundEvents(a, lost)).toEqual(["caught"]);
    /** @type {State} */
    const won = { ...a, phase: "over", end: "full" };
    expect(soundEvents(a, won)).toEqual([]);
    expect(soundEvents(lost, lost)).toEqual([]);
  });
});
