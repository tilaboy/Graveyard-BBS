import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  draw,
  ghostLook,
  shakeOffset,
  COLORS,
  PHASE_ALPHA,
  BLINK_HALF_TICKS,
  SHAKE_TICKS,
} from "../src/render.js";
import { PHASE_TICKS, PHASE_WARN_TICKS, TICK_HZ } from "../src/config.js";

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
    "ellipse",
    "fill",
    "stroke",
    "drawImage",
    "translate",
  ]) {
    ctx[op] = (...args) =>
      calls.push({
        op,
        args,
        alpha: ctx.globalAlpha,
        fillStyle: ctx.fillStyle,
        strokeStyle: ctx.strokeStyle,
      });
  }
  return ctx;
}

/** A State with defaults (config.js State typedef). */
function state(over = {}) {
  return {
    mode: "playing",
    tick: 100,
    ghost: { y: 300, vy: 0 },
    obstacles: [],
    nextId: 0,
    scrolled: 0,
    rng: 1,
    score: 0,
    power: { mode: "ready", left: 0 },
    graceId: null,
    deadAt: null,
    events: [],
    ...over,
  };
}

const SPRITE = { sprite: true };
const active = (left) => state({ power: { mode: "active", left } });
const spriteCalls = (ctx) => ctx.calls.filter((c) => c.op === "drawImage");

