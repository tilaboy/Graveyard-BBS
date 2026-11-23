import { describe, it, expect, beforeEach } from "vitest";
import { createSound, VOICES } from "../src/sound.js";

/** Fake Web Audio: records constructed contexts and started oscillators. */
let contexts;
let started;

function param() {
  return {
    setValueAtTime() {},
    exponentialRampToValueAtTime() {},
  };
}

class FakeAudioContext {
  constructor() {
    this.currentTime = 0;
    this.state = "suspended";
    this.resumed = 0;
    this.destination = {};
    contexts.push(this);
  }
  resume() {
    this.resumed += 1;
    this.state = "running";
    return Promise.resolve();
  }
  createOscillator() {
    const osc = {
      type: "sine",
      frequency: param(),
      connect() {},
      start() {
        started.push(osc);
      },
      stop() {},
    };
    return osc;
  }
  createGain() {
    return { gain: param(), connect() {} };
  }
}

const NAMES = ["flip", "phase-on", "phase-off", "score", "die"];

beforeEach(() => {
  contexts = [];
  started = [];
});

describe("sound (R7)", () => {
  it("R7.2 creates no AudioContext and plays nothing before toggle()", () => {
    const s = createSound(FakeAudioContext);
    for (const n of NAMES) s.play(n);
    expect(contexts).toHaveLength(0);
    expect(started).toHaveLength(0);
  });

  it("R7.2 creates the context lazily on the first toggle() and reuses it", () => {
    const s = createSound(FakeAudioContext);
    expect(s.toggle()).toBe(true);
    expect(contexts).toHaveLength(1);
    expect(contexts[0].resumed).toBe(1);
    expect(s.toggle()).toBe(false);
    expect(s.toggle()).toBe(true);
    expect(contexts).toHaveLength(1);
  });

  it("R7.3 each sound name schedules at least one oscillator when on", () => {
    const s = createSound(FakeAudioContext);
    s.toggle();
    for (const n of NAMES) {
      const before = started.length;
      s.play(n);
      expect(started.length - before).toBeGreaterThanOrEqual(1);
      expect(started.length - before).toBe(VOICES[n].length);
    }
  });

  it("R7.2 toggling off silences play()", () => {
    const s = createSound(FakeAudioContext);
    s.toggle();
    s.toggle();
    s.play("flip");
    expect(started).toHaveLength(0);
  });
});
