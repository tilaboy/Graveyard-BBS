// @ts-check
// Smoke test (R8.3, R1.4, R4.4): the page script loads, the loop starts on a fake clock and
// a scripted run through a fixed seed raises the score.
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, it, expect } from "vitest";
import { boot, BEST_KEY, MAX_STEPS_PER_FRAME, TICK_MS } from "../src/main.js";
import { START_Y } from "../src/sim.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const SEED = 7;

/** A canvas 2D context that accepts every call and property write. */
function fakeCtx() {
  /** @type {string[]} */
  const calls = [];
  const target = /** @type {Record<string, unknown>} */ ({});
  const ctx = new Proxy(target, {
    get(t, key) {
      if (typeof key !== "string") return undefined;
      if (key in t) return t[key];
      if (key === "measureText") return () => ({ width: 10 });
      if (key === "createLinearGradient" || key === "createRadialGradient") {
        return () => ({ addColorStop: () => {} });
      }
      return () => {
        calls.push(key);
      };
    },
    set(t, key, value) {
      if (typeof key === "string") t[key] = value;
      return true;
    },
  });
  return { ctx, calls };
}

/** A DOM element with text, attributes and listeners. */
function fakeEl() {
  /** @type {Map<string, Set<(e: unknown) => void>>} */
  const listeners = new Map();
  /** @type {Record<string, string>} */
  const attrs = {};
  return {
    textContent: /** @type {string | null} */ (""),
    attrs,
    /** @param {string} k @param {string} v */
    setAttribute(k, v) {
      attrs[k] = v;
    },
    /** @param {string} type @param {(e: unknown) => void} fn */
    addEventListener(type, fn) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type)?.add(fn);
    },
    /** @param {string} type @param {(e: unknown) => void} fn */
    removeEventListener(type, fn) {
      listeners.get(type)?.delete(fn);
    },
    /** @param {string} type @param {Record<string, unknown>} e */
    emit(type, e) {
      for (const fn of listeners.get(type) ?? []) fn(e);
    },
    /** @param {string} type */
    count(type) {
      return listeners.get(type)?.size ?? 0;
    },
  };
}

function makeWorld() {
  const { ctx, calls } = fakeCtx();
  const canvas = { getContext: () => ctx };
  const score = fakeEl();
  const line = fakeEl();
  const button = fakeEl();
  const docEl = fakeEl();
  /** @type {Record<string, unknown>} */
  const byId = {
    screen: canvas,
    "hud-score": score,
    "hud-line": line,
    "phase-btn": button,
  };
  const doc = Object.assign(docEl, {
    /** @param {string} id */
    getElementById: (id) => byId[id] ?? null,
  });

  /** @type {Map<string, string>} */
  const store = new Map();
  const win = {
    localStorage: {
      /** @param {string} k */
      getItem: (k) => store.get(k) ?? null,
      /** @param {string} k @param {string} v */
      setItem: (k, v) => {
        store.set(k, v);
      },
    },
    matchMedia: () => ({ matches: false }),
  };

  let clock = 0;
  /** @type {((t: number) => void) | null} */
  let pending = null;
  let frames = 0;
  const raf = (/** @type {(t: number) => void} */ cb) => {
    pending = cb;
    return ++frames;
  };

  const game = boot({
    doc: /** @type {Document} */ (/** @type {unknown} */ (doc)),
    win: /** @type {Window} */ (/** @type {unknown} */ (win)),
    now: () => clock,
    raf,
    seed: SEED,
  });

  /** Advance the fake clock by `ms` and run the scheduled frame. */
  const frame = (ms = TICK_MS) => {
    clock += ms;
    const cb = pending;
    pending = null;
    if (cb) cb(clock);
  };
  const key = (/** @type {string} */ code, /** @type {string} */ k) =>
    doc.emit("keydown", {
      code,
      key: k,
      repeat: false,
      preventDefault: () => {},
    });

  return {
    game,
    frame,
    key,
    doc,
    store,
    calls,
    score,
    line,
    button,
    hasPending: () => pending !== null,
  };
}

describe("smoke (R8.3)", () => {
  it("index.html loads src/main.js as a module and the file exists", () => {
    const html = readFileSync(join(root, "index.html"), "utf8");
    expect(html).toMatch(
      /<script type="module" src="src\/main\.js"><\/script>/,
    );
    expect(existsSync(join(root, "src", "main.js"))).toBe(true);
  });

  it("boot starts the loop: frames are scheduled, the canvas is drawn, the HUD is written", () => {
    const w = makeWorld();
    expect(w.hasPending()).toBe(true);
    expect(w.game.getState().mode).toBe("ready");
    expect(w.line.textContent).toContain("FLIP GHOST");
    expect(w.button.textContent).toBe("PHASE (P)");
    w.frame();
    expect(w.calls).toContain("fillRect");
    expect(w.hasPending()).toBe(true);
    w.game.stop();
  });

  it("a scripted run on a fixed seed raises the score above 0 and stores the best (R4.4)", () => {
    const w = makeWorld();
    w.key("Space", " ");
    w.frame();
    expect(w.game.getState().mode).toBe("playing");
    w.key("KeyP", "p");
    w.frame();
    expect(w.game.getState().power.mode).toBe("active");

    // Autopilot: flip whenever the ghost sinks below its start height and is falling.
    for (let i = 0; i < 400 && w.game.getState().score < 2; i += 1) {
      const s = w.game.getState();
      if (s.ghost.y > START_Y && s.ghost.vy > 0) w.key("Space", " ");
      w.frame();
    }
    const scored = w.game.getState().score;
    expect(w.game.getState().mode).toBe("playing");
    expect(scored).toBeGreaterThan(0);
    expect(w.score.textContent).toContain(`Score ${scored}`);

    // Stop flipping: the ghost falls to the ground and the run ends.
    for (let i = 0; i < 300 && w.game.getState().mode !== "dead"; i += 1)
      w.frame();
    expect(w.game.getState().mode).toBe("dead");
    expect(w.game.getBest()).toBe(scored);
    expect(w.store.get(BEST_KEY)).toBe(String(scored));
    w.game.stop();
  });

  it("R1.4 ticks follow the clock, not the frame rate, capped at 5 steps per frame", () => {
    const fast = makeWorld();
    const slow = makeWorld();
    fast.key("Space", " ");
    slow.key("Space", " ");
    for (let i = 0; i < 60; i += 1) fast.frame(TICK_MS);
    for (let i = 0; i < 30; i += 1) slow.frame(TICK_MS * 2);
    expect(fast.game.getState().tick).toBe(slow.game.getState().tick);
    expect(fast.game.getState().ghost.y).toBe(slow.game.getState().ghost.y);

    const before = fast.game.getState().tick;
    fast.frame(1000);
    expect(fast.game.getState().tick - before).toBe(MAX_STEPS_PER_FRAME);
    fast.game.stop();
    slow.game.stop();
  });

  it("best score starts at 0 with empty storage and stop unbinds input", () => {
    const w = makeWorld();
    expect(w.game.getBest()).toBe(0);
    expect(w.doc.count("keydown")).toBe(1);
    w.game.stop();
    expect(w.doc.count("keydown")).toBe(0);
    w.frame();
    expect(w.hasPending()).toBe(false);
  });
});
