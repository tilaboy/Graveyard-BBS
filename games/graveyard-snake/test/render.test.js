import { describe, it, expect } from "vitest";
import {
  draw,
  overlayLines,
  COLORS,
  WIDTH,
  HEIGHT,
  INITIALS,
} from "../src/render.js";
import { CELL_PX, FLASH_HZ } from "../src/config.js";

/** Recording fake CanvasRenderingContext2D: every call is logged with the current styles. */
function fakeCtx() {
  const calls = [];
  const stack = [];
  const ctx = {
    calls,
    globalAlpha: 1,
    fillStyle: "#000000",
    strokeStyle: "#000000",
    lineWidth: 1,
    font: "10px sans-serif",
    textAlign: "start",
    textBaseline: "alphabetic",
    save() {
      stack.push({
        a: ctx.globalAlpha,
        f: ctx.fillStyle,
        s: ctx.strokeStyle,
        l: ctx.lineWidth,
      });
      calls.push({ op: "save" });
    },
    restore() {
      const top = stack.pop();
      if (top) {
        ctx.globalAlpha = top.a;
        ctx.fillStyle = top.f;
        ctx.strokeStyle = top.s;
        ctx.lineWidth = top.l;
      }
      calls.push({ op: "restore" });
    },
  };
  for (const op of [
    "fillRect",
    "strokeRect",
    "beginPath",
    "closePath",
    "moveTo",
    "lineTo",
    "arc",
    "fill",
    "stroke",
    "fillText",
  ]) {
    ctx[op] = (...args) =>
      calls.push({
        op,
        args,
        alpha: ctx.globalAlpha,
        fillStyle: ctx.fillStyle,
        strokeStyle: ctx.strokeStyle,
        lineWidth: ctx.lineWidth,
      });
  }
  return ctx;
}

/** A State with defaults (config.js State typedef). */
function state(over = {}) {
  return {
    phase: "play",
    tick: 100,
    sinceMove: 0,
    stepTicks: 8,
    rng: 1,
    snake: [
      { x: 12, y: 12 },
      { x: 11, y: 12 },
      { x: 10, y: 12 },
    ],
    dir: "right",
    turns: [],
    grow: 0,
    creature: { kind: "ghost", at: { x: 3, y: 3 } },
    spiders: [{ at: { x: 18, y: 18 }, r: 2 }],
    score: 0,
    eaten: { ghost: 0, skeleton: 0, dinosaur: 0 },
    end: null,
    ...over,
  };
}

const MOTION = { reducedMotion: false, flashOn: false };
const texts = (ctx) =>
  ctx.calls.filter((c) => c.op === "fillText").map((c) => c.args[0]);

describe("draw (design §10)", () => {
  it("R7.7 clears to a black 480 x 480 background first", () => {
    const ctx = fakeCtx();
    draw(ctx, state(), MOTION);
    const first = ctx.calls.find((c) => c.op === "fillRect");
    expect(first.args).toEqual([0, 0, 480, 480]);
    expect(WIDTH).toBe(480);
    expect(HEIGHT).toBe(480);
    expect(first.fillStyle).toBe(COLORS.black);
  });

  it("R7.7 draws one bone grey square per web radius step", () => {
    for (const r of [1, 2, 3]) {
      const ctx = fakeCtx();
      draw(ctx, state({ spiders: [{ at: { x: 12, y: 5 }, r }] }), MOTION);
      const squares = ctx.calls.filter(
        (c) => c.op === "strokeRect" && c.strokeStyle === COLORS.bone,
      );
      expect(squares).toHaveLength(r);
      // the outer square covers the whole (2r+1) x (2r+1) web
      const outer = squares[r - 1].args;
      expect(outer[2]).toBeGreaterThan((2 * r + 1) * CELL_PX - 4);
      expect(outer[2]).toBeLessThanOrEqual((2 * r + 1) * CELL_PX);
    }
  });

  it("R7.7 draws spiders as blood red circles with legs", () => {
    const ctx = fakeCtx();
    draw(
      ctx,
      state({
        spiders: [
          { at: { x: 4, y: 18 }, r: 1 },
          { at: { x: 18, y: 18 }, r: 3 },
        ],
      }),
      MOTION,
    );
    const bodies = ctx.calls.filter(
      (c) =>
        c.op === "arc" &&
        c.fillStyle === COLORS.blood &&
        c.args[4] === Math.PI * 2,
    );
    expect(bodies).toHaveLength(2);
    expect(bodies[0].args.slice(0, 2)).toEqual([4 * 20 + 10, 18 * 20 + 10]);
    const legs = ctx.calls.filter(
      (c) => c.op === "lineTo" && c.strokeStyle === COLORS.blood,
    );
    // 8 legs per spider, 2 spiders
    expect(legs).toHaveLength(16);
  });

  it("R7.4 R7.7 draws every creature kind in poison green with its name initial", () => {
    for (const kind of ["ghost", "skeleton", "dinosaur"]) {
      const ctx = fakeCtx();
      draw(ctx, state({ creature: { kind, at: { x: 3, y: 3 } } }), MOTION);
      expect(
        ctx.calls.some(
          (c) => c.op === "stroke" && c.strokeStyle === COLORS.green,
        ),
      ).toBe(true);
      const label = ctx.calls.find(
        (c) => c.op === "fillText" && c.args[0] === INITIALS[kind],
      );
      expect(label, kind).toBeDefined();
      expect(label.fillStyle).toBe(COLORS.green);
    }
  });

  it("draws no creature when there is none", () => {
    const ctx = fakeCtx();
    draw(ctx, state({ creature: null }), MOTION);
    expect(
      ctx.calls.some(
        (c) => c.strokeStyle === COLORS.green && c.op === "stroke",
      ),
    ).toBe(false);
  });

  it("R7.7 draws one ghost white cell per snake cell, then two eyes", () => {
    const ctx = fakeCtx();
    const s = state();
    draw(ctx, s, MOTION);
    const cells = ctx.calls.filter(
      (c) => c.op === "fill" && c.fillStyle === COLORS.ghost,
    );
    expect(cells).toHaveLength(s.snake.length);
    const eyes = ctx.calls.filter(
      (c) => c.op === "fill" && c.fillStyle === COLORS.black,
    );
    expect(eyes).toHaveLength(2);
  });

  it("draws in order: background, webs, spiders, creature, snake", () => {
    const ctx = fakeCtx();
    draw(ctx, state(), MOTION);
    const idx = (pred) => ctx.calls.findIndex(pred);
    const bg = idx((c) => c.op === "fillRect");
    const web = idx((c) => c.strokeStyle === COLORS.bone);
    const spider = idx((c) => c.strokeStyle === COLORS.blood);
    const creature = idx((c) => c.strokeStyle === COLORS.green);
    const snake = idx((c) => c.op === "fill" && c.fillStyle === COLORS.ghost);
    expect(bg).toBeLessThan(web);
    expect(web).toBeLessThan(spider);
    expect(spider).toBeLessThan(creature);
    expect(creature).toBeLessThan(snake);
  });

  it("does not mutate the state and restores the context styles", () => {
    const s = state({ phase: "over", end: "web", score: 7 });
    const copy = structuredClone(s);
    const ctx = fakeCtx();
    draw(ctx, s, { reducedMotion: false, flashOn: true });
    expect(s).toEqual(copy);
    expect(ctx.globalAlpha).toBe(1);
    expect(ctx.fillStyle).toBe("#000000");
  });
});

