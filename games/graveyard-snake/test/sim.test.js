import { describe, it, expect, vi } from "vitest";
import fc from "fast-check";
import {
  COLS,
  ROWS,
  CREATURES,
  MAX_SPIDERS,
  MIN_STEP_TICKS,
  START_STEP_TICKS,
} from "../src/config.js";
import { hazardSet, key } from "../src/grid.js";
import { nextHead } from "../src/snake.js";
import { initialState, step } from "../src/sim.js";

// src/spawn.js belongs to task 4, which runs in parallel in this worktree. Use the real
// module once it is implemented; until then fall back to a double that keeps the design §7
// contract (free-cell creature pick, r then 50 centre tries for spiders).
vi.mock("../src/spawn.js", async (importOriginal) => {
  /** @type {typeof import("../src/spawn.js")} */
  const real = await importOriginal();
  let live = true;
  try {
    real.spawnCreature(1, [{ x: 0, y: 0 }], []);
  } catch (err) {
    if (!String(err).includes("not implemented")) throw err;
    live = false;
  }
  if (live) return real;

  const { COLS, ROWS, CREATURES, HEAD_SAFE_DIST, SPAWN_TRIES } =
    await import("../src/config.js");
  const { randInt, pickWeighted } = await import("../src/rng.js");
  const { cheb, hazardSet, key, webCells } = await import("../src/grid.js");
  const KIND_ENTRIES = Object.entries(CREATURES).map(([k, v]) => [k, v.weight]);
  return {
    spawnCreature(rng, snake, spiders) {
      const blocked = hazardSet(spiders);
      for (const c of snake) blocked.add(key(c));
      const free = [];
      for (let y = 0; y < ROWS; y += 1)
        for (let x = 0; x < COLS; x += 1)
          if (!blocked.has(key({ x, y }))) free.push({ x, y });
      if (free.length === 0) return [null, rng];
      const [kind, w1] = pickWeighted(rng, KIND_ENTRIES);
      const [i, w2] = randInt(w1, 0, free.length - 1);
      return [{ kind, at: free[i] }, w2];
    },
    spawnSpider(rng, snake, creature, spiders) {
      let [r, w] = randInt(rng, 1, 3);
      const blocked = hazardSet(spiders);
      for (const c of snake) blocked.add(key(c));
      if (creature) blocked.add(key(creature.at));
      for (let t = 0; t < SPAWN_TRIES; t += 1) {
        let x, y;
        [x, w] = randInt(w, r, COLS - 1 - r);
        [y, w] = randInt(w, r, ROWS - 1 - r);
        const spider = { at: { x, y }, r };
        const ok = webCells(spider).every(
          (c) => !blocked.has(key(c)) && cheb(c, snake[0]) > HEAD_SAFE_DIST,
        );
        if (ok) return [spider, w];
      }
      return [null, w];
    },
  };
});

/** @typedef {import("../src/config.js").State} State */
/** @typedef {import("../src/config.js").Input} Input */
/** @typedef {import("../src/config.js").Dir} Dir */

/** @type {fc.Arbitrary<Input>} */
const inputArb = fc.oneof(
  { weight: 12, arbitrary: fc.constant({}) },
  {
    weight: 4,
    arbitrary: fc.record({
      turn: fc.constantFrom("up", "down", "left", "right"),
    }),
  },
  { weight: 1, arbitrary: fc.constant({ pause: true }) },
);
const tapeArb = fc.array(inputArb, { maxLength: 3000, size: "max" });
const seedArb = fc.integer({ min: 0, max: 0xffffffff });

/** @param {State} s */
const totalEaten = (s) => s.eaten.ghost + s.eaten.skeleton + s.eaten.dinosaur;

/**
 * Start a run from `seed` and play `tape`, calling `check(prev, next)` after every tick.
 * @param {number} seed
 * @param {Input[]} tape
 * @param {(prev: State, next: State) => void} check
 */
function play(seed, tape, check) {
  let s = step(initialState(seed), { start: true });
  for (const input of tape) {
    const n = step(s, input);
    check(s, n);
    s = n;
    if (s.phase === "over") break;
  }
  return s;
}

