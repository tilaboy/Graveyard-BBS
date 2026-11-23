import { describe, it, expect, vi } from 'vitest';
import { bindInput } from '../src/input.js';

/** Minimal fake EventTarget: records listeners and dispatches plain event objects. */
function fakeTarget() {
  /** @type {Map<string, Set<(e: any) => void>>} */
  const listeners = new Map();
  return {
    addEventListener(type, fn) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type).add(fn);
    },
    removeEventListener(type, fn) {
      listeners.get(type)?.delete(fn);
    },
    fire(type, props = {}) {
      const ev = {
        type,
        target: this,
        defaultPrevented: false,
        preventDefault() {
          this.defaultPrevented = true;
        },
        stopPropagation() {},
        ...props,
      };
      for (const fn of listeners.get(type) ?? []) fn(ev);
      return ev;
    },
    count(type) {
      return listeners.get(type)?.size ?? 0;
    },
  };
}

function setup() {
  const target = fakeTarget();
  const button = fakeTarget();
  const queue = [];
  const onSound = vi.fn();
  const unbind = bindInput(target, queue, { onSound, phaseButton: button });
  return { target, button, queue, onSound, unbind };
}

describe('bindInput (R1.3, R5.1, design §9)', () => {
  it('Space flips and prevents page scroll', () => {
    const { target, queue } = setup();
    const ev = target.fire('keydown', { key: ' ', code: 'Space' });
    expect(queue).toEqual(['flip']);
    expect(ev.defaultPrevented).toBe(true);
  });

  it('click or tap (pointerdown) on the playfield flips', () => {
    const { target, queue } = setup();
    target.fire('pointerdown', { pointerType: 'mouse' });
    target.fire('pointerdown', { pointerType: 'touch' });
    expect(queue).toEqual(['flip', 'flip']);
  });

  it('P key (either case) triggers phase', () => {
    const { target, queue } = setup();
    target.fire('keydown', { key: 'p', code: 'KeyP' });
    target.fire('keydown', { key: 'P', code: 'KeyP' });
    expect(queue).toEqual(['phase', 'phase']);
  });

  it('the PHASE button triggers phase, and a press on it does not also flip', () => {
    const { target, button, queue } = setup();
    target.fire('pointerdown', { target: button });
    button.fire('click');
    expect(queue).toEqual(['phase']);
  });

  it('M calls onSound and never enters the queue', () => {
    const { target, queue, onSound } = setup();
    target.fire('keydown', { key: 'm', code: 'KeyM' });
    expect(onSound).toHaveBeenCalledTimes(1);
    expect(queue).toEqual([]);
  });

  it('ignores key repeat, modifier chords and other keys', () => {
    const { target, queue, onSound } = setup();
    target.fire('keydown', { key: ' ', code: 'Space', repeat: true });
    target.fire('keydown', { key: 'p', code: 'KeyP', metaKey: true });
    target.fire('keydown', { key: 'm', code: 'KeyM', ctrlKey: true });
    target.fire('keydown', { key: 'x', code: 'KeyX' });
    expect(queue).toEqual([]);
    expect(onSound).not.toHaveBeenCalled();
  });

  it('works without options', () => {
    const target = fakeTarget();
    const queue = [];
    bindInput(target, queue);
    target.fire('keydown', { key: 'm', code: 'KeyM' });
    target.fire('keydown', { key: ' ', code: 'Space' });
    expect(queue).toEqual(['flip']);
  });

  it('unbind removes every listener', () => {
    const { target, button, queue, unbind } = setup();
    unbind();
    expect(target.count('keydown')).toBe(0);
    expect(target.count('pointerdown')).toBe(0);
    expect(button.count('click')).toBe(0);
    target.fire('keydown', { key: ' ', code: 'Space' });
    button.fire('click');
    expect(queue).toEqual([]);
  });
});
