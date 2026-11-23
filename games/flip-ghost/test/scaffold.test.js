import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, it, expect } from 'vitest';
import * as config from '../src/config.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

describe('scaffold (R8.1, R8.2, R8.5)', () => {
  it('index.html loads src/main.js as a module and the file exists', () => {
    const html = readFileSync(join(root, 'index.html'), 'utf8');
    expect(html).toMatch(/<script type="module" src="src\/main\.js"><\/script>/);
    expect(html).toContain('width="480"');
    expect(html).toContain('height="640"');
    expect(html).toContain('PHASE (P)');
    expect(existsSync(join(root, 'src', 'main.js'))).toBe(true);
  });

  it('fixed superpower constants: 10 s phase, 20 s cooldown at 60 Hz', () => {
    expect(config.TICK_HZ).toBe(60);
    expect(config.PHASE_TICKS).toBe(600);
    expect(config.COOLDOWN_TICKS).toBe(1200);
  });

  it('package.json has a vitest test script and no dependencies', () => {
    const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
    expect(pkg.scripts.test).toBe('vitest run');
    expect(pkg.dependencies).toBeUndefined();
    expect(pkg.devDependencies).toBeUndefined();
  });

  // Exports only: later tasks replace the stubs, so "throws not implemented" is not asserted.
  it('every design §2 module exists with its exported functions', async () => {
    const stubs = {
      'rng.js': ['next'],
      'physics.js': ['flip', 'applyGravity'],
      'course.js': ['spawnIfDue', 'scroll', 'cull', 'gapBounds'],
      'power.js': ['trigger', 'tickPower', 'powerLabel'],
      'collide.js': ['hits', 'collide'],
      'sim.js': ['initialState', 'step'],
      'input.js': ['bindInput'],
      'render.js': ['draw'],
      'hud.js': ['updateHud'],
      'sound.js': ['createSound'],
      'main.js': ['boot'],
    };
    for (const [file, names] of Object.entries(stubs)) {
      const mod = await import(`../src/${file}`);
      for (const name of names) {
        expect(typeof mod[name], `${file} exports ${name}`).toBe('function');
      }
    }
  });
});
