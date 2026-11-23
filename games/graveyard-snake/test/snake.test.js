import { describe, it, expect } from "vitest";
import fc from "fast-check";
import {
  COLS,
  ROWS,
  START_CELLS,
  START_DIR,
  TURN_BUFFER,
} from "../src/config.js";
import { queueTurn, nextHead, advance, hitsSelf } from "../src/snake.js";

/** @typedef {import("../src/config.js").Cell} Cell */
/** @typedef {import("../src/config.js").Dir} Dir */

const OPP = { up: "down", down: "up", left: "right", right: "left" };
/** @type {fc.Arbitrary<Dir>} */
const dirArb = fc.constantFrom("up", "down", "left", "right");
/** One tape entry: up to 3 turn presses, then a move that may eat (grow 0..3). */
const stepArb = fc.record({
  presses: fc.array(dirArb, { maxLength: 3 }),
  eat: fc.integer({ min: 0, max: 3 }),
});
const tapeArb = fc.array(stepArb, { maxLength: 3000, size: "max" });

const start = () => START_CELLS.map(([x, y]) => ({ x, y }));
const inGrid = (/** @type {Cell} */ c) =>
  c.x >= 0 && c.y >= 0 && c.x < COLS && c.y < ROWS;

/**
 * Drive the snake with a tape like sim.js will: buffer presses, apply one turn per move,
 * end on wall or self. Calls `check` after every live move.
 * @param {Array<{presses: Dir[], eat: number}>} tape
 * @param {(s: {snake: Cell[], dir: Dir, prev: Dir}) => void} check
 */
function run(tape, check) {
  let snake = start();
  /** @type {Dir} */
  let dir = START_DIR;
  /** @type {Dir[]} */
  let turns = [];
  let grow = 0;
  for (const { presses, eat } of tape) {
    for (const p of presses) turns = queueTurn(turns, p, dir);
    expect(turns.length).toBeLessThanOrEqual(TURN_BUFFER);
    const prev = dir;
    if (turns.length > 0) {
      dir = turns[0];
      turns = turns.slice(1);
    }
    const head = nextHead(snake, dir);
    if (!inGrid(head) || hitsSelf(snake, head, grow)) return;
    ({ snake, grow } = advance(snake, head, grow));
    // Eating adds growth after the move, as sim.js does (R3.3).
    grow += eat;
    check({ snake, dir, prev });
  }
}

describe("queueTurn (design §6, R2.4, R2.5)", () => {
  it("queues a perpendicular turn", () => {
    expect(queueTurn([], "up", "right")).toEqual(["up"]);
  });
  it("drops a reverse of the current direction", () => {
    expect(queueTurn([], "left", "right")).toEqual([]);
  });
  it("drops a repeat of the current direction", () => {
    expect(queueTurn([], "right", "right")).toEqual([]);
  });
  it("compares against the last queued turn, not the current direction", () => {
    expect(queueTurn(["up"], "left", "right")).toEqual(["up", "left"]);
    expect(queueTurn(["up"], "down", "right")).toEqual(["up"]);
    expect(queueTurn(["up"], "up", "right")).toEqual(["up"]);
  });
  it("buffers at most 2 turns", () => {
    expect(queueTurn(["up", "left"], "down", "right")).toEqual(["up", "left"]);
  });
  it("does not mutate the input buffer", () => {
    const turns = Object.freeze(["up"]);
    queueTurn(turns, "left", "right");
    expect(turns).toEqual(["up"]);
  });
});

describe("nextHead and advance (R2.2, R2.3)", () => {
  it("moves one cell in each direction", () => {
    const s = start();
    expect(nextHead(s, "right")).toEqual({ x: 13, y: 12 });
    expect(nextHead(s, "left")).toEqual({ x: 11, y: 12 });
    expect(nextHead(s, "up")).toEqual({ x: 12, y: 11 });
    expect(nextHead(s, "down")).toEqual({ x: 12, y: 13 });
  });
  it("drops the tail with no pending growth", () => {
    const r = advance(start(), { x: 13, y: 12 }, 0);
    expect(r).toEqual({
      snake: [
        { x: 13, y: 12 },
        { x: 12, y: 12 },
        { x: 11, y: 12 },
      ],
      grow: 0,
    });
  });
  it("keeps the tail and spends 1 growth", () => {
    const r = advance(start(), { x: 13, y: 12 }, 2);
    expect(r.snake).toHaveLength(4);
    expect(r.snake[3]).toEqual({ x: 10, y: 12 });
    expect(r.grow).toBe(1);
  });
  it("does not mutate the input snake", () => {
    const s = start();
    advance(s, { x: 13, y: 12 }, 0);
    expect(s).toEqual(start());
  });
});

describe("hitsSelf (R2.7)", () => {
  // A 2x2 loop: head (1,0), body (0,0), (0,1), tail (1,1).
  const loop = [
    { x: 1, y: 0 },
    { x: 0, y: 0 },
    { x: 0, y: 1 },
    { x: 1, y: 1 },
  ];
  it("R2.7 tail-chasing is legal when the tail moves away", () => {
    expect(hitsSelf(loop, { x: 1, y: 1 }, 0)).toBe(false);
  });
  it("hits the tail when growth keeps it in place", () => {
    expect(hitsSelf(loop, { x: 1, y: 1 }, 1)).toBe(true);
  });
  it("hits a body cell", () => {
    expect(hitsSelf(loop, { x: 0, y: 0 }, 0)).toBe(true);
  });
  it("a free cell is no hit", () => {
    expect(hitsSelf(loop, { x: 2, y: 0 }, 0)).toBe(false);
  });
});

describe("snake properties (PBT)", () => {
  it("R2.4 no reverse turn is ever applied", () => {
    fc.assert(
      fc.property(tapeArb, (tape) => {
        run(tape, ({ dir, prev }) => {
          expect(dir).not.toBe(OPP[prev]);
        });
      }),
      { numRuns: 200 },
    );
  });

  it("R2.8 snake cells stay distinct and 4-adjacent", () => {
    fc.assert(
      fc.property(tapeArb, (tape) => {
        run(tape, ({ snake }) => {
          const keys = new Set(snake.map((c) => `${c.x},${c.y}`));
          expect(keys.size).toBe(snake.length);
          for (let i = 1; i < snake.length; i++) {
            const d =
              Math.abs(snake[i].x - snake[i - 1].x) +
              Math.abs(snake[i].y - snake[i - 1].y);
            expect(d).toBe(1);
          }
          for (const c of snake) expect(inGrid(c)).toBe(true);
        });
      }),
      { numRuns: 200 },
    );
  });
});
