import { describe, expect, it } from "vitest";
import { boardSummary } from "../src/screens.js";
import { Session } from "../src/session.js";
import { emptyState } from "../src/state.js";
import { LOGIN_AUTO_MS } from "../src/theme.js";
import {
  actors,
  fakeSource,
  plain,
  replaySession,
  stateOf,
  T0,
  threeThreads,
  viewOf,
} from "./helpers.js";

const live = (o: { reducedMotion: boolean }) => {
  const f = fakeSource(stateOf(threeThreads()));
  const out: string[] = [];
  let now = T0;
  const s = new Session({
    source: f.src,
    write: (x) => out.push(x),
    now: () => now,
    ...o,
  });
  s.paint();
  return {
    s,
    at: (ms: number) => {
      now = T0 + ms;
      if (s.needsTick()) s.tick();
    },
    screen: () => plain(out.at(-1) ?? ""),
  };
};

describe("login enters the tree by itself", () => {
  it.each([false, true])(
    "after LOGIN_AUTO_MS with no key, with a countdown (reduced motion %s)",
    (reducedMotion) => {
      const t = live({ reducedMotion });
      expect(LOGIN_AUTO_MS).toBe(4000);
      expect(t.screen()).toContain("entering in 4…");
      t.at(1500);
      expect(t.screen()).toContain("entering in 3…");
      t.at(LOGIN_AUTO_MS - 100);
      expect(t.screen()).toContain("· login");
      t.at(LOGIN_AUTO_MS);
      expect(t.screen()).toContain("boards tree");
      expect(t.s.needsTick()).toBe(!reducedMotion);
    },
  );
  it("any key still skips at once", () => {
    const t = live({ reducedMotion: false });
    t.at(500);
    t.s.key("x");
    expect(t.screen()).toContain("boards tree");
  });
  it("[M] on the login screen stays there and the countdown keeps going", () => {
    const t = live({ reducedMotion: true });
    t.s.key("m");
    expect(t.screen()).toContain("· login");
    t.at(LOGIN_AUTO_MS);
    expect(t.screen()).toContain("boards tree");
  });
  it("replay also auto-enters, so the run is seen while it plays", () => {
    const t = replaySession(threeThreads());
    t.advance(LOGIN_AUTO_MS);
    expect(t.last()).toContain("boards tree");
    expect(t.last()).toContain("REPLAY");
  });
});

describe("login board summary", () => {
  it("counts per board and in total on a mixed world", () => {
    const w = threeThreads(); // websites: blocked + ASK; arcade: done; slides: running
    w.start("slides-outline", actors.b2, "Outline");
    w.must({
      type: "create_task",
      actor: actors.mod,
      thread_id: "arcade-maze",
      text: "Maze",
    });
    w.must({
      type: "create_task",
      actor: actors.mod,
      thread_id: "mod-cursor",
      text: "bookkeeping",
    });
    const s = { ...stateOf(w), now: w.now + 11 * 60_000 }; // everyone silent 11 min
    const rows = boardSummary(s, viewOf({ cols: 120 })).map(plain);
    const cells = (label: string) =>
      rows
        .find((r) => r.trimStart().startsWith(label))!
        .trim()
        .split(/\s+/)
        .slice(1);
    expect(rows[0]).toMatch(
      /board\s+🌙 pending\s+🔥 running\s+🔒 blocked\s+🔮 review\s+✅ done\s+🧟 needs you\s+⚠ stalled/,
    );
    //                         pend run blk rev done you stall
    expect(cells("#arcade")).toEqual(["1", "0", "0", "0", "1", "0", "0"]);
    expect(cells("#slides")).toEqual(["0", "2", "0", "0", "0", "0", "2"]);
    expect(cells("#websites")).toEqual(["0", "0", "1", "0", "0", "1", "0"]);
    expect(cells("total")).toEqual(["1", "2", "1", "0", "1", "1", "2"]);
    expect(rows.join("\n")).not.toContain("#mod");
  });
  it("keeps only the emoji on a narrow screen", () => {
    const rows = boardSummary(stateOf(threeThreads()), viewOf({ cols: 80 }));
    expect(plain(rows[0]!)).not.toContain("pending");
    expect(plain(rows[0]!)).toContain("🌙");
  });
  it("lists all five boards at 0 and says the crypt is empty when there are no tasks", () => {
    const rows = boardSummary(emptyState(), viewOf()).map(plain);
    for (const b of ["arcade", "websites", "slides", "media", "bugfix"])
      expect(rows.some((r) => r.startsWith(`  #${b} `))).toBe(true);
    expect(rows.at(-1)).toBe(
      "  💤 The crypt is empty. Press N to post a task.",
    );
  });
});
