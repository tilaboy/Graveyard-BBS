import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { COLS, ROWS } from "../src/config.js";
import {
  key,
  inBounds,
  cheb,
  webCells,
  hazardSet,
  fitsGrid,
} from "../src/grid.js";

const coord = fc.integer({ min: -5, max: 30 });
const cellArb = fc.record({ x: coord, y: coord });
const radius = fc.constantFrom(/** @type {const} */ (1), 2, 3);
const spiderArb = fc.record({ at: cellArb, r: radius });

describe("grid helpers (design §5)", () => {
  it("key formats x,y", () => {
    expect(key({ x: 3, y: 17 })).toBe("3,17");
    expect(key({ x: -1, y: 0 })).toBe("-1,0");
  });

  it("inBounds accepts exactly the 24 x 24 grid", () => {
    expect(inBounds({ x: 0, y: 0 })).toBe(true);
    expect(inBounds({ x: COLS - 1, y: ROWS - 1 })).toBe(true);
    expect(inBounds({ x: -1, y: 0 })).toBe(false);
    expect(inBounds({ x: 0, y: -1 })).toBe(false);
    expect(inBounds({ x: COLS, y: 0 })).toBe(false);
    expect(inBounds({ x: 0, y: ROWS })).toBe(false);
    fc.assert(
      fc.property(cellArb, (c) => {
        expect(inBounds(c)).toBe(
          c.x >= 0 && c.x < COLS && c.y >= 0 && c.y < ROWS,
        );
      }),
    );
  });

  it("cheb is the max axis distance and symmetric", () => {
    expect(cheb({ x: 0, y: 0 }, { x: 3, y: -5 })).toBe(5);
    fc.assert(
      fc.property(cellArb, cellArb, (a, b) => {
        const d = cheb(a, b);
        expect(d).toBe(cheb(b, a));
        expect(d).toBe(Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y)));
        expect(cheb(a, a)).toBe(0);
      }),
    );
  });

  it("R4.3 web has (2r+1)^2 distinct cells: 9, 25 or 49, centre included", () => {
    expect(webCells({ at: { x: 5, y: 5 }, r: 1 })).toHaveLength(9);
    expect(webCells({ at: { x: 5, y: 5 }, r: 2 })).toHaveLength(25);
    expect(webCells({ at: { x: 5, y: 5 }, r: 3 })).toHaveLength(49);
    fc.assert(
      fc.property(spiderArb, (s) => {
        const cells = webCells(s);
        expect(cells).toHaveLength((2 * s.r + 1) ** 2);
        expect(new Set(cells.map(key)).size).toBe(cells.length);
        expect(cells.some((c) => c.x === s.at.x && c.y === s.at.y)).toBe(true);
        for (const c of cells) expect(cheb(c, s.at)).toBeLessThanOrEqual(s.r);
      }),
    );
  });

  it("webCells contains every cell within radius r", () => {
    fc.assert(
      fc.property(spiderArb, cellArb, (s, c) => {
        const inWeb = webCells(s).some((w) => w.x === c.x && w.y === c.y);
        expect(inWeb).toBe(cheb(c, s.at) <= s.r);
      }),
    );
  });

  it("hazardSet is the union of every web, spider cell included", () => {
    expect(hazardSet([]).size).toBe(0);
    fc.assert(
      fc.property(
        fc.array(spiderArb, { maxLength: 6 }),
        cellArb,
        (spiders, c) => {
          const set = hazardSet(spiders);
          for (const s of spiders) expect(set.has(key(s.at))).toBe(true);
          const expected = spiders.some((s) => cheb(c, s.at) <= s.r);
          expect(set.has(key(c))).toBe(expected);
        },
      ),
    );
  });

  it("R4.4 fitsGrid holds exactly when every web cell is in bounds", () => {
    expect(fitsGrid({ at: { x: 1, y: 1 }, r: 1 })).toBe(true);
    expect(fitsGrid({ at: { x: 0, y: 5 }, r: 1 })).toBe(false);
    expect(fitsGrid({ at: { x: COLS - 4, y: ROWS - 4 }, r: 3 })).toBe(true);
    expect(fitsGrid({ at: { x: COLS - 3, y: 10 }, r: 3 })).toBe(false);
    fc.assert(
      fc.property(spiderArb, (s) => {
        expect(fitsGrid(s)).toBe(webCells(s).every(inBounds));
      }),
    );
  });
});
