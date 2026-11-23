import { describe, it, expect } from "vitest";
import {
  FLIP_VY,
  GAP_H,
  GHOST_H,
  GHOST_W,
  GHOST_X,
  GRAVITY,
  GROUND_Y,
  OBSTACLE_W,
  PHASE_TICKS,
  RESTART_DELAY_TICKS,
  SCROLL_VX,
  WIDTH,
} from "../src/config.js";
import { START_Y, initialState, step } from "../src/sim.js";
import { runTape } from "./helpers.js";

/** @typedef {import('../src/config.js').State} State */

/** @param {unknown} o */
function deepFreeze(o) {
  if (o && typeof o === "object" && !Object.isFrozen(o)) {
    Object.freeze(o);
    for (const v of Object.values(o)) deepFreeze(v);
  }
  return o;
}

/**
 * A `playing` state with a safe ghost and no obstacles, overridable per test.
 * @param {Partial<State>} over
 * @returns {State}
 */
function playing(over = {}) {
  return { ...initialState(7), mode: "playing", nextId: 1, ...over };
}

/** An obstacle whose gap is centred on the ghost's start height. */
function obstacleAt(x, id = 0, extra = {}) {
  return {
    x,
    gapY: START_Y + GHOST_H / 2 - GAP_H / 2,
    scored: false,
    id,
    ...extra,
  };
}

describe("initialState (R1.1, R1.2, R5.9)", () => {
  it("starts in ready with score 0, power ready and no obstacles", () => {
    const s = initialState(42);
    expect(s.mode).toBe("ready");
    expect(s.tick).toBe(0);
    expect(s.score).toBe(0);
    expect(s.power).toEqual({ mode: "ready", left: 0 });
    expect(s.obstacles).toEqual([]);
    expect(s.nextId).toBe(0);
    expect(s.graceId).toBeNull();
    expect(s.deadAt).toBeNull();
    expect(s.events).toEqual([]);
    expect(s.ghost.vy).toBe(0);
    expect(s.ghost.y).toBeGreaterThan(0);
    expect(s.ghost.y + GHOST_H).toBeLessThan(GROUND_Y);
  });

  it("stores the seed as a uint32 PRNG word", () => {
    expect(initialState(-1).rng).toBe(0xffffffff);
    expect(initialState(5).rng).toBe(5);
  });
});

describe("step in ready (R1.3)", () => {
  it("without a flip nothing moves", () => {
    const s0 = initialState(1);
    const s1 = step(s0, []);
    expect(s1.mode).toBe("ready");
    expect(s1.ghost).toEqual(s0.ghost);
    expect(s1.tick).toBe(0);
    expect(s1.obstacles).toEqual([]);
  });

  it("a phase input alone does not start the run or the power", () => {
    const s1 = step(initialState(1), ["phase"]);
    expect(s1.mode).toBe("ready");
    expect(s1.power.mode).toBe("ready");
  });

  it("a flip enters playing and applies one flip in the same tick", () => {
    const s1 = step(initialState(1), ["flip"]);
    expect(s1.mode).toBe("playing");
    expect(s1.events).toContain("flip");
    expect(s1.ghost.vy).toBeCloseTo(FLIP_VY + GRAVITY);
    expect(s1.ghost.y).toBeCloseTo(START_Y + FLIP_VY + GRAVITY);
    expect(s1.tick).toBe(1);
    // design §8: the first obstacle spawns at x = WIDTH on the first playing tick.
    expect(s1.obstacles).toHaveLength(1);
    expect(s1.obstacles[0].x).toBe(WIDTH);
  });
});

describe("step in playing (R1.4, R2)", () => {
  it("advances exactly one fixed tick per call", () => {
    const states = runTape(3, ["flip", "none", "none", "none"]);
    expect(states.map((s) => s.tick)).toEqual([0, 1, 2, 3, 4]);
  });

  it("gravity pulls the ghost down and obstacles scroll left", () => {
    const s0 = playing({ obstacles: [obstacleAt(400)] });
    const s1 = step(s0, []);
    expect(s1.ghost.vy).toBeCloseTo(GRAVITY);
    expect(s1.obstacles[0].x).toBeCloseTo(400 - SCROLL_VX);
  });

  it("a flip replaces the current velocity (R2.1)", () => {
    const s1 = step(playing({ ghost: { y: 300, vy: 9 } }), ["flip"]);
    expect(s1.ghost.vy).toBeCloseTo(FLIP_VY + GRAVITY);
  });

  it("a phase input starts phase-through and emits phase-on (R5.2)", () => {
    const s1 = step(playing(), ["phase"]);
    expect(s1.power.mode).toBe("active");
    expect(s1.power.left).toBe(PHASE_TICKS - 1);
    expect(s1.events).toContain("phase-on");
  });

  it("events hold only this tick", () => {
    const s1 = step(playing(), ["flip"]);
    const s2 = step(s1, []);
    expect(s1.events).toEqual(["flip"]);
    expect(s2.events).toEqual([]);
  });

  it("never mutates its argument", () => {
    const s0 = deepFreeze(
      playing({ obstacles: [obstacleAt(GHOST_X - OBSTACLE_W + 1)] }),
    );
    const copy = structuredClone(s0);
    expect(() => step(s0, ["flip", "phase"])).not.toThrow();
    expect(s0).toEqual(copy);
    const r0 = deepFreeze(initialState(9));
    expect(() => step(r0, ["flip"])).not.toThrow();
  });
});

