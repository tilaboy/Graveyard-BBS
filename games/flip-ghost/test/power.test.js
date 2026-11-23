import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { COOLDOWN_TICKS, GHOST_X, PHASE_TICKS } from "../src/config.js";
import { initialPower, powerLabel, tickPower, trigger } from "../src/power.js";

/** @returns {import('../src/config.js').State} */
function makeState(over = {}) {
  return {
    mode: "playing",
    tick: 0,
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

/** One tick of the power part of design §5: clear events, trigger on input, tickPower. */
function powerStep(state, input) {
  let s = { ...state, events: [] };
  if (input === "phase") s = trigger(s);
  return tickPower(s);
}

describe("power.trigger (R5.2, R5.8)", () => {
  it("R5.2 ready in playing -> active for PHASE_TICKS, emits phase-on", () => {
    const s = trigger(makeState());
    expect(s.power).toEqual({ mode: "active", left: PHASE_TICKS });
    expect(s.events).toEqual(["phase-on"]);
  });

  it("does not mutate its argument", () => {
    const before = makeState();
    const copy = structuredClone(before);
    trigger(before);
    expect(before).toEqual(copy);
  });

  it("R5.8 no-op while active or in cooldown", () => {
    for (const power of [
      { mode: "active", left: 419 },
      { mode: "cooldown", left: 719 },
    ]) {
      const s = makeState({ power });
      expect(trigger(s)).toBe(s);
    }
  });

  it("R5.2 no-op outside playing", () => {
    for (const mode of ["ready", "dead"]) {
      const s = makeState({ mode });
      expect(trigger(s)).toBe(s);
    }
  });
});

describe("power.tickPower (R5.7)", () => {
  it("ready stays ready", () => {
    const s = makeState();
    expect(tickPower(s)).toBe(s);
  });

  it("active counts down", () => {
    const s = tickPower(makeState({ power: { mode: "active", left: 10 } }));
    expect(s.power).toEqual({ mode: "active", left: 9 });
    expect(s.events).toEqual([]);
  });

  it("R5.7 active at 0 -> cooldown, emits phase-off, no grace when clear", () => {
    const s = tickPower(makeState({ power: { mode: "active", left: 0 } }));
    expect(s.power).toEqual({ mode: "cooldown", left: COOLDOWN_TICKS - 1 });
    expect(s.events).toEqual(["phase-off"]);
    expect(s.graceId).toBeNull();
  });

  it("R5.6 phase ending inside a gravestone sets graceId to that obstacle", () => {
    const obstacles = [
      { x: 400, gapY: 200, scored: false, id: 3 },
      { x: GHOST_X - 10, gapY: 200, scored: false, id: 4 },
    ];
    // ghost y 50 is above the gap (inside the top gravestone of obstacle 4)
    const s = tickPower(
      makeState({
        power: { mode: "active", left: 0 },
        obstacles,
        ghost: { y: 50, vy: 0 },
      }),
    );
    expect(s.graceId).toBe(4);
  });

  it("R5.6 ghost inside the gap is not inside the obstacle", () => {
    const obstacles = [{ x: GHOST_X - 10, gapY: 200, scored: false, id: 4 }];
    const s = tickPower(
      makeState({
        power: { mode: "active", left: 0 },
        obstacles,
        ghost: { y: 250, vy: 0 },
      }),
    );
    expect(s.graceId).toBeNull();
  });

  it("cooldown at 0 -> ready, emits power-ready", () => {
    const s = tickPower(makeState({ power: { mode: "cooldown", left: 0 } }));
    expect(s.power).toEqual({ mode: "ready", left: 0 });
    expect(s.events).toEqual(["power-ready"]);
  });

  it("R5.9 a new run starts ready", () => {
    expect(initialPower()).toEqual({ mode: "ready", left: 0 });
    expect(powerLabel(initialPower())).toBe("PHASE (P)");
  });

  it("full cycle: exactly 600 active ticks, then 1200 cooldown ticks, then ready", () => {
    let s = makeState();
    const modes = [];
    s = powerStep(s, "phase");
    modes.push(s.power.mode);
    for (let i = 0; i < 2000; i++) {
      s = powerStep(s, "none");
      modes.push(s.power.mode);
    }
    expect(modes.filter((m) => m === "active")).toHaveLength(PHASE_TICKS);
    expect(modes.filter((m) => m === "cooldown")).toHaveLength(COOLDOWN_TICKS);
    expect(modes[PHASE_TICKS + COOLDOWN_TICKS]).toBe("ready");
  });
});

describe("power.powerLabel (R5.8)", () => {
  it("labels", () => {
    expect(powerLabel({ mode: "ready", left: 0 })).toBe("PHASE (P)");
    expect(powerLabel({ mode: "active", left: 419 })).toBe("PHASING 7s");
    expect(powerLabel({ mode: "cooldown", left: 719 })).toBe("COOLDOWN 12s");
  });

  it("first and last tick of each mode", () => {
    expect(powerLabel({ mode: "active", left: PHASE_TICKS - 1 })).toBe(
      "PHASING 10s",
    );
    expect(powerLabel({ mode: "active", left: 0 })).toBe("PHASING 1s");
    expect(powerLabel({ mode: "cooldown", left: COOLDOWN_TICKS - 1 })).toBe(
      "COOLDOWN 20s",
    );
    expect(powerLabel({ mode: "cooldown", left: 0 })).toBe("COOLDOWN 1s");
  });
});

describe("power properties", () => {
  it("R5.10 superpower moves only ready -> active -> cooldown -> ready with exact durations", () => {
    const next = { ready: "active", active: "cooldown", cooldown: "ready" };
    fc.assert(
      fc.property(
        fc.array(fc.constantFrom("flip", "phase", "none"), {
          minLength: 1800,
          maxLength: 3000,
        }),
        (tape) => {
          let s = makeState();
          let prev = s.power.mode;
          let run = 0;
          for (const input of tape) {
            s = powerStep(s, input);
            const mode = s.power.mode;
            if (mode === prev) {
              run += 1;
              continue;
            }
            expect(mode).toBe(next[prev]);
            if (prev === "active") expect(run).toBe(PHASE_TICKS);
            if (prev === "cooldown") expect(run).toBe(COOLDOWN_TICKS);
            prev = mode;
            run = 1;
          }
          // a mode still in progress never exceeds its length
          if (prev === "active") expect(run).toBeLessThanOrEqual(PHASE_TICKS);
          if (prev === "cooldown")
            expect(run).toBeLessThanOrEqual(COOLDOWN_TICKS);
        },
      ),
      { numRuns: 200 },
    );
  });
});
