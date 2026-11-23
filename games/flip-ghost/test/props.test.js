import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { GHOST_H, GROUND_Y } from "../src/config.js";
import { ghostBox, hits } from "../src/collide.js";
import { runTape } from "./helpers.js";

/** @typedef {import('../src/config.js').State} State */

const seed = fc.integer();

// Design §11 tape: one input per tick. The uniform tape flips so often that most runs end
// at the ceiling, so a second tape with rare flips keeps runs alive long enough to reach
// obstacles, phase through them and restart.
// fast-check's default size keeps arrays near 10 cells; `size: 'max'` lets tapes reach the
// full 3000 ticks (50 s of play).
const uniformTape = fc.array(fc.constantFrom("flip", "phase", "none"), {
  maxLength: 3000,
  size: "max",
});
const sparseTape = fc.array(
  fc.oneof(
    { arbitrary: fc.constant("none"), weight: 14 },
    { arbitrary: fc.constant("flip"), weight: 2 },
    { arbitrary: fc.constant("phase"), weight: 1 },
  ),
  { maxLength: 3000, size: "max" },
);
const tape = fc.oneof(uniformTape, sparseTape);

/** A new run starts when `dead` steps into `ready`. */
function restarted(prev, next) {
  return prev.mode === "dead" && next.mode === "ready";
}

describe("simulation properties", () => {
  it("R1.7 same seed and same inputs give the same state after every tick", () => {
    fc.assert(
      fc.property(seed, tape, (s, t) => {
        expect(runTape(s, t)).toEqual(runTape(s, t));
      }),
      { numRuns: 50 },
    );
  });

  it("R4.5 score never decreases in a run and never exceeds obstacles spawned", () => {
    fc.assert(
      fc.property(seed, tape, (s, t) => {
        const states = runTape(s, t);
        for (let i = 0; i < states.length; i++) {
          const cur = states[i];
          expect(cur.score).toBeLessThanOrEqual(cur.nextId);
          if (i === 0) continue;
          const prev = states[i - 1];
          if (restarted(prev, cur)) expect(cur.score).toBe(0);
          else expect(cur.score).toBeGreaterThanOrEqual(prev.score);
        }
      }),
      { numRuns: 100 },
    );
  });

  it("R5.11 no obstacle death while phasing", () => {
    fc.assert(
      fc.property(seed, tape, (s, t) => {
        const states = runTape(s, t);
        for (let i = 1; i < states.length; i++) {
          const prev = states[i - 1];
          const cur = states[i];
          if (prev.mode !== "playing" || cur.mode !== "dead") continue;
          if (cur.power.mode !== "active") continue;
          // The only legal deaths while active are the ceiling and the ground (R5.4).
          const atEdge = cur.ghost.y < 0 || cur.ghost.y + GHOST_H > GROUND_Y;
          expect(atEdge).toBe(true);
        }
      }),
      { numRuns: 100 },
    );
  });

  it("R5.11 a phasing ghost does pass through gravestones on some runs", () => {
    // Guards R5.11 against passing vacuously: find a phasing tick spent inside a gravestone.
    // A flip every 33 ticks (about 2 * |FLIP_VY| / GRAVITY) keeps the ghost roughly level.
    let found = false;
    for (let s = 0; s < 200 && !found; s++) {
      const t = Array.from({ length: 900 }, (_, i) =>
        i === 0 ? "flip" : i === 1 ? "phase" : i % 33 === 0 ? "flip" : "none",
      );
      found = runTape(s, t).some(
        (st) =>
          st.mode === "playing" &&
          st.power.mode === "active" &&
          st.obstacles.some((o) => hits(ghostBox(st.ghost.y), o)),
      );
    }
    expect(found).toBe(true);
  });
});
