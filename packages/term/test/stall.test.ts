import { describe, expect, it } from "vitest";
import { render } from "../src/screens.js";
import { STALL_MS, stalledMin } from "../src/state.js";
import { actors, plain, stateOf, viewOf, World } from "./helpers.js";

/** One running task; `quietMs` is how long its owner has said nothing. */
function world(quietMs: number) {
  const w = new World();
  w.start("arcade-spacewar", actors.b1, "Spacewar");
  const s = stateOf(w);
  const last = s.p.callers[actors.b1.handle]!.last_at;
  return { ...s, now: last + quietMs };
}

describe("a running task with a silent owner says so", () => {
  it("is not stalled while the owner was heard recently", () => {
    const s = world(STALL_MS - 1000);
    expect(stalledMin(s, s.p.tasks["arcade-spacewar"]!)).toBeUndefined();
    const text = plain(render(s, viewOf({ screen: "tree", cols: 140 })));
    expect(text).not.toContain("stalled");
  });

  it("shows ⚠ stalled 52m on the tree, the thread and Who's online", () => {
    const s = world(52 * 60_000);
    expect(stalledMin(s, s.p.tasks["arcade-spacewar"]!)).toBe(52);
    const tree = plain(render(s, viewOf({ screen: "tree", cols: 140 })));
    expect(tree).toContain("⚠ stalled 52m");
    const thread = plain(
      render(
        s,
        viewOf({ screen: "thread", thread: "arcade-spacewar", cols: 140 }),
      ),
    );
    expect(thread).toContain("No agent is working on this");
    const who = plain(render(s, viewOf({ screen: "who", cols: 140 })));
    expect(who).toContain("⚠ stalled 52m");
  });

  it("long handles no longer run into the role column", () => {
    const s = world(0);
    const who = plain(render(s, viewOf({ screen: "who", cols: 140 })));
    expect(who).not.toMatch(/[a-z0-9]builder\b/);
  });
});