describe("death (R1.5)", () => {
  it("hitting a gravestone kills", () => {
    // Ghost sits inside the top pillar of an obstacle right on top of it.
    const o = { x: GHOST_X, gapY: GROUND_Y - GAP_H - 10, scored: false, id: 0 };
    const s1 = step(playing({ obstacles: [o] }), []);
    expect(s1.mode).toBe("dead");
    expect(s1.deadAt).toBe(0);
    expect(s1.events).toContain("die");
  });

  it("touching the ground kills", () => {
    const s1 = step(playing({ ghost: { y: GROUND_Y - GHOST_H, vy: 5 } }), []);
    expect(s1.mode).toBe("dead");
  });

  it("touching the ceiling kills", () => {
    const s1 = step(playing({ ghost: { y: 2, vy: 0 } }), ["flip"]);
    expect(s1.mode).toBe("dead");
  });

  it("flying through the gap does not kill", () => {
    const s1 = step(
      playing({
        ghost: { y: START_Y, vy: -GRAVITY },
        obstacles: [obstacleAt(GHOST_X)],
      }),
      [],
    );
    expect(s1.mode).toBe("playing");
  });

  it("while phasing a gravestone does not kill, the ground still does (R5.3, R5.4)", () => {
    const o = { x: GHOST_X, gapY: GROUND_Y - GAP_H - 10, scored: false, id: 0 };
    const phase = { mode: "active", left: 300 };
    expect(step(playing({ obstacles: [o], power: phase }), []).mode).toBe(
      "playing",
    );
    const low = playing({
      ghost: { y: GROUND_Y - GHOST_H, vy: 5 },
      power: phase,
    });
    expect(step(low, []).mode).toBe("dead");
  });
});

describe("dead and restart (R1.6, R5.9)", () => {
  /** @returns {State} */
  function deadState() {
    return {
      ...playing({ power: { mode: "cooldown", left: 500 }, score: 4 }),
      mode: "dead",
      deadAt: 10,
      tick: 11,
    };
  }

  it("time keeps counting but nothing else moves", () => {
    const d = deadState();
    const d1 = step(d, []);
    expect(d1.mode).toBe("dead");
    expect(d1.tick).toBe(12);
    expect(d1.ghost).toEqual(d.ghost);
    expect(d1.score).toBe(4);
  });

  it("a flip before 30 ticks is ignored", () => {
    let d = deadState();
    while (d.tick - (d.deadAt ?? 0) < RESTART_DELAY_TICKS) {
      d = step(d, ["flip"]);
      expect(d.mode).toBe("dead");
    }
  });

  it("a flip after 30 ticks starts a new run in ready with score 0 and power ready", () => {
    const d = { ...deadState(), tick: 10 + RESTART_DELAY_TICKS };
    const r = step(d, ["flip"], 99);
    expect(r).toEqual(initialState(99));
  });

  it("without a seed from the shell the new run uses the current PRNG word", () => {
    const d = { ...deadState(), tick: 10 + RESTART_DELAY_TICKS, rng: 1234 };
    expect(step(d, ["flip"])).toEqual(initialState(1234));
  });

  it("a phase input in dead does nothing", () => {
    const d = { ...deadState(), tick: 10 + RESTART_DELAY_TICKS };
    expect(step(d, ["phase"]).mode).toBe("dead");
  });
});

describe("score (R4.1, R4.2)", () => {
  const centre = GHOST_X + GHOST_W / 2;

  it("scores once when the ghost centre passes the right edge", () => {
    // After one scroll the right edge is just left of the centre.
    const o = obstacleAt(centre - OBSTACLE_W + SCROLL_VX - 0.5);
    const s1 = step(
      playing({ ghost: { y: START_Y, vy: -GRAVITY }, obstacles: [o] }),
      [],
    );
    expect(s1.score).toBe(1);
    expect(s1.events).toContain("score");
    expect(s1.obstacles[0].scored).toBe(true);
    const s2 = step(s1, []);
    expect(s2.score).toBe(1);
    expect(s2.events).not.toContain("score");
  });

  it("does not score before the centre passes the right edge", () => {
    const o = obstacleAt(centre - OBSTACLE_W + SCROLL_VX + 0.5);
    const s1 = step(
      playing({ ghost: { y: START_Y, vy: -GRAVITY }, obstacles: [o] }),
      [],
    );
    expect(s1.score).toBe(0);
  });

  it("a pass during phase-through counts the same", () => {
    const o = {
      x: centre - OBSTACLE_W + SCROLL_VX - 0.5,
      gapY: GROUND_Y - GAP_H - 10,
      scored: false,
      id: 0,
    };
    const s1 = step(
      playing({ obstacles: [o], power: { mode: "active", left: 100 } }),
      [],
    );
    expect(s1.mode).toBe("playing");
    expect(s1.score).toBe(1);
  });
});
