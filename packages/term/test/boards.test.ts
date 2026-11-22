import { readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { render } from "../src/screens.js";
import { Session } from "../src/session.js";
import { BOARDS, threadsOf } from "../src/state.js";
import {
  actors,
  fakeSource,
  plain,
  stateOf,
  T0,
  viewOf,
  World,
} from "./helpers.js";

const STEERING = resolve(import.meta.dirname, "../../../.kiro/steering/boards");

describe("the five boards", () => {
  it("match the board steering files (one pipeline each)", () => {
    const files = readdirSync(STEERING)
      .filter((f) => f.endsWith(".md"))
      .map((f) => f.slice(0, -3))
      .sort();
    expect([...BOARDS].sort()).toEqual(files);
    expect(join(STEERING)).toBeTruthy();
  });

  it("the tree shows all five even when empty, and hides unknown boards and cancelled tasks", () => {
    const w = new World();
    w.must({
      type: "create_task",
      actor: actors.mod,
      thread_id: "games-invaders",
      text: "Invaders",
    });
    w.must({
      type: "create_task",
      actor: actors.mod,
      thread_id: "arcade-gone",
      text: "Gone",
    });
    w.must({
      type: "set_status",
      actor: { handle: "sysop", role: "sysop" },
      thread_id: "arcade-gone",
      to: "cancelled",
      reason: "test",
      gate_ok: false,
    });
    const s = stateOf(w);
    expect(threadsOf(s)).toEqual([]);
    const tree = plain(
      render(s, viewOf({ screen: "tree", cols: 120, rows: 40 })),
    );
    for (const b of BOARDS) expect(tree).toContain(`#${b}`);
    expect(tree).toContain("#media  (0)");
    expect(tree).not.toContain("idle");
    expect(tree).not.toContain("#games");
    expect(tree).not.toContain("Gone");
  });

  it("Enter or → on an empty board says 'No tasks yet. Press N.'", () => {
    for (const k of ["\r", "\x1b[C"]) {
      const f = fakeSource(stateOf(new World()));
      const out: string[] = [];
      const s = new Session({
        source: f.src,
        write: (x) => out.push(x),
        reducedMotion: true,
        now: () => T0,
      });
      s.key("x"); // login → tree, cursor on #arcade
      s.key(k);
      expect(plain(out.at(-1) ?? "")).toContain("No tasks yet. Press N.");
      expect(s.view.screen).toBe("tree");
    }
  });
});
