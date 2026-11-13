import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { EventSchema, emptyProjections, fold, foldFrom } from "../src/index.js";
import { commandArbs, simulate } from "./sim.js";

const logs = fc
  .commands(commandArbs, { maxCommands: 60, size: "max" })
  .map((c) => simulate(c).events);

describe("fold", () => {
  it("an empty log folds to empty projections", () => {
    expect(fold([])).toEqual(emptyProjections());
  });
  it("foldFrom does not mutate its input", () => {
    fc.assert(
      fc.property(logs, (events) => {
        const half = fold(events.slice(0, events.length >> 1));
        const copy = structuredClone(half);
        foldFrom(half, events.slice(events.length >> 1));
        expect(half).toEqual(copy);
      }),
      { numRuns: 200 },
    );
  });
  it("every emitted event satisfies its schema, with seq 1..n", () => {
    fc.assert(
      fc.property(logs, (events) => {
        events.forEach((e, i) => {
          expect(EventSchema.safeParse(e).success).toBe(true);
          expect(e.seq).toBe(i + 1);
        });
      }),
      { numRuns: 300 },
    );
  });
  it("R3.2 folding the same log twice gives equal projections (P3)", () => {
    fc.assert(
      fc.property(logs, (events) => {
        expect(fold(events)).toEqual(fold(structuredClone(events)));
      }),
      { numRuns: 500 },
    );
  });
  it("R3.3 fold(a ++ b) equals foldFrom(fold(a), b) for every split (P4)", () => {
    fc.assert(
      fc.property(logs, fc.nat(), (events, n) => {
        const k = events.length === 0 ? 0 : n % (events.length + 1);
        expect(foldFrom(fold(events.slice(0, k)), events.slice(k))).toEqual(
          fold(events),
        );
      }),
      { numRuns: 500 },
    );
  });
});
