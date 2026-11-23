import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { FLIP_VY, GRAVITY, MAX_FALL_VY } from '../src/config.js';
import { applyGravity, clampVy, flip } from '../src/physics.js';

describe('physics', () => {
  it('R2.1 flip replaces the velocity with FLIP_VY', () => {
    expect(flip({ y: 300, vy: 9 })).toEqual({ y: 300, vy: FLIP_VY });
    expect(flip({ y: 300, vy: -3 })).toEqual({ y: 300, vy: FLIP_VY });
  });

  it('R2.2 gravity adds GRAVITY each tick and moves the ghost', () => {
    const g = applyGravity({ y: 300, vy: 0 });
    expect(g.vy).toBeCloseTo(GRAVITY);
    expect(g.y).toBeCloseTo(300 + GRAVITY);
  });

  it('R2.2 fall speed is capped at MAX_FALL_VY', () => {
    let g = { y: 0, vy: 0 };
    for (let i = 0; i < 200; i += 1) g = applyGravity(g);
    expect(g.vy).toBe(MAX_FALL_VY);
  });

  it('clampVy keeps values inside [FLIP_VY, MAX_FALL_VY]', () => {
    expect(clampVy(-100)).toBe(FLIP_VY);
    expect(clampVy(100)).toBe(MAX_FALL_VY);
    expect(clampVy(1)).toBe(1);
  });

  it('does not mutate its argument', () => {
    const g = Object.freeze({ y: 10, vy: 2 });
    applyGravity(g);
    flip(g);
    expect(g).toEqual({ y: 10, vy: 2 });
  });

  it('R2.4 vertical velocity stays within [FLIP_VY, MAX_FALL_VY] for any input sequence', () => {
    fc.assert(
      fc.property(fc.array(fc.constantFrom('flip', 'none'), { maxLength: 3000 }), (tape) => {
        let g = { y: 300, vy: 0 };
        for (const input of tape) {
          if (input === 'flip') g = flip(g);
          g = applyGravity(g);
          if (g.vy < FLIP_VY || g.vy > MAX_FALL_VY) return false;
        }
        return true;
      }),
    );
  });
});
