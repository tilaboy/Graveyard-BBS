import { describe, it, expect } from 'vitest';
import { updateHud, stateLine, scoreText } from '../src/hud.js';

/** Fake element with textContent and attributes; counts text writes. */
function fakeEl() {
  let text = '';
  return {
    writes: 0,
    attrs: {},
    get textContent() {
      return text;
    },
    set textContent(v) {
      text = v;
      this.writes++;
    },
    setAttribute(k, v) {
      this.attrs[k] = v;
    },
  };
}

function fakeDoc() {
  const els = { 'hud-score': fakeEl(), 'hud-line': fakeEl(), 'phase-btn': fakeEl() };
  return { els, getElementById: (id) => els[id] ?? null };
}

/** A State with defaults (config.js State typedef). */
function state(over = {}) {
  return {
    mode: 'playing',
    tick: 0,
    ghost: { y: 300, vy: 0 },
    obstacles: [],
    nextId: 0,
    scrolled: 0,
    rng: 1,
    score: 0,
    power: { mode: 'ready', left: 0 },
    graceId: null,
    deadAt: null,
    events: [],
    ...over,
  };
}

describe('updateHud (R1.2, R4.3, R5.8, R6.3, R6.6)', () => {
  it('ready shows the title and the plain flip instruction', () => {
    const doc = fakeDoc();
    updateHud(doc, state({ mode: 'ready' }), 0);
    const line = doc.els['hud-line'].textContent;
    expect(line).toContain('FLIP GHOST');
    expect(line).toContain('Space / click / tap to flip');
    expect(doc.els['hud-score'].textContent).toBe('Score 0 · Best 0');
    expect(doc.els['phase-btn'].textContent).toBe('PHASE (P)');
    expect(doc.els['phase-btn'].attrs['aria-disabled']).toBe('false');
  });

  it('playing shows the current score and the session best', () => {
    const doc = fakeDoc();
    updateHud(doc, state({ score: 7 }), 12);
    expect(doc.els['hud-score'].textContent).toBe('Score 7 · Best 12');
  });

  it('best is never shown below the current score', () => {
    const doc = fakeDoc();
    updateHud(doc, state({ score: 15 }), 12);
    expect(doc.els['hud-score'].textContent).toBe('Score 15 · Best 15');
  });

  it('dead line is themed and carries the plain score and best', () => {
    const doc = fakeDoc();
    updateHud(doc, state({ mode: 'dead', score: 7, deadAt: 100 }), 12);
    expect(doc.els['hud-line'].textContent).toBe(
      '💀 The veil took you. Score 7 · Best 12 · press Space to rise again',
    );
  });

  it('phase-through shows the seconds left on the line and the button (R6.3)', () => {
    const doc = fakeDoc();
    // After the trigger tick, power.left is 599: 600 ticks remain including this one.
    updateHud(doc, state({ power: { mode: 'active', left: 599 } }), 0);
    expect(doc.els['hud-line'].textContent).toBe('Phase-through: 10s');
    expect(doc.els['phase-btn'].textContent).toBe('PHASING 10s');
    expect(doc.els['phase-btn'].attrs['aria-disabled']).toBe('true');
    updateHud(doc, state({ power: { mode: 'active', left: 0 } }), 0);
    expect(doc.els['hud-line'].textContent).toBe('Phase-through: 1s');
  });

  it('cooldown: the button shows why a press does nothing (R5.8)', () => {
    const doc = fakeDoc();
    updateHud(doc, state({ power: { mode: 'cooldown', left: 719 } }), 0);
    expect(doc.els['phase-btn'].textContent).toBe('COOLDOWN 12s');
    expect(doc.els['phase-btn'].attrs['data-power']).toBe('cooldown');
    expect(doc.els['hud-line'].textContent).not.toContain('Phase-through');
  });

  it('does not rewrite unchanged text (no aria-live spam)', () => {
    const doc = fakeDoc();
    const s = state({ score: 3 });
    updateHud(doc, s, 5);
    updateHud(doc, s, 5);
    expect(doc.els['hud-score'].writes).toBe(1);
    expect(doc.els['hud-line'].writes).toBe(1);
  });

  it('missing elements are skipped without throwing', () => {
    expect(() => updateHud({ getElementById: () => null }, state(), 0)).not.toThrow();
  });

  it('every state line that uses an emoji also carries plain words (R6.6)', () => {
    for (const s of [state({ mode: 'ready' }), state({ mode: 'dead', score: 4 })]) {
      const line = stateLine(s, 9);
      expect(line.replace(/\p{Extended_Pictographic}/gu, '').trim().length).toBeGreaterThan(10);
    }
    expect(stateLine(state({ mode: 'dead', score: 4 }), 9)).toContain(scoreText(4, 9));
  });
});