describe("catch flash (R7.5, R7.6)", () => {
  const caught = state({ phase: "over", end: "web", score: 12 });
  const flashes = (ctx) =>
    ctx.calls.filter(
      (c) =>
        c.op === "fillRect" &&
        c.fillStyle === COLORS.blood &&
        c.args[2] === WIDTH &&
        c.args[3] === HEIGHT,
    );
  const borders = (ctx) =>
    ctx.calls.filter(
      (c) => c.op === "strokeRect" && c.strokeStyle === COLORS.blood,
    );

  it("R7.6 flashes red only while the shell sets flashOn, at 2 Hz (under 3 per second)", () => {
    const on = fakeCtx();
    draw(on, caught, { reducedMotion: false, flashOn: true });
    expect(flashes(on)).toHaveLength(1);
    expect(flashes(on)[0].alpha).toBeLessThan(1);
    const off = fakeCtx();
    draw(off, caught, { reducedMotion: false, flashOn: false });
    expect(flashes(off)).toHaveLength(0);
    expect(FLASH_HZ).toBeLessThanOrEqual(3);
  });

  it("R7.5 reduced motion draws a static red border and never the flash", () => {
    for (const flashOn of [true, false]) {
      const ctx = fakeCtx();
      draw(ctx, caught, { reducedMotion: true, flashOn });
      expect(flashes(ctx)).toHaveLength(0);
      const b = borders(ctx);
      expect(b).toHaveLength(1);
      expect(b[0].lineWidth).toBeGreaterThan(1);
    }
  });

  it("no flash or border for other end reasons or while playing", () => {
    for (const s of [
      state({ phase: "over", end: "wall" }),
      state({ phase: "over", end: "self" }),
      state(),
    ]) {
      for (const reducedMotion of [true, false]) {
        const ctx = fakeCtx();
        draw(ctx, s, { reducedMotion, flashOn: true });
        expect(flashes(ctx)).toHaveLength(0);
        expect(borders(ctx)).toHaveLength(0);
      }
    }
  });
});

describe("overlays (R7.2, R7.4, R7.7)", () => {
  it("shows the title and start keys on the title screen", () => {
    const ctx = fakeCtx();
    draw(ctx, state({ phase: "title" }), MOTION);
    expect(texts(ctx)).toContain("GRAVEYARD SNAKE");
    expect(texts(ctx).join(" ")).toContain("Space or Enter");
  });

  it("shows PAUSED while paused", () => {
    const ctx = fakeCtx();
    draw(ctx, state({ phase: "paused" }), MOTION);
    expect(texts(ctx)).toContain("PAUSED");
  });

  it("shows no overlay text during play beyond creature initials", () => {
    const ctx = fakeCtx();
    draw(ctx, state(), MOTION);
    expect(texts(ctx)).toEqual(["G"]);
    expect(overlayLines(state())).toEqual([]);
  });

  it("R7.2 R7.4 names the end reason in words with the plain facts, in blood red", () => {
    for (const [end, words] of [
      ["web", "Caught in a spider web"],
      ["wall", "Hit the graveyard wall"],
      ["self", "Bit its own tail"],
      ["full", "The graveyard is full"],
    ]) {
      const ctx = fakeCtx();
      draw(ctx, state({ phase: "over", end, score: 12 }), MOTION);
      const lines = ctx.calls.filter((c) => c.op === "fillText");
      const lead = lines.find((c) => c.args[0] === words);
      expect(lead, end).toBeDefined();
      expect(lead.fillStyle).toBe(COLORS.blood);
      const facts = lines.find(
        (c) => c.args[0] === `GAME OVER · reason: ${end} · score 12`,
      );
      expect(facts, end).toBeDefined();
      expect(facts.fillStyle).toBe(COLORS.blood);
    }
  });
});
