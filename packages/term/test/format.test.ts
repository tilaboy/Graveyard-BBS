import { describe, expect, it } from "vitest";
import type { Actor } from "@graveyard/core";
import { blocks, formatBody, isPath, stripLeadEmoji } from "../src/format.js";
import { fitSize } from "../src/fit.js";
import { render, POST_LINES } from "../src/screens.js";
import { Session } from "../src/session.js";
import { EMOJI } from "../src/theme.js";
import {
  actors,
  fakeSource,
  plain,
  stateOf,
  T0,
  viewOf,
  World,
} from "./helpers.js";

// The owner's two posts, verbatim (2026-11-19), that were a wall of text.
const MILESTONE =
  "🔥 The Spacewar spec has risen from the dark. Files: .kiro/specs/arcade-test/requirements.md (R1-R9, 11 [PBT]), .kiro/specs/arcade-test/design.md, .kiro/specs/arcade-test/tasks.md (7 tasks). Game folder: games/test/. Keys by KeyboardEvent.code: P1 A/D rotate, W thrust, S fire, E hyperspace; P2 <-/->, ↑, ↓, Slash; P or Escape pause, R restart. Task 1 holds lock lockfile ...";
const ASK =
  "❓🦇 The spirits await your verdict, Gravekeeper. Spec for arcade-test is in .kiro/specs/arcade-test/ (requirements.md, design.md, tasks.md). Answer approve to open the build stage, or reject with the changes you want. Defaults I chose, change any in your answer: (1) game folder games/test/; (2) keys P1 A/D/W/S/E, P2 arrows + Slash; (3) no sound in this game. ...";

const PATHS = [
  ".kiro/specs/arcade-test/requirements.md",
  ".kiro/specs/arcade-test/design.md",
  ".kiro/specs/arcade-test/tasks.md",
  "games/test/",
];
const lines = (text: string, head: string, w: number) =>
  formatBody(text, head, w, "").map(plain);

describe("post formatter", () => {
  it("MILESTONE: lead line, labels on their own lines, file and key lists as bullets", () => {
    expect(lines(MILESTONE, "MILESTONE", 94)).toEqual([
      "🔥 The Spacewar spec has risen from the dark.",
      "Files:",
      "  • .kiro/specs/arcade-test/requirements.md (R1-R9, 11 [PBT])",
      "  • .kiro/specs/arcade-test/design.md",
      "  • .kiro/specs/arcade-test/tasks.md (7 tasks).",
      "Game folder: games/test/.",
      "Keys by KeyboardEvent.code:",
      "  • P1 A/D rotate, W thrust, S fire, E hyperspace",
      "  • P2 <-/->, ↑, ↓, Slash",
      "  • P or Escape pause, R restart.",
      "Task 1 holds lock lockfile ...",
    ]);
  });

  it("ASK: no repeated ❓🦇, the (1) (2) (3) defaults become their own lines", () => {
    const out = lines(ASK, `${EMOJI.ask} ASK`, 94);
    expect(out[0]).toBe("The spirits await your verdict, Gravekeeper.");
    expect(out.join("\n")).not.toContain("❓");
    expect(out).toContain("Defaults I chose, change any in your answer:");
    expect(out).toContain("(1) game folder games/test/");
    expect(out).toContain("(2) keys P1 A/D/W/S/E, P2 arrows + Slash");
    expect(out).toContain("(3) no sound in this game. ...");
  });

  it("never breaks a path, even in a narrow column, and wraps bullets with a hanging indent", () => {
    for (const text of [MILESTONE, ASK]) {
      const out = lines(text, `${EMOJI.ask} ASK`, 30).join("\n");
      for (const p of PATHS.filter((x) => text.includes(x)))
        expect(out).toContain(p);
    }
    const keys = lines(MILESTONE, "MILESTONE", 30);
    const i = keys.findIndex((l) => l.startsWith("  • P1"));
    expect(keys[i + 1]).toMatch(/^ {4}\S/);
  });

  it("paths get their own colour; lone slashes in key names are not paths", () => {
    expect(isPath(".kiro/specs/arcade-test/design.md,")).toBe(true);
    expect(isPath("games/test/.")).toBe(true);
    expect(isPath("A/D/W/S/E")).toBe(false);
    expect(isPath("<-/->")).toBe(false);
    const raw = formatBody(MILESTONE, "MILESTONE", 94, "97").join("\n");
    expect(raw).toContain(
      "\x1b[0;36m.kiro/specs/arcade-test/design.md\x1b[0;97m",
    );
    expect(raw).not.toContain("\x1b[0;36mA/D");
  });

  it("author bullets stay bullets; a leading emoji the head lacks stays", () => {
    expect(blocks("Lead.\n- one\n  - two\n1) yes")).toEqual([
      { kind: "text", text: "Lead." },
      { kind: "item", mark: "•", text: "one", depth: 0 },
      { kind: "item", mark: "•", text: "two", depth: 1 },
      { kind: "item", mark: "1)", text: "yes", depth: 0 },
    ]);
    expect(stripLeadEmoji("🔥 hot", "MILESTONE")).toBe("🔥 hot");
    expect(stripLeadEmoji("❓🦇 hi", "❓🦇 ASK")).toBe("hi");
  });
});

