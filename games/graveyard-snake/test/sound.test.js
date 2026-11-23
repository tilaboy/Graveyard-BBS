import { describe, it, expect } from "vitest";
import { createSound, VOICES } from "../src/sound.js";

/** A fake AudioContext that records every oscillator it makes. */
function fakeCtx(state = "running") {
  /** @type {{type: string, freqs: number[], start: number, stop: number}[]} */
  const oscs = [];
  const param = () => ({
    /** @type {number[]} */
    values: [],
    /** @param {number} v */
    setValueAtTime(v) {
      this.values.push(v);
    },
    /** @param {number} v */
    exponentialRampToValueAtTime(v) {
      this.values.push(v);
    },
  });
  const ctx = {
    state,
    currentTime: 10,
    destination: {},
    resumed: 0,
    oscs,
    resume() {
      ctx.resumed++;
      return Promise.resolve();
    },
    createOscillator() {
      const rec = {
        type: "",
        freqs: /** @type {number[]} */ ([]),
        start: 0,
        stop: 0,
      };
      oscs.push(rec);
      const frequency = param();
      return {
        set type(/** @type {string} */ t) {
          rec.type = t;
        },
        frequency: {
          ...frequency,
          /** @param {number} v */
          setValueAtTime(v) {
            rec.freqs.push(v);
          },
        },
        connect() {},
        /** @param {number} t */
        start(t) {
          rec.start = t;
        },
        /** @param {number} t */
        stop(t) {
          rec.stop = t;
        },
      };
    },
    createGain() {
      return { gain: param(), connect() {} };
    },
  };
  return ctx;
}

/** @param {ReturnType<typeof fakeCtx>} ctx */
function setup(ctx) {
  let made = 0;
  const sound = createSound(() => {
    made++;
    return /** @type {AudioContext} */ (/** @type {unknown} */ (ctx));
  });
  return { sound, made: () => made };
}

describe("sound (R8.1 to R8.3)", () => {
  it("R8.1 starts disabled, creates no AudioContext and play is a no-op", () => {
    const ctx = fakeCtx();
    const { sound, made } = setup(ctx);
    expect(sound.enabled).toBe(false);
    sound.play("eat-ghost");
    sound.play("caught");
    expect(made()).toBe(0);
    expect(ctx.oscs).toEqual([]);
  });

  it("R8.1 R8.3 first toggle creates the context once and plays the 660 then 880 Hz chime", () => {
    const ctx = fakeCtx();
    const { sound, made } = setup(ctx);
    expect(sound.toggle()).toBe(true);
    expect(sound.enabled).toBe(true);
    expect(made()).toBe(1);
    expect(ctx.oscs.map((o) => [o.type, o.freqs[0]])).toEqual([
      ["sine", 660],
      ["sine", 880],
    ]);
    expect(ctx.oscs[0].start).toBeCloseTo(10);
    expect(ctx.oscs[1].start).toBeCloseTo(10.12);
    expect(sound.toggle()).toBe(false);
    expect(sound.toggle()).toBe(true);
    expect(made()).toBe(1);
  });

  it("resumes a suspended context on toggle", () => {
    const ctx = fakeCtx("suspended");
    const { sound } = setup(ctx);
    sound.toggle();
    expect(ctx.resumed).toBe(1);
  });

  it("R8.3 eat blips are 80 ms square notes pitched by kind", () => {
    const ctx = fakeCtx();
    const { sound } = setup(ctx);
    sound.toggle();
    ctx.oscs.length = 0;
    sound.play("eat-ghost");
    sound.play("eat-skeleton");
    sound.play("eat-dinosaur");
    expect(ctx.oscs.map((o) => [o.type, o.freqs[0]])).toEqual([
      ["square", 520],
      ["square", 392],
      ["square", 196],
    ]);
    for (const o of ctx.oscs) expect(o.stop - o.start).toBeCloseTo(0.1);
  });

  it("R8.3 caught is a low 65, 98, 131 Hz chord with a 900 ms decay", () => {
    const ctx = fakeCtx();
    const { sound } = setup(ctx);
    sound.toggle();
    ctx.oscs.length = 0;
    sound.play("caught");
    expect(ctx.oscs.map((o) => o.freqs[0])).toEqual([65, 98, 131]);
    expect(VOICES.caught.every((n) => n.dur === 0.9)).toBe(true);
  });

  it("play is a no-op again after toggling off", () => {
    const ctx = fakeCtx();
    const { sound } = setup(ctx);
    sound.toggle();
    sound.toggle();
    ctx.oscs.length = 0;
    sound.play("caught");
    expect(ctx.oscs).toEqual([]);
  });

  it("R8.2 every voice is synthesised from oscillator notes", () => {
    expect(Object.keys(VOICES).sort()).toEqual([
      "caught",
      "chime",
      "eat-dinosaur",
      "eat-ghost",
      "eat-skeleton",
    ]);
    for (const notes of Object.values(VOICES)) {
      expect(notes.length).toBeGreaterThan(0);
      for (const n of notes) expect(n.freq).toBeGreaterThan(0);
    }
  });
});
