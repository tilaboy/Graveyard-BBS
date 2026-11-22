import { describe, expect, it } from "vitest";
import { createAudio, type AudioCtx } from "../src/audio.js";
import { Session, type Effect } from "../src/session.js";
import { fakeSource, stateOf, T0, threeThreads } from "./helpers.js";

/** A stand-in AudioContext: starts "suspended" like a browser before a gesture. */
function fakeCtx() {
  const log: string[] = [];
  const ctx = {
    state: "suspended" as AudioContextState,
    resume: async () => {
      log.push("resume");
      ctx.state = "running";
    },
    createBuffer: (_c: number, n: number) => ({
      length: n,
      copyToChannel: () => undefined,
    }),
    createBufferSource: () => {
      const node = {
        buffer: null as unknown,
        connect: (g: unknown) => g,
        start: () =>
          log.push(`start:${(node.buffer as { length: number }).length}`),
      };
      return node;
    },
    createGain: () => ({ gain: { value: 1 }, connect: (d: unknown) => d }),
    destination: {},
  };
  return { ctx: ctx as unknown as AudioCtx, log };
}

describe("[M] turns sound on and is heard at once", () => {
  it("unmute resumes the AudioContext, then plays the chime through the effect", () => {
    const { ctx, log } = fakeCtx();
    const audio = createAudio(() => ctx);
    const effects: Effect[] = [];
    const s = new Session({
      source: fakeSource(stateOf(threeThreads())).src,
      write: () => undefined,
      reducedMotion: true,
      now: () => T0,
      effect: (e) => {
        effects.push(e);
        // Same mapping as client.ts.
        if (e.kind === "unmute") audio.resume();
        else if (e.kind === "sound") audio.play(e.name);
      },
    });
    s.key("x"); // on the tree, where [M] used to stay silent
    expect(effects).toEqual([]);
    s.key("m");
    expect(effects).toEqual([
      { kind: "unmute" },
      { kind: "sound", name: "chime" },
    ]);
    expect(log[0]).toBe("resume");
    expect(log.some((l) => l.startsWith("start:"))).toBe(true);
    s.key("m"); // off again: nothing more plays
    expect(effects).toHaveLength(2);
  });
  it("a refused resume does not throw", async () => {
    const { ctx } = fakeCtx();
    ctx.resume = () => Promise.reject(new Error("not allowed"));
    const audio = createAudio(() => ctx);
    expect(() => audio.resume()).not.toThrow();
    await new Promise((r) => setTimeout(r, 0));
  });
});