/** @param {unknown} o */
function deepFreeze(o) {
  if (o && typeof o === "object") {
    Object.freeze(o);
    for (const v of Object.values(o)) deepFreeze(v);
  }
  return o;
}

/**
 * A play state with the head at (12,12) heading right and nothing else on the grid.
 * @param {Partial<State>} over
 * @returns {State}
 */
function playState(over = {}) {
  return {
    ...initialState(7),
    phase: "play",
    sinceMove: START_STEP_TICKS - 1,
    creature: { kind: "ghost", at: { x: 0, y: 0 } },
    ...over,
  };
}

describe("sim initialState", () => {
  it("R2.1 R1.3 title state: 3 cells head first heading right, 8 ticks per move", () => {
    const s = initialState(42);
    expect(s).toEqual({
      phase: "title",
      tick: 0,
      sinceMove: 0,
      stepTicks: 8,
      rng: 42,
      snake: [
        { x: 12, y: 12 },
        { x: 11, y: 12 },
        { x: 10, y: 12 },
      ],
      dir: "right",
      turns: [],
      grow: 0,
      creature: null,
      spiders: [],
      score: 0,
      eaten: { ghost: 0, skeleton: 0, dinosaur: 0 },
      end: null,
    });
    expect(JSON.parse(JSON.stringify(s))).toEqual(s);
  });

  it("title ignores everything but start", () => {
    const s = initialState(1);
    expect(step(s, {})).toEqual(s);
    expect(step(s, { turn: "up" })).toEqual(s);
    expect(step(s, { pause: true })).toEqual(s);
  });

  it("R4.1 R3.1 start places 2 spiders then one creature off every web", () => {
    for (let seed = 0; seed < 50; seed += 1) {
      const s = step(initialState(seed), { start: true });
      expect(s.phase).toBe("play");
      expect(s.spiders).toHaveLength(2);
      expect(s.creature).not.toBeNull();
      expect(hazardSet(s.spiders).has(key(s.creature.at))).toBe(false);
    }
  });
});

