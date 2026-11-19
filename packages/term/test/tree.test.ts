import { describe, expect, it } from "vitest";
import { render } from "../src/screens.js";
import { Session } from "../src/session.js";
import { treeTasks, TREE_FILL } from "../src/state.js";
import { EMOJI } from "../src/theme.js";
import {
  actors,
  fakeSource,
  plain,
  stateOf,
  T0,
  threeThreads,
  viewOf,
  World,
} from "./helpers.js";

const pending = (w: World, thread: string) =>
  w.must({
    type: "create_task",
    actor: actors.mod,
    thread_id: thread,
    text: `Task ${thread}`,
  });

const ask = (w: World, thread: string) =>
  w.must({
    type: "post",
    actor: actors.b1,
    thread_id: thread,
    kind: "ASK",
    body: { text: "Which colour?" },
  });

describe("tree selection rule", () => {
  it("always shows needs-you and running, fills with the newest to 10, counts the rest", () => {
    const w = new World();
    w.start("websites-asker", actors.b1, "Needs the Sysop");
    ask(w, "websites-asker");
    for (let i = 1; i <= 12; i++) pending(w, `websites-p${i}`);
    w.start("websites-r1", actors.b2, "Running one");
    w.start("websites-r2", actors.b2, "Running two");
    const { tasks, more } = treeTasks(stateOf(w), "websites");
    expect(tasks.map((t) => t.thread_id)).toEqual([
      "websites-asker", // needs you first, even though it is the oldest
      "websites-r2",
      "websites-r1",
      "websites-p12",
      "websites-p11",
      "websites-p10",
      "websites-p9",
      "websites-p8",
      "websites-p7",
      "websites-p6",
    ]);
    expect(tasks).toHaveLength(TREE_FILL);
    expect(more).toBe(5);
  });

  it("shows every running task even past 10", () => {
    const w = new World();
    for (let i = 1; i <= 12; i++) w.start(`arcade-r${i}`, actors.b1, `R${i}`);
    pending(w, "arcade-later");
    const { tasks, more } = treeTasks(stateOf(w), "arcade");
    expect(tasks).toHaveLength(12);
    expect(tasks.every((t) => t.status === "running")).toBe(true);
    expect(more).toBe(1);
    expect(
      plain(
        render(stateOf(w), viewOf({ screen: "tree", reducedMotion: true })),
      ),
    ).toContain("… 1 more");
  });
});

describe("tree keys", () => {
  const start = () => {
    const state = stateOf(threeThreads());
    const f = fakeSource(state);
    const out: string[] = [];
    const s = new Session({
      source: f.src,
      write: (x) => out.push(x),
      reducedMotion: true,
      now: () => T0,
    });
    s.key("x"); // leave login: the tree is the start screen
    const screen = () => plain(out.at(-1) ?? "");
    const cursor = () =>
      screen()
        .split("\r\n")
        .find((l) => l.startsWith("▶ ")) ?? "";
    return { s, state, screen, cursor };
  };
  const DOWN = "\x1b[B";
  const RIGHT = "\x1b[C";
  const LEFT = "\x1b[D";

  it("opens on the tree with every board and task status", () => {
    const { screen, cursor } = start();
    expect(screen()).toContain("boards tree");
    for (const b of ["#arcade", "#slides", "#websites"])
      expect(screen()).toContain(b);
    expect(screen()).toContain("✅ done");
    expect(screen()).toContain("🔥 running");
    expect(cursor()).toContain("#arcade");
  });

  it("→ opens a task's posts, ← on a post folds its task, ← again goes to the board and folds it", () => {
    const { s, screen, cursor } = start();
    s.key(DOWN + RIGHT);
    expect(screen()).toContain("#1  20:00  moderator-1");
    s.key(DOWN);
    expect(cursor()).toContain("#1  20:00  moderator-1");
    s.key(LEFT);
    expect(cursor()).toContain("Small door game");
    expect(screen()).not.toContain("#1  20:00  moderator-1");
    s.key(LEFT);
    expect(cursor()).toContain("#arcade");
    s.key(LEFT);
    expect(screen()).not.toContain("Small door game");
    s.key(RIGHT);
    expect(screen()).toContain("Small door game");
  });

  it("Enter on a task opens the full thread; Esc returns to the tree on the same row", () => {
    const { s, screen, cursor } = start();
    s.key(DOWN + "\r");
    expect(screen()).toContain("turns left");
    s.key("\x1b");
    expect(screen()).toContain("boards tree");
    expect(cursor()).toContain("Small door game");
  });

  it("a live update keeps the cursor on the same task", () => {
    const { s, state, cursor } = start();
    s.key(DOWN);
    const w = threeThreads();
    pending(w, "arcade-newer");
    Object.assign(state, stateOf(w));
    s.paint();
    expect(cursor()).toContain("Small door game");
  });
});

