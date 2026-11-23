import { describe, it, expect } from "vitest";
import fc from "fast-check";
import {
  GAP_H,
  GHOST_H,
  GHOST_W,
  GHOST_X,
  GROUND_Y,
  OBSTACLE_W,
  PHASE_TICKS,
} from "../src/config.js";
import { collide, ghostBox, hits } from "../src/collide.js";
import { initialPower, tickPower, trigger } from "../src/power.js";

/** @returns {import('../src/config.js').State} */
function makeState(over = {}) {
  return {
    mode: "playing",
    tick: 42,
    ghost: { y: 300, vy: 0 },
    obstacles: [],
    nextId: 0,
    scrolled: 0,
    rng: 1,
    score: 0,
    power: initialPower(),
    graceId: null,
    deadAt: null,
    events: [],
    ...over,
  };
}

/** An obstacle whose gap is [gapY, gapY + GAP_H], placed over the ghost column. */
function obstacle(over = {}) {
  return { x: GHOST_X, gapY: 200, scored: false, id: 0, ...over };
}

const active = { mode: "active", left: 100 };
const cooldown = { mode: "cooldown", left: 100 };

describe("collide.hits (design §7)", () => {
  const o = obstacle({ x: 200, gapY: 200 });

  it("box inside the gap does not hit", () => {
    expect(hits({ x: 200, y: 200, w: 40, h: GAP_H }, o)).toBe(false);
  });

  it("box overlapping the top gravestone by 1 px hits", () => {
    expect(hits({ x: 200, y: 199, w: 40, h: 44 }, o)).toBe(true);
  });

  it("box overlapping the bottom gravestone by 1 px hits", () => {
    expect(hits({ x: 200, y: 200 + GAP_H - 43, w: 40, h: 44 }, o)).toBe(true);
  });

  it("touching edges do not hit (left, right, gap top, gap bottom)", () => {
    expect(hits({ x: 200 - 40, y: 0, w: 40, h: 44 }, o)).toBe(false);
    expect(hits({ x: 200 + OBSTACLE_W, y: 0, w: 40, h: 44 }, o)).toBe(false);
    expect(hits({ x: 200, y: 200, w: 40, h: 44 }, o)).toBe(false);
    expect(hits({ x: 200, y: 200 + GAP_H - 44, w: 40, h: 44 }, o)).toBe(false);
  });

  it("1 px horizontal overlap on either side hits", () => {
    expect(hits({ x: 200 - 39, y: 0, w: 40, h: 44 }, o)).toBe(true);
    expect(hits({ x: 200 + OBSTACLE_W - 1, y: 0, w: 40, h: 44 }, o)).toBe(true);
  });

  it("a zero-height gravestone is never hit", () => {
    const flush = obstacle({ x: 200, gapY: GROUND_Y - GAP_H });
    expect(hits({ x: 200, y: GROUND_Y - 44, w: 40, h: 44 }, flush)).toBe(false);
  });

  it("ghostBox is GHOST_W x GHOST_H at GHOST_X", () => {
    expect(ghostBox(10)).toEqual({ x: GHOST_X, y: 10, w: GHOST_W, h: GHOST_H });
  });
});

describe("collide.collide edges (R1.5, R5.4)", () => {
  it("ceiling: y < 0 dies, y = 0 lives", () => {
    const dead = collide(makeState({ ghost: { y: -0.1, vy: 0 } }));
    expect(dead.mode).toBe("dead");
    expect(dead.deadAt).toBe(42);
    expect(dead.events).toEqual(["die"]);
    expect(collide(makeState({ ghost: { y: 0, vy: 0 } })).mode).toBe("playing");
  });

  it("ground: y + GHOST_H > GROUND_Y dies, = GROUND_Y lives", () => {
    expect(
      collide(makeState({ ghost: { y: GROUND_Y - GHOST_H + 0.1, vy: 0 } }))
        .mode,
    ).toBe("dead");
    expect(
      collide(makeState({ ghost: { y: GROUND_Y - GHOST_H, vy: 0 } })).mode,
    ).toBe("playing");
  });

  it("R5.4 ceiling and ground still kill while phasing", () => {
    expect(
      collide(makeState({ power: active, ghost: { y: -5, vy: 0 } })).mode,
    ).toBe("dead");
    expect(
      collide(makeState({ power: active, ghost: { y: GROUND_Y, vy: 0 } })).mode,
    ).toBe("dead");
  });
});

describe("collide.collide obstacles (R1.5, R5.3)", () => {
  const inStone = { y: 100, vy: 0 }; // inside the top gravestone of gapY 200

  it("R1.5 hitting an obstacle with power ready or cooldown dies", () => {
    for (const power of [initialPower(), cooldown]) {
      const s = collide(
        makeState({ power, ghost: inStone, obstacles: [obstacle()] }),
      );
      expect(s.mode).toBe("dead");
      expect(s.events).toEqual(["die"]);
    }
  });

  it("R5.3 obstacles are ignored while phasing", () => {
    const before = makeState({
      power: active,
      ghost: inStone,
      obstacles: [obstacle()],
    });
    expect(collide(before)).toBe(before);
  });

  it("flying through the gap lives and returns the same object", () => {
    const before = makeState({
      ghost: { y: 250, vy: 0 },
      obstacles: [obstacle()],
    });
    expect(collide(before)).toBe(before);
  });

  it("does nothing outside playing", () => {
    for (const mode of ["ready", "dead"]) {
      const before = makeState({ mode, ghost: { y: -50, vy: 0 } });
      expect(collide(before)).toBe(before);
    }
  });

  it("does not mutate its argument", () => {
    const before = makeState({ ghost: inStone, obstacles: [obstacle()] });
    const copy = structuredClone(before);
    collide(before);
    expect(before).toEqual(copy);
  });
});