describe("sim step", () => {
  it("R1.6 step does not mutate its argument", () => {
    const s = deepFreeze(step(initialState(3), { start: true }));
    let n = s;
    for (let i = 0; i < 40; i += 1) n = step(n, i === 1 ? { turn: "up" } : {});
    expect(n.tick).toBe(40);
  });

  it("R1.3 R2.2 the snake moves once every 8 ticks", () => {
    let s = playState({ sinceMove: 0 });
    for (let i = 0; i < 7; i += 1) {
      s = step(s, {});
      expect(s.snake[0]).toEqual({ x: 12, y: 12 });
    }
    s = step(s, {});
    expect(s.snake[0]).toEqual({ x: 13, y: 12 });
    expect(s.snake).toHaveLength(3);
    expect(s.sinceMove).toBe(0);
    expect(s.tick).toBe(8);
  });

  it("R6.3 pause freezes the run and pause again resumes it", () => {
    const s = playState();
    const p = step(s, { pause: true });
    expect(p.phase).toBe("paused");
    expect(step(p, {})).toEqual(p);
    expect(step(p, { turn: "up" })).toEqual(p);
    const r = step(p, { pause: true });
    expect(r).toEqual({ ...s, phase: "play" });
  });

  it("R2.5 one buffered turn is applied per move", () => {
    let s = playState({ sinceMove: 0 });
    s = step(s, { turn: "up" });
    s = step(s, { turn: "left" });
    expect(s.turns).toEqual(["up", "left"]);
    for (let i = 0; i < 6; i += 1) s = step(s, {});
    expect(s.dir).toBe("up");
    expect(s.snake[0]).toEqual({ x: 12, y: 11 });
    expect(s.turns).toEqual(["left"]);
  });

  it("R2.6 leaving the grid ends the run with reason wall", () => {
    const s = playState({
      snake: [
        { x: 23, y: 5 },
        { x: 22, y: 5 },
        { x: 21, y: 5 },
      ],
    });
    const n = step(s, {});
    expect(n.phase).toBe("over");
    expect(n.end).toBe("wall");
    expect(n.snake).toEqual(s.snake);
    expect(step(n, { turn: "up" })).toEqual(n);
  });

  it("R5.1 entering a web ends the run with reason web, no growth, no score", () => {
    const s = playState({
      spiders: [{ at: { x: 15, y: 12 }, r: 2 }],
      creature: { kind: "dinosaur", at: { x: 13, y: 12 } },
    });
    const n = step(s, {});
    expect(n.end).toBe("web");
    expect(n.phase).toBe("over");
    expect(n.snake).toEqual(s.snake);
    expect(n.score).toBe(0);
    expect(n.grow).toBe(0);
  });

  it("R2.7 biting the body ends with reason self; chasing the tail is legal", () => {
    const loop = [
      { x: 12, y: 12 },
      { x: 12, y: 13 },
      { x: 13, y: 13 },
      { x: 13, y: 12 },
    ];
    const tail = step(playState({ snake: loop, dir: "right" }), {});
    expect(tail.phase).toBe("play");
    expect(tail.snake[0]).toEqual({ x: 13, y: 12 });
    const bite = step(playState({ snake: loop, dir: "right", grow: 1 }), {});
    expect(bite.end).toBe("self");
  });

  it("R5.3 wall beats web, web beats self", () => {
    const edge = playState({
      snake: [
        { x: 23, y: 3 },
        { x: 22, y: 3 },
        { x: 21, y: 3 },
      ],
      spiders: [{ at: { x: 21, y: 3 }, r: 2 }],
    });
    expect(step(edge, {}).end).toBe("wall");
    const loop = [
      { x: 12, y: 12 },
      { x: 12, y: 13 },
      { x: 13, y: 13 },
      { x: 13, y: 12 },
    ];
    const both = playState({
      snake: loop,
      grow: 1,
      spiders: [{ at: { x: 15, y: 12 }, r: 2 }],
    });
    expect(step(both, {}).end).toBe("web");
  });

  it("R3.3 R3.4 eating adds points and growth and spawns the next creature", () => {
    for (const kind of /** @type {const} */ ([
      "ghost",
      "skeleton",
      "dinosaur",
    ])) {
      const s = playState({ creature: { kind, at: { x: 13, y: 12 } } });
      const n = step(s, {});
      expect(n.score).toBe(CREATURES[kind].points);
      expect(n.grow).toBe(CREATURES[kind].growth);
      expect(n.eaten[kind]).toBe(1);
      expect(n.snake).toHaveLength(3);
      expect(n.creature).not.toBeNull();
      expect(n.creature.at).not.toEqual({ x: 13, y: 12 });
      expect(n.phase).toBe("play");
    }
  });

  it("R1.4 every 10th creature lowers stepTicks by 1, floor 4", () => {
    const eat = (stepTicks, ghost) =>
      step(
        playState({
          stepTicks,
          sinceMove: stepTicks - 1,
          eaten: { ghost, skeleton: 0, dinosaur: 0 },
          creature: { kind: "ghost", at: { x: 13, y: 12 } },
        }),
        {},
      ).stepTicks;
    expect(eat(8, 9)).toBe(7);
    expect(eat(8, 10)).toBe(8);
    expect(eat(5, 19)).toBe(4);
    expect(eat(MIN_STEP_TICKS, 29)).toBe(MIN_STEP_TICKS);
  });

  it("R4.2 every 3rd creature adds a spider while fewer than 6", () => {
    const eat = (ghost, spiders) =>
      step(
        playState({
          eaten: { ghost, skeleton: 0, dinosaur: 0 },
          creature: { kind: "ghost", at: { x: 13, y: 12 } },
          spiders,
        }),
        {},
      ).spiders.length;
    expect(eat(1, [])).toBe(0);
    expect(eat(2, [])).toBe(1);
    const six = [
      { at: { x: 1, y: 1 }, r: 1 },
      { at: { x: 5, y: 1 }, r: 1 },
      { at: { x: 9, y: 1 }, r: 1 },
      { at: { x: 13, y: 1 }, r: 1 },
      { at: { x: 17, y: 1 }, r: 1 },
      { at: { x: 21, y: 1 }, r: 1 },
    ];
    expect(eat(5, six)).toBe(MAX_SPIDERS);
  });

  it("R3.7 no free cell for the next creature ends the run with reason full", () => {
    // Serpentine path over the whole grid; the creature is on path[0], the head on path[1].
    const path = [];
    for (let y = 0; y < ROWS; y += 1)
      for (let i = 0; i < COLS; i += 1)
        path.push({ x: y % 2 === 0 ? i : COLS - 1 - i, y });
    const s = playState({
      snake: path.slice(1),
      dir: "left",
      grow: 1,
      creature: { kind: "ghost", at: path[0] },
    });
    const n = step(s, {});
    expect(n.snake).toHaveLength(COLS * ROWS);
    expect(n.phase).toBe("over");
    expect(n.end).toBe("full");
    expect(n.creature).toBeNull();
    expect(n.score).toBe(1);
  });
});

