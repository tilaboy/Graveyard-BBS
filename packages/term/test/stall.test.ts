import { describe, expect, it } from "vitest";
import { render } from "../src/screens.js";
import { STALL_MS, shownStatus, stalledMin } from "../src/state.js";
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

describe("a top task shows its stages; finished agents leave Who's online", () => {
  const sysop = { handle: "sysop", role: "sysop" as const };
  function world(stageTo: "running" | "done") {
    const w = new World();
    w.must({
      type: "create_task",
      actor: sysop,
      thread_id: "arcade-ghost",
      text: "Ghost",
    });
    w.start("arcade-ghost-build", actors.b1, "build: Ghost");
    // The stage hangs off the top task.
    const s0 = stateOf(w);
    s0.p.tasks["arcade-ghost-build"]!.parent = "arcade-ghost";
    if (stageTo === "done") s0.p.tasks["arcade-ghost-build"]!.status = "done";
    // An hour later: nobody is online by recent activity.
    return { ...s0, now: s0.now + 3_600_000 };
  }

  it("the pending top task shows running while a stage runs, done when all are done", () => {
    const run = world("running");
    expect(shownStatus(run, run.p.tasks["arcade-ghost"]!)).toBe("running");
    const done = world("done");
    expect(shownStatus(done, done.p.tasks["arcade-ghost"]!)).toBe("done");
    expect(done.p.tasks["arcade-ghost"]!.status).toBe("pending"); // display only
  });

  it("Who's online keeps working agents and counts the finished ones", () => {
    const run = plain(
      render(world("running"), viewOf({ screen: "who", cols: 140 })),
    );
    expect(run).toContain(actors.b1.handle);
    const done = plain(
      render(world("done"), viewOf({ screen: "who", cols: 140 })),
    );
    expect(done).not.toContain(`  ${actors.b1.handle}`);
    expect(done).toMatch(/1 finished agent laid to rest/);
  });
});