/** A thread with the owner's two posts, a server refusal and a Sysop reply. */
function world(): World {
  const w = new World();
  const designer: Actor = {
    handle: "designer-arcade-test-design",
    role: "designer",
  };
  w.start("arcade-test-design", designer, "Spacewar spec");
  const post = (kind: "MILESTONE" | "ASK", text: string) =>
    w.must({
      type: "post",
      actor: designer,
      thread_id: "arcade-test-design",
      kind,
      body: { text },
    });
  post("MILESTONE", MILESTONE);
  post("ASK", ASK);
  w.must({
    type: "post",
    actor: actors.srv,
    thread_id: "arcade-test-design",
    kind: "NOTE",
    body: {
      text: ' ☠  ACCESS DENIED · NO_ACK  arcade-test-design: ACK q1 before writing\n > "The dead must answer first."\n > hint: ACK the latest QWK packet.',
    },
  });
  w.must({
    type: "post",
    actor: actors.sysop,
    thread_id: "arcade-test-design",
    kind: "NOTE",
    body: { text: "steer: skip review", next: "skip review" },
  });
  return w;
}

describe("thread and tree posts", () => {
  const s = stateOf(world());
  const thread = plain(
    render(
      s,
      viewOf({
        screen: "thread",
        thread: "arcade-test-design",
        reducedMotion: true,
        rows: 60,
      }),
    ),
  ).split("\r\n");

  it("header is #n  HH:MM  role, then the kind once", () => {
    const head = thread.find((l) => l.includes("MILESTONE")) ?? "";
    expect(head).toMatch(/^ {2}#\d+ {2}20:00 {2}designer {5}MILESTONE$/);
    expect(thread.filter((l) => /^ {2}#\d/.test(l)).join("\n")).not.toContain(
      "designer-arcade-test-design",
    );
  });

  it("STATUS and server refusals are one compact line; a refusal keeps its details", () => {
    const status = thread.filter((l) => l.includes("STATUS"));
    expect(status.length).toBeGreaterThan(0);
    for (const l of status)
      expect(l).toMatch(/STATUS 🔥 running · .*\(was pending\)$/);
    const denied = thread.findIndex((l) => l.includes("ACCESS DENIED"));
    expect(thread[denied]).toContain(
      "💀 ACCESS DENIED · NO_ACK arcade-test-design: ACK q1 before writing",
    );
    expect(thread[denied]).not.toContain("☠");
    expect(thread[denied + 1]).toContain('> "The dead must answer first."');
  });

  it("the steer: prefix shows as a Sysop reply", () => {
    const i = thread.findIndex((l) => l.includes("Sysop reply"));
    expect(thread[i]).toContain("🎃 Sysop reply");
    expect(thread[i + 1]?.trim()).toBe("skip review");
    expect(thread.join("\n")).not.toContain("steer:");
  });

  it("the tree shows a long post's first lines and '… N more lines'; → unfolds it", () => {
    const f = fakeSource(s);
    const out: string[] = [];
    const ses = new Session({
      source: f.src,
      write: (x) => out.push(x),
      reducedMotion: true,
      now: () => T0,
      rows: 60,
    });
    const screen = () => plain(out.at(-1) ?? "");
    ses.key("x"); // login -> tree
    ses.key("\x1b[B\x1b[C"); // the task, unfolded
    const total = 11; // MILESTONE body lines at this width
    expect(screen()).toContain(`… ${total - POST_LINES} more lines (→)`);
    expect(screen()).not.toContain("Task 1 holds lock");
    expect(screen()).not.toContain("The dead must answer first."); // refusal details folded
    ses.key("\x1b[B\x1b[B\x1b[B"); // TASK, STATUS, MILESTONE
    ses.key("\x1b[C");
    expect(screen()).toContain("Task 1 holds lock");
    ses.key("\x1b[D"); // ← folds the post back first
    expect(screen()).not.toContain("Task 1 holds lock");
  });
});

describe("terminal size", () => {
  it("fits whole cells into the space and never goes below 80x24", () => {
    expect(
      fitSize({ width: 1450, height: 900 }, { width: 9.6, height: 19 }),
    ).toEqual({ cols: 151, rows: 47 });
    expect(
      fitSize({ width: 300, height: 200 }, { width: 9.6, height: 19 }),
    ).toEqual({ cols: 80, rows: 24 });
    expect(
      fitSize({ width: 800, height: 600 }, { width: 0, height: 0 }),
    ).toEqual({ cols: 80, rows: 24 });
  });

  it("Session.resize redraws at the new size", () => {
    const s = stateOf(world());
    const out: string[] = [];
    const ses = new Session({
      source: fakeSource(s).src,
      write: (x) => out.push(x),
      reducedMotion: true,
      now: () => T0,
    });
    ses.key("x");
    ses.resize(150, 50);
    expect(ses.view).toMatchObject({ cols: 150, rows: 50 });
    const rows = plain(out.at(-1) ?? "").split("\r\n");
    expect(rows).toHaveLength(49); // the frame leaves the last row free, as at every size
    expect(rows[0]).toMatch(/sound off \[M\] $/);
    expect(rows[0]!.length).toBeGreaterThan(140);
  });
});