describe("collide.collide exit grace (R5.5, R5.6)", () => {
  const inStone = { y: 100, vy: 0 };

  it("R5.6 graced obstacle is skipped while the ghost still overlaps it", () => {
    const before = makeState({
      power: cooldown,
      graceId: 7,
      ghost: inStone,
      obstacles: [obstacle({ id: 7 })],
    });
    const s = collide(before);
    expect(s.mode).toBe("playing");
    expect(s.graceId).toBe(7);
  });

  it("R5.6 graceId is cleared once the ghost leaves the graced obstacle", () => {
    const s = collide(
      makeState({
        power: cooldown,
        graceId: 7,
        obstacles: [obstacle({ id: 7, x: 400 })],
      }),
    );
    expect(s.mode).toBe("playing");
    expect(s.graceId).toBe(null);
  });

  it("R5.6 graceId is cleared when the graced obstacle was culled", () => {
    const s = collide(
      makeState({ power: cooldown, graceId: 7, obstacles: [] }),
    );
    expect(s.graceId).toBe(null);
  });

  it("R5.6 a cleared grace does not come back: re-entering the same obstacle dies", () => {
    const o = obstacle({ id: 7 });
    const out = collide(
      makeState({
        power: cooldown,
        graceId: 7,
        ghost: { y: 250, vy: 0 },
        obstacles: [o],
      }),
    );
    expect(out.graceId).toBe(null);
    const back = collide({ ...out, ghost: inStone });
    expect(back.mode).toBe("dead");
  });

  it("R5.6 every other obstacle is live during grace", () => {
    const s = collide(
      makeState({
        power: cooldown,
        graceId: 7,
        ghost: inStone,
        obstacles: [obstacle({ id: 7 }), obstacle({ id: 8, x: GHOST_X + 10 })],
      }),
    );
    expect(s.mode).toBe("dead");
  });

  it("R5.5-R5.6 phase ends inside a gravestone: tickPower sets grace, collide lets it out", () => {
    const o = obstacle({ id: 3 });
    // Last phase tick: tickPower turns active (left 0) into cooldown and sets graceId.
    let s = makeState({
      power: { mode: "active", left: 0 },
      ghost: inStone,
      obstacles: [o],
    });
    s = collide(tickPower(s));
    expect(s.power.mode).toBe("cooldown");
    expect(s.graceId).toBe(3);
    expect(s.mode).toBe("playing");
    // The obstacle scrolls past the ghost: grace clears, still alive.
    s = collide({ ...s, obstacles: [{ ...o, x: GHOST_X - OBSTACLE_W }] });
    expect(s.graceId).toBe(null);
    expect(s.mode).toBe("playing");
  });

  it("R5.5 phase ends outside any obstacle: next overlap kills", () => {
    let s = makeState({
      power: { mode: "active", left: 0 },
      ghost: { y: 250, vy: 0 },
    });
    s = collide(tickPower(s));
    expect(s.graceId).toBe(null);
    s = collide({ ...s, ghost: inStone, obstacles: [obstacle({ id: 4 })] });
    expect(s.mode).toBe("dead");
  });
});

describe("collide properties", () => {
  const yInWorld = fc.double({ min: 0, max: GROUND_Y - GHOST_H, noNaN: true });
  const obstacles = fc.array(
    fc.record({
      x: fc.double({ min: -OBSTACLE_W, max: 480, noNaN: true }),
      gapY: fc.double({ min: 40, max: GROUND_Y - 40 - GAP_H, noNaN: true }),
      scored: fc.boolean(),
      id: fc.nat(50),
    }),
    { maxLength: 4 },
  );

  it("R5.3 PBT: while phasing and inside the world, collide never kills", () => {
    fc.assert(
      fc.property(
        yInWorld,
        obstacles,
        fc.integer({ min: 0, max: PHASE_TICKS }),
        (y, obs, left) => {
          const s = collide(
            makeState({
              power: { mode: "active", left },
              ghost: { y, vy: 0 },
              obstacles: obs,
            }),
          );
          return s.mode === "playing";
        },
      ),
    );
  });

  it("R5.4 PBT: outside the world, collide always kills whatever the power mode", () => {
    const outside = fc.oneof(
      fc.double({ min: -1000, max: -0.001, noNaN: true }),
      fc.double({ min: GROUND_Y - GHOST_H + 0.001, max: 2000, noNaN: true }),
    );
    const power = fc.constantFrom(initialPower(), active, cooldown);
    fc.assert(
      fc.property(outside, power, obstacles, (y, p, obs) => {
        return (
          collide(makeState({ power: p, ghost: { y, vy: 0 }, obstacles: obs }))
            .mode === "dead"
        );
      }),
    );
  });

  it("R1.5 PBT: not phasing, no grace: death iff edge or some obstacle hit", () => {
    fc.assert(
      fc.property(yInWorld, obstacles, (y, obs) => {
        const s = collide(makeState({ ghost: { y, vy: 0 }, obstacles: obs }));
        const expected = obs.some((o) => hits(ghostBox(y), o));
        return (s.mode === "dead") === expected;
      }),
    );
  });

  it("trigger then collide: a freshly triggered phase ignores obstacles", () => {
    const s = trigger(
      makeState({ ghost: { y: 100, vy: 0 }, obstacles: [obstacle()] }),
    );
    expect(collide(s).mode).toBe("playing");
  });
});