describe("assets/kiro-ghost.svg (R6.2)", () => {
  it("is our own SVG with a ghost white body", () => {
    const svg = readFileSync(
      fileURLToPath(new URL("../assets/kiro-ghost.svg", import.meta.url)),
      "utf8",
    );
    expect(svg).toMatch(/^<svg[^>]+xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
    expect(svg).toContain('fill="#ffffff"');
    expect(svg).not.toMatch(/<image|href=/);
  });
});

describe("draw", () => {
  it("R6.1/R6.5 clears to a black 480 × 640 background first", () => {
    const ctx = fakeCtx();
    draw(ctx, state(), SPRITE, { reducedMotion: false });
    const first = ctx.calls.find((c) => c.op === "fillRect");
    expect(first.args).toEqual([0, 0, 480, 640]);
    expect(first.fillStyle).toBe(COLORS.black);
  });

  it("R6.2 draws the sprite once at full opacity when not phasing", () => {
    const ctx = fakeCtx();
    draw(ctx, state(), SPRITE, { reducedMotion: false });
    const imgs = spriteCalls(ctx);
    expect(imgs).toHaveLength(1);
    expect(imgs[0].args[0]).toBe(SPRITE);
    expect(imgs[0].alpha).toBe(1);
  });

  it("falls back to a ghost white vector ghost when the sprite is not loaded", () => {
    const ctx = fakeCtx();
    draw(ctx, state(), null, { reducedMotion: false });
    expect(spriteCalls(ctx)).toHaveLength(0);
    expect(
      ctx.calls.some((c) => c.op === "fill" && c.fillStyle === COLORS.ghost),
    ).toBe(true);
  });

  it("R6.3 draws the ghost at alpha 0.5 with a cyan outline while active", () => {
    for (const left of [PHASE_TICKS, 300, PHASE_WARN_TICKS]) {
      const ctx = fakeCtx();
      draw(ctx, active(left), SPRITE, { reducedMotion: false });
      expect(spriteCalls(ctx)[0].alpha).toBe(0.5);
      expect(
        ctx.calls.some(
          (c) => c.op === "stroke" && c.strokeStyle === COLORS.cyan,
        ),
      ).toBe(true);
    }
  });

  it("R6.5 draws gravestones in bone grey", () => {
    const ctx = fakeCtx();
    draw(
      ctx,
      state({ obstacles: [{ x: 200, gapY: 200, scored: false, id: 0 }] }),
      SPRITE,
      {
        reducedMotion: false,
      },
    );
    const stones = ctx.calls.filter(
      (c) =>
        c.op === "fillRect" && c.fillStyle === COLORS.bone && c.args[0] === 200,
    );
    expect(stones.length).toBe(2);
  });

  it("restores globalAlpha after drawing", () => {
    const ctx = fakeCtx();
    draw(ctx, active(30), SPRITE, { reducedMotion: false });
    expect(ctx.globalAlpha).toBe(1);
  });

  it("does not mutate the state", () => {
    const s = active(30);
    const copy = structuredClone(s);
    draw(fakeCtx(), s, SPRITE, { reducedMotion: false });
    expect(s).toEqual(copy);
  });

  it("draws a blood red frame on death", () => {
    const ctx = fakeCtx();
    draw(ctx, state({ mode: "dead", deadAt: 50, tick: 200 }), SPRITE, {
      reducedMotion: true,
    });
    expect(
      ctx.calls.some(
        (c) => c.op === "strokeRect" && c.strokeStyle === COLORS.blood,
      ),
    ).toBe(true);
  });
});

describe("ghostLook warning blink (R6.4, R6.7)", () => {
  /** Alpha per tick over the warning window, left = 59 … 0. */
  function alphas(reducedMotion) {
    const out = [];
    for (let left = PHASE_WARN_TICKS - 1; left >= 0; left--) {
      out.push(ghostLook(active(left), reducedMotion).alpha);
    }
    return out;
  }

  it("R6.4 blinks in the last 60 ticks", () => {
    const a = alphas(false);
    expect(new Set(a).size).toBe(2);
    expect(a[0]).toBe(PHASE_ALPHA);
  });

  it("R6.4 holds each blink state for at least 20 ticks (no more than 3 blinks per second)", () => {
    const a = alphas(false);
    let run = 1;
    const runs = [];
    for (let i = 1; i < a.length; i++) {
      if (a[i] === a[i - 1]) run++;
      else {
        runs.push(run);
        run = 1;
      }
    }
    runs.push(run);
    expect(runs.length).toBeGreaterThan(1);
    for (const r of runs) expect(r).toBeGreaterThanOrEqual(20);
    expect(BLINK_HALF_TICKS).toBeGreaterThanOrEqual(TICK_HZ / 3);
  });

  it("R6.7 does not blink under reduced motion and uses a steady cyan tint", () => {
    const a = alphas(true);
    expect(new Set(a)).toEqual(new Set([PHASE_ALPHA]));
    for (let left = 0; left < PHASE_WARN_TICKS; left++) {
      expect(ghostLook(active(left), true).tint).toBe(COLORS.cyan);
    }
    expect(ghostLook(active(PHASE_WARN_TICKS), true).tint).toBeNull();
  });

  it("R6.7 reduced motion draws the tint and no blink in draw()", () => {
    const ctx = fakeCtx();
    draw(ctx, active(10), SPRITE, { reducedMotion: true });
    expect(spriteCalls(ctx)[0].alpha).toBe(0.5);
    expect(
      ctx.calls.some((c) => c.op === "fill" && c.fillStyle === COLORS.cyan),
    ).toBe(true);
  });

  it("is full opacity with no outline when ready or cooling down", () => {
    expect(ghostLook(state(), false)).toEqual({
      alpha: 1,
      outline: null,
      tint: null,
    });
    expect(
      ghostLook(state({ power: { mode: "cooldown", left: 30 } }), false).alpha,
    ).toBe(1);
  });
});

describe("shakeOffset (R6.7)", () => {
  const dead = (since) =>
    state({ mode: "dead", deadAt: 100, tick: 100 + since });

  it("shakes right after death when motion is allowed", () => {
    expect(shakeOffset(dead(1), false).dx).not.toBe(0);
    expect(shakeOffset(dead(SHAKE_TICKS), false)).toEqual({ dx: 0, dy: 0 });
  });

  it("never shakes under reduced motion", () => {
    for (let s = 0; s < SHAKE_TICKS; s++)
      expect(shakeOffset(dead(s), true)).toEqual({ dx: 0, dy: 0 });
    const ctx = fakeCtx();
    draw(ctx, dead(1), SPRITE, { reducedMotion: true });
    for (const t of ctx.calls.filter((c) => c.op === "translate"))
      expect(t.args).toEqual([0, 0]);
  });

  it("never shakes while alive", () => {
    expect(shakeOffset(state(), false)).toEqual({ dx: 0, dy: 0 });
  });
});
