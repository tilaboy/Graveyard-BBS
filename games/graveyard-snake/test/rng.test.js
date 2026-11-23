import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { seedWord, next, randInt, pickWeighted } from "../src/rng.js";

const word = fc.integer({ min: 0, max: 0xffffffff });

describe("rng (design §4)", () => {
  it("seedWord normalises to an unsigned 32-bit integer", () => {
    expect(seedWord(-1)).toBe(0xffffffff);
    expect(seedWord(2 ** 32 + 5)).toBe(5);
    expect(seedWord(3.9)).toBe(3);
    expect(seedWord(Number.NaN)).toBe(0);
  });

  it("next returns a value in [0, 1) and a uint32 word", () => {
    fc.assert(
      fc.property(word, (w) => {
        const [v, n] = next(w);
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThan(1);
        expect(n >>> 0).toBe(n);
      }),
    );
  });

  it("R1.5 same word gives the same sequence", () => {
    fc.assert(
      fc.property(word, fc.integer({ min: 1, max: 50 }), (w, len) => {
        /** @param {number} s */
        const run = (s) => {
          const out = [];
          for (let i = 0; i < len; i += 1) {
            const [v, n] = next(s);
            out.push(v);
            s = n;
          }
          return out;
        };
        expect(run(w)).toEqual(run(w));
      }),
    );
  });

  it("randInt stays in [lo, hi]", () => {
    fc.assert(
      fc.property(
        word,
        fc.integer({ min: -100, max: 100 }),
        fc.integer({ min: 0, max: 100 }),
        (w, lo, span) => {
          const [v] = randInt(w, lo, lo + span);
          expect(Number.isInteger(v)).toBe(true);
          expect(v).toBeGreaterThanOrEqual(lo);
          expect(v).toBeLessThanOrEqual(lo + span);
        },
      ),
    );
  });

  it("randInt with lo === hi always returns lo", () => {
    fc.assert(
      fc.property(word, (w) => {
        expect(randInt(w, 7, 7)[0]).toBe(7);
      }),
    );
  });

  it("pickWeighted returns a listed key and is deterministic", () => {
    /** @type {Array<[string, number]>} */
    const entries = [
      ["ghost", 60],
      ["skeleton", 30],
      ["dinosaur", 10],
    ];
    fc.assert(
      fc.property(word, (w) => {
        const [k, n] = pickWeighted(w, entries);
        expect(["ghost", "skeleton", "dinosaur"]).toContain(k);
        expect(pickWeighted(w, entries)).toEqual([k, n]);
      }),
    );
  });

  it("pickWeighted frequencies follow the weights within 5 % over 10 000 draws", () => {
    /** @type {Array<[string, number]>} */
    const entries = [
      ["ghost", 60],
      ["skeleton", 30],
      ["dinosaur", 10],
    ];
    /** @type {Record<string, number>} */
    const counts = { ghost: 0, skeleton: 0, dinosaur: 0 };
    let w = seedWord(12345);
    for (let i = 0; i < 10000; i += 1) {
      const [k, n] = pickWeighted(w, entries);
      counts[k] += 1;
      w = n;
    }
    expect(Math.abs(counts.ghost / 10000 - 0.6)).toBeLessThan(0.05);
    expect(Math.abs(counts.skeleton / 10000 - 0.3)).toBeLessThan(0.05);
    expect(Math.abs(counts.dinosaur / 10000 - 0.1)).toBeLessThan(0.05);
  });

  it("pickWeighted refuses an empty list", () => {
    expect(() => pickWeighted(1, [])).toThrow();
  });
});
