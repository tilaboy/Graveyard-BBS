import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { GAP_H, GROUND_Y, OBSTACLE_SPACING, OBSTACLE_W, SCROLL_VX, WIDTH } from '../src/config.js';
import { cull, gapBounds, scroll, spawnIfDue } from '../src/course.js';
import { next, seedWord } from '../src/rng.js';

const empty = (rng = 1) => ({ obstacles: [], nextId: 0, scrolled: 0, rng });

/** One playing tick of the course, in design §5 order: scroll, spawn, cull. */
const tick = (c) => cull(spawnIfDue(scroll(c)));

describe('rng', () => {
  it('is deterministic for the same seed word', () => {
    expect(next(42)).toEqual(next(42));
    expect(next(42)[0]).not.toBe(next(43)[0]);
  });

  it('returns values in [0, 1) and uint32 state words', () => {
    fc.assert(
      fc.property(fc.integer(), (seed) => {
        const [v, w] = next(seed);
        return v >= 0 && v < 1 && Number.isInteger(w) && w >= 0 && w <= 0xffffffff;
      }),
    );
  });

  it('seedWord maps non-finite seeds to 0', () => {
    expect(seedWord(Number.NaN)).toBe(0);
    expect(seedWord(-1)).toBe(0xffffffff);
  });
});

describe('course', () => {
  it('R3.1 spawns the first obstacle at x = WIDTH on the first tick', () => {
    const c = tick(empty());
    expect(c.obstacles).toHaveLength(1);
    expect(c.obstacles[0]).toMatchObject({ x: WIDTH, scored: false, id: 0 });
    expect(c.nextId).toBe(1);
  });

  it('R3.1 spawns one obstacle every OBSTACLE_SPACING px of scroll', () => {
    let c = tick(empty());
    const ticksPerSpawn = OBSTACLE_SPACING / SCROLL_VX; // 88
    for (let i = 0; i < ticksPerSpawn - 1; i += 1) c = tick(c);
    expect(c.nextId).toBe(1);
    c = tick(c);
    expect(c.nextId).toBe(2);
    const [a, b] = c.obstacles;
    expect(b.x - a.x).toBeCloseTo(OBSTACLE_SPACING);
  });

  it('R3.1 spawn count matches scroll distance over a long run', () => {
    let c = empty(7);
    const ticks = 5000;
    for (let i = 0; i < ticks; i += 1) c = tick(c);
    expect(c.nextId).toBe(1 + Math.floor(((ticks - 1) * SCROLL_VX) / OBSTACLE_SPACING));
  });

  it('R3.2 the same seed gives the same course', () => {
    let a = empty(99);
    let b = empty(99);
    for (let i = 0; i < 1000; i += 1) {
      a = tick(a);
      b = tick(b);
    }
    expect(a).toEqual(b);
  });

  it('R3.3 every gap has height GAP_H (gap is gapY..gapY+GAP_H)', () => {
    const [lo, hi] = gapBounds();
    expect(hi - lo).toBe(GROUND_Y - 2 * 40 - GAP_H);
  });

  it('R3.4 removes an obstacle once it is fully off the left edge', () => {
    const c = { ...empty(), nextId: 1, obstacles: [{ x: -OBSTACLE_W + 1, gapY: 100, scored: true, id: 0 }] };
    expect(cull(c).obstacles).toHaveLength(1);
    const gone = scroll(c, 1);
    expect(cull(gone).obstacles).toHaveLength(0);
  });

  it('does not mutate its argument', () => {
    const c = empty();
    const frozen = Object.freeze({ ...c, obstacles: Object.freeze([]) });
    tick(frozen);
    expect(frozen).toEqual(c);
  });

  it('R3.5 every spawned gap lies fully between the ceiling and the ground, for any seed', () => {
    fc.assert(
      fc.property(fc.integer(), fc.integer({ min: 1, max: 4000 }), (seed, ticks) => {
        let c = empty(seed);
        for (let i = 0; i < ticks; i += 1) {
          c = tick(c);
          for (const o of c.obstacles) {
            if (o.gapY < 0 || o.gapY + GAP_H > GROUND_Y) return false;
          }
        }
        return true;
      }),
      { numRuns: 50 },
    );
  });
});
