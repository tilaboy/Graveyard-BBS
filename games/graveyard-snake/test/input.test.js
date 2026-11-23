import { describe, it, expect, vi } from "vitest";
import fc from "fast-check";
import { keyToAction, bindInput } from "../src/input.js";

/** A minimal EventTarget that records listeners. */
function fakeTarget() {
  /** @type {Map<string, Set<Function>>} */
  const listeners = new Map();
  return {
    listeners,
    /** @param {string} type @param {Function} fn */
    addEventListener(type, fn) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type)?.add(fn);
    },
    /** @param {string} type @param {Function} fn */
    removeEventListener(type, fn) {
      listeners.get(type)?.delete(fn);
    },
    /** @param {string} type @param {object} ev */
    dispatch(type, ev) {
      for (const fn of listeners.get(type) ?? []) fn(ev);
    },
    /** @param {string} type */
    count(type) {
      return listeners.get(type)?.size ?? 0;
    },
  };
}

/** @param {string} key @param {object} [extra] */
function keyEvent(key, extra = {}) {
  return {
    key,
    repeat: false,
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    preventDefault: vi.fn(),
    ...extra,
  };
}

const TURN_KEYS = [
  ["ArrowUp", "up"],
  ["ArrowDown", "down"],
  ["ArrowLeft", "left"],
  ["ArrowRight", "right"],
  ["w", "up"],
  ["s", "down"],
  ["a", "left"],
  ["d", "right"],
  ["W", "up"],
  ["S", "down"],
  ["A", "left"],
  ["D", "right"],
];

describe("keyToAction (design §9)", () => {
  it.each(TURN_KEYS)("R6.1 %s turns %s", (key, dir) => {
    expect(keyToAction(key)).toEqual({ turn: dir });
  });

  it("R6.1 arrow names are case-insensitive", () => {
    expect(keyToAction("arrowup")).toEqual({ turn: "up" });
    expect(keyToAction("ARROWLEFT")).toEqual({ turn: "left" });
  });

  it.each([" ", "Spacebar", "Enter"])("R6.2 %j starts a run", (key) => {
    expect(keyToAction(key)).toEqual({ start: true });
  });

  it.each(["p", "P"])("R6.3 %s pauses", (key) => {
    expect(keyToAction(key)).toEqual({ pause: true });
  });

  it.each(["r", "R"])("R6.4 %s restarts", (key) => {
    expect(keyToAction(key)).toBe("restart");
  });

  it.each(["m", "M"])("R6.5 %s toggles sound", (key) => {
    expect(keyToAction(key)).toBe("mute");
  });

  it.each(["x", "Escape", "Shift", "Tab", "1", "", "toString", "__proto__"])(
    "unmapped key %j gives null",
    (key) => {
      expect(keyToAction(key)).toBeNull();
    },
  );

  it("PBT: any string maps to null or a known action, never throws", () => {
    const known = new Set(["up", "down", "left", "right"]);
    fc.assert(
      fc.property(fc.string(), (key) => {
        const a = keyToAction(key);
        if (a === null || a === "restart" || a === "mute") return true;
        if ("turn" in a) return known.has(a.turn);
        if ("start" in a) return a.start === true;
        if ("pause" in a) return a.pause === true;
        return false;
      }),
    );
  });

  it("returns a fresh object each call, so callers cannot corrupt the table", () => {
    const a = keyToAction("w");
    expect(a).not.toBe(keyToAction("w"));
  });
});

describe("bindInput (design §9)", () => {
  it("adds exactly one keydown listener and unbind removes it", () => {
    const t = fakeTarget();
    const unbind = bindInput(t, () => {});
    expect(t.count("keydown")).toBe(1);
    expect([...t.listeners.keys()]).toEqual(["keydown"]);
    unbind();
    expect(t.count("keydown")).toBe(0);
    unbind();
    expect(t.count("keydown")).toBe(0);
  });

  it("R6.1 to R6.5 mapped keys call onAction and preventDefault", () => {
    const t = fakeTarget();
    const onAction = vi.fn();
    bindInput(t, onAction);
    const cases = [
      ["ArrowUp", { turn: "up" }],
      ["d", { turn: "right" }],
      [" ", { start: true }],
      ["Enter", { start: true }],
      ["P", { pause: true }],
      ["r", "restart"],
      ["M", "mute"],
    ];
    for (const [key, action] of cases) {
      const ev = keyEvent(/** @type {string} */ (key));
      t.dispatch("keydown", ev);
      expect(ev.preventDefault, String(key)).toHaveBeenCalledTimes(1);
      expect(onAction).toHaveBeenLastCalledWith(action);
    }
    expect(onAction).toHaveBeenCalledTimes(cases.length);
  });

  it("unmapped keys are not prevented and do not call onAction", () => {
    const t = fakeTarget();
    const onAction = vi.fn();
    bindInput(t, onAction);
    for (const key of ["Tab", "x", "F5", "Escape"]) {
      const ev = keyEvent(key);
      t.dispatch("keydown", ev);
      expect(ev.preventDefault, key).not.toHaveBeenCalled();
    }
    expect(onAction).not.toHaveBeenCalled();
  });

  it("keys held with Ctrl, Meta or Alt are left to the browser", () => {
    const t = fakeTarget();
    const onAction = vi.fn();
    bindInput(t, onAction);
    for (const mod of ["ctrlKey", "metaKey", "altKey"]) {
      const ev = keyEvent("r", { [mod]: true });
      t.dispatch("keydown", ev);
      expect(ev.preventDefault, mod).not.toHaveBeenCalled();
    }
    expect(onAction).not.toHaveBeenCalled();
  });

  it("auto-repeat repeats turns but not pause, restart, mute or start", () => {
    const t = fakeTarget();
    const onAction = vi.fn();
    bindInput(t, onAction);
    for (const key of ["p", "r", "m", " ", "Enter"]) {
      const ev = keyEvent(key, { repeat: true });
      t.dispatch("keydown", ev);
      expect(ev.preventDefault, key).toHaveBeenCalledTimes(1);
    }
    expect(onAction).not.toHaveBeenCalled();
    t.dispatch("keydown", keyEvent("ArrowLeft", { repeat: true }));
    expect(onAction).toHaveBeenCalledWith({ turn: "left" });
  });

  it("after unbind no key reaches onAction", () => {
    const t = fakeTarget();
    const onAction = vi.fn();
    const unbind = bindInput(t, onAction);
    unbind();
    t.dispatch("keydown", keyEvent("w"));
    expect(onAction).not.toHaveBeenCalled();
  });
});