describe("sim properties", () => {
  it("R1.5 same seed and same input tape give equal states after every tick", () => {
    fc.assert(
      fc.property(seedArb, tapeArb, (seed, tape) => {
        const a = [];
        play(seed, tape, (_, n) => a.push(n));
        let i = 0;
        play(seed, tape, (_, n) => {
          expect(n).toEqual(a[i]);
          i += 1;
        });
        expect(i).toBe(a.length);
      }),
      { numRuns: 40 },
    );
  });

  it("R3.6 score and length plus growth always match the creatures eaten", () => {
    fc.assert(
      fc.property(seedArb, tapeArb, (seed, tape) => {
        play(seed, tape, (_, n) => {
          let points = 0;
          let growth = 0;
          for (const [kind, count] of Object.entries(n.eaten)) {
            points += CREATURES[kind].points * count;
            growth += CREATURES[kind].growth * count;
          }
          expect(n.score).toBe(points);
          expect(n.snake.length + n.grow).toBe(3 + growth);
        });
      }),
      { numRuns: 60 },
    );
  });

  it("R5.1 a move into a spider or web cell ends web with no growth or score", () => {
    let caught = 0;
    fc.assert(
      fc.property(seedArb, tapeArb, (seed, tape) => {
        play(seed, tape, (p, n) => {
          if (n.phase === "over" && n.end !== "full" && p.phase === "play") {
            const head = nextHead(p.snake, n.dir);
            const inWeb = hazardSet(p.spiders).has(key(head));
            const inGrid =
              head.x >= 0 && head.y >= 0 && head.x < COLS && head.y < ROWS;
            if (inGrid && inWeb) {
              caught += 1;
              expect(n.end).toBe("web");
              expect(n.snake).toEqual(p.snake);
              expect(n.score).toBe(p.score);
              expect(n.grow).toBe(p.grow);
            } else {
              expect(n.end).not.toBe("web");
            }
          }
        });
      }),
      { numRuns: 80 },
    );
    expect(caught).toBeGreaterThan(0);
  });

  it("R5.4 while the run lives the head is never on a spider or web cell", () => {
    fc.assert(
      fc.property(seedArb, tapeArb, (seed, tape) => {
        play(seed, tape, (_, n) => {
          if (n.phase !== "over") {
            expect(hazardSet(n.spiders).has(key(n.snake[0]))).toBe(false);
          }
        });
      }),
      { numRuns: 60 },
    );
  });

  it("R1.4 R4.2 R4.7 stepTicks follows the eaten count; spiders never move", () => {
    fc.assert(
      fc.property(seedArb, tapeArb, (seed, tape) => {
        play(seed, tape, (p, n) => {
          const total = totalEaten(n);
          expect(n.stepTicks).toBe(
            Math.max(MIN_STEP_TICKS, START_STEP_TICKS - Math.floor(total / 10)),
          );
          expect(n.spiders.length).toBeLessThanOrEqual(MAX_SPIDERS);
          expect(n.spiders.slice(0, p.spiders.length)).toEqual(p.spiders);
        });
      }),
      { numRuns: 40 },
    );
  });
});
