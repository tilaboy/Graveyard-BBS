import { describe, it, expect } from "vitest";
import fc from "fast-check";
import {
  COLS,
  ROWS,
  START_CELLS,
  SPAWN_TRIES,
  HEAD_SAFE_DIST,
} from "../src/config.js";
import {
  key,
  cheb,
  webCells,
  hazardSet,
  fitsGrid,
  inBounds,
} from "../src/grid.js";
import { randInt } from "../src/rng.js";
import { spawnCreature, spawnSpider } from "../src/spawn.js";

const word = fc.integer({ min: 0, max: 0xffffffff });
const cellArb = fc.record({
  x: fc.integer({ min: 0, max: COLS - 1 }),
  y: fc.integer({ min: 0, max: ROWS - 1 }),
});
const snakeArb = fc.uniqueArray(cellArb, {
  minLength: 1,
  maxLength: 40,
  selector: key,
});

/** Build a world the way the sim does: spiders first, each placed by spawnSpider. */
const worldArb = fc
  .record({ seed: word, snake: snakeArb, n: fc.integer({ min: 0, max: 6 }) })
  .map(({ seed, snake, n }) => {
    let rng = seed;
    const spiders = [];
    for (let i = 0; i < n; i += 1) {
      const [spider, next] = spawnSpider(rng, snake, null, spiders);
      rng = next;
      if (spider) spiders.push(spider);
    }
    return { rng, snake, spiders };
  });

const startSnake = START_CELLS.map(([x, y]) => ({ x, y }));

describe("spawnCreature (design §7)", () => {
  it("R3.5 a creature never spawns on a snake, spider or web cell", () => {
    fc.assert(
      fc.property(worldArb, ({ rng, snake, spiders }) => {
        const [creature] = spawnCreature(rng, snake, spiders);
        if (creature === null) return;
        expect(inBounds(creature.at)).toBe(true);
        const blocked = hazardSet(spiders);
        for (const cell of snake) blocked.add(key(cell));
        expect(blocked.has(key(creature.at))).toBe(false);
      }),
      { numRuns: 300 },
    );
  });

  it("R3.7 returns null when no free cell is left", () => {
    const snake = [];
    for (let y = 0; y < ROWS; y += 1)
      for (let x = 0; x < COLS; x += 1) snake.push({ x, y });
    const [creature, next] = spawnCreature(7, snake, []);
    expect(creature).toBeNull();
    expect(next).not.toBe(7);
  });

  it("R3.7 the single free cell is always picked", () => {
    const snake = [];
    for (let y = 0; y < ROWS; y += 1)
      for (let x = 0; x < COLS; x += 1)
        if (!(x === 5 && y === 9)) snake.push({ x, y });
    fc.assert(
      fc.property(word, (seed) => {
        const [creature] = spawnCreature(seed, snake, []);
        expect(creature?.at).toEqual({ x: 5, y: 9 });
      }),
    );
  });

  it("is deterministic for the same word", () => {
    fc.assert(
      fc.property(worldArb, ({ rng, snake, spiders }) => {
        expect(spawnCreature(rng, snake, spiders)).toEqual(
          spawnCreature(rng, snake, spiders),
        );
      }),
      { numRuns: 100 },
    );
  });

  it("R3.2 kind frequencies are within 5 % of 60/30/10 over 10 000 draws", () => {
    const counts = { ghost: 0, skeleton: 0, dinosaur: 0 };
    let rng = 12345;
    const n = 10000;
    for (let i = 0; i < n; i += 1) {
      const [creature, next] = spawnCreature(rng, startSnake, []);
      rng = next;
      if (creature) counts[creature.kind] += 1;
    }
    expect(Math.abs(counts.ghost / n - 0.6)).toBeLessThan(0.05);
    expect(Math.abs(counts.skeleton / n - 0.3)).toBeLessThan(0.05);
    expect(Math.abs(counts.dinosaur / n - 0.1)).toBeLessThan(0.05);
  });
});

describe("spawnSpider (design §7)", () => {
  it("R4.3 web radius is always in [1, 3] and drawn uniformly", () => {
    fc.assert(
      fc.property(word, snakeArb, (seed, snake) => {
        const [spider] = spawnSpider(seed, snake, null, []);
        const [r] = randInt(seed, 1, 3);
        if (spider !== null) {
          expect([1, 2, 3]).toContain(spider.r);
          expect(spider.r).toBe(r);
        }
      }),
      { numRuns: 300 },
    );
    const counts = { 1: 0, 2: 0, 3: 0 };
    let rng = 99;
    for (let i = 0; i < 3000; i += 1) {
      const [spider, next] = spawnSpider(rng, startSnake, null, []);
      rng = next;
      if (spider) counts[spider.r] += 1;
    }
    const total = counts[1] + counts[2] + counts[3];
    for (const r of [1, 2, 3])
      expect(Math.abs(counts[r] / total - 1 / 3)).toBeLessThan(0.05);
  });

  it("R4.4 a web always lies fully inside the grid", () => {
    fc.assert(
      fc.property(worldArb, ({ spiders }) => {
        for (const spider of spiders) {
          expect(fitsGrid(spider)).toBe(true);
          for (const cell of webCells(spider))
            expect(inBounds(cell)).toBe(true);
        }
      }),
      { numRuns: 300 },
    );
  });

  it("R4.5 a new web is clear of snake, creature, other webs and head distance > 3", () => {
    fc.assert(
      fc.property(worldArb, cellArb, ({ rng, snake, spiders }, creatureAt) => {
        const creature = {
          kind: /** @type {const} */ ("ghost"),
          at: creatureAt,
        };
        const [spider] = spawnSpider(rng, snake, creature, spiders);
        if (spider === null) return;
        const snakeKeys = new Set(snake.map(key));
        const others = hazardSet(spiders);
        for (const cell of webCells(spider)) {
          expect(snakeKeys.has(key(cell))).toBe(false);
          expect(key(cell)).not.toBe(key(creatureAt));
          expect(others.has(key(cell))).toBe(false);
          expect(cheb(cell, snake[0])).toBeGreaterThan(HEAD_SAFE_DIST);
        }
      }),
      { numRuns: 300 },
    );
  });

  it("R4.6 returns null after 50 failed tries with a fixed number of draws", () => {
    // The snake covers every cell, so no try can be legal.
    const snake = [];
    for (let y = 0; y < ROWS; y += 1)
      for (let x = 0; x < COLS; x += 1) snake.push({ x, y });
    fc.assert(
      fc.property(word, (seed) => {
        const [spider, next] = spawnSpider(seed, snake, null, []);
        expect(spider).toBeNull();
        // 1 radius draw + 2 draws per try.
        let expected = seed;
        for (let i = 0; i < 1 + 2 * SPAWN_TRIES; i += 1)
          expected = randInt(expected, 0, 1)[1];
        expect(next).toBe(expected);
      }),
      { numRuns: 50 },
    );
  });

  it("places a spider for the start snake on every seed 0 to 199", () => {
    let placed = 0;
    for (let seed = 0; seed < 200; seed += 1) {
      if (spawnSpider(seed, startSnake, null, [])[0]) placed += 1;
    }
    expect(placed).toBe(200);
  });

  it("is deterministic for the same word", () => {
    fc.assert(
      fc.property(word, snakeArb, (seed, snake) => {
        expect(spawnSpider(seed, snake, null, [])).toEqual(
          spawnSpider(seed, snake, null, []),
        );
      }),
      { numRuns: 100 },
    );
  });
});