describe("needs-you monster", () => {
  const s = stateOf(threeThreads()); // websites-landing has an open ASK
  const row = (o: { reducedMotion: boolean; now: number }) =>
    render(s, viewOf({ screen: "tree", ...o }))
      .split("\r\n")
      .find((l) => l.includes("Haunted landing page")) ?? "";

  it("reduced motion: a still monster and the highlight, no blink", () => {
    const a = row({ reducedMotion: true, now: T0 });
    const b = row({ reducedMotion: true, now: T0 + 777 });
    expect(a).toBe(b);
    expect(plain(a)).toContain(`${EMOJI.monster}`);
    expect(plain(a)).toContain("needs you");
    expect(a).toContain("\x1b[93;1m"); // candle yellow, bold
    expect(a).not.toContain("\x1b[93;7m");
  });

  it("motion: the monster crawls and the row blinks", () => {
    const a = row({ reducedMotion: false, now: 0 });
    const b = row({ reducedMotion: false, now: 500 });
    expect(plain(a).indexOf(EMOJI.monster)).not.toBe(
      plain(b).indexOf(EMOJI.monster),
    );
    expect(a).toContain("\x1b[93;7m"); // inverse while lit
    expect(b).not.toContain("\x1b[93;7m");
  });

  it("snapshot", () => {
    expect(
      plain(render(s, viewOf({ screen: "tree", reducedMotion: true }))),
    ).toMatchSnapshot();
  });
});

describe("stage threads sit under their task", () => {
  const world = () => {
    const w = new World();
    pending(w, "arcade-bat");
    w.must({
      type: "create_task",
      actor: actors.mod,
      thread_id: "arcade-bat-build",
      text: "build: bat",
      parent: "arcade-bat",
    });
    w.must({
      type: "create_task",
      actor: actors.mod,
      thread_id: "mod-cursor",
      text: "Moderator cursor (system)",
    });
    return w;
  };

  it("a child is not its own top-level row, and the system cursor board is hidden", () => {
    const s = stateOf(world());
    expect(treeTasks(s, "arcade").tasks.map((t) => t.thread_id)).toEqual([
      "arcade-bat",
    ]);
    const text = plain(render(s, viewOf({ screen: "tree", cols: 120 })));
    expect(text).not.toContain("#mod");
    expect(text).toContain("#arcade  (1)");
    expect(text).toContain("+1"); // folded parent says it has a child
  });

  it("opening the task shows the child one level deeper", () => {
    const s = stateOf(world());
    const text = plain(
      render(
        s,
        viewOf({
          screen: "tree",
          cols: 120,
          tree: { open: { "t:arcade-bat": true }, at: "t:arcade-bat" },
        }),
      ),
    );
    const lines = text.split("\n");
    const parent = lines.findIndex((l) => l.includes("Task arcade-bat"));
    const child = lines.findIndex(
      (l) => l.includes("└") && l.includes("build: bat"),
    );
    expect(parent).toBeGreaterThan(-1);
    expect(child).toBeGreaterThan(parent);
  });
});
