import { describe, expect, it } from "vitest";
import { pathSpans, pathsIn } from "../src/format.js";
import { Session } from "../src/session.js";
import type { FileContent } from "../src/source.js";
import {
  actors,
  fakeSource,
  plain,
  replaySession,
  settle,
  stateOf,
  T0,
  World,
} from "./helpers.js";

const DOWN = "\x1b[B";
const RIGHT = "\x1b[C";
const PGDN = "\x1b[6~";
const ESC = "\x1b";

const MILESTONE =
  "Spec written for Spacewar. Files: .kiro/specs/arcade-test/requirements.md, .kiro/specs/arcade-test/design.md, .kiro/specs/arcade-test/tasks.md. The build goes in games/test/.";
const SPEC = [
  ".kiro/specs/arcade-test/requirements.md",
  ".kiro/specs/arcade-test/design.md",
  ".kiro/specs/arcade-test/tasks.md",
  "games/test/",
];

function world(): World {
  const w = new World();
  w.start("arcade-test", actors.b1, "Spacewar");
  w.must({
    type: "post",
    actor: actors.b1,
    thread_id: "arcade-test",
    kind: "MILESTONE",
    body: { text: MILESTONE },
  });
  return w;
}

const FILES: Record<string, FileContent> = {
  ".kiro/specs/arcade-test/requirements.md": {
    kind: "file",
    path: ".kiro/specs/arcade-test/requirements.md",
    text: `# Requirements\n\x1b[31mred\x1b]0;title\x07\n${Array.from({ length: 80 }, (_, i) => `line ${i + 3}`).join("\n")}\n`,
  },
  "games/test/": {
    kind: "dir",
    path: "games/test",
    entries: ["assets/", "index.html"],
  },
  "games/test/index.html": {
    kind: "file",
    path: "games/test/index.html",
    text: "<h1>x</h1>",
  },
};

const start = () => {
  const f = fakeSource(stateOf(world()), { ok: true }, FILES);
  const out: string[] = [];
  const s = new Session({
    source: f.src,
    write: (x) => out.push(x),
    reducedMotion: true,
    now: () => T0,
    cols: 120,
    rows: 30,
  });
  s.key("x"); // login -> tree
  return { ...f, s, screen: () => plain(out.at(-1) ?? "") };
};

/** Tree: board, task, unfold, past its TASK and STATUS posts to the MILESTONE. */
const toMilestone = (s: Session) => {
  s.key(DOWN);
  s.key(RIGHT);
  s.key(`${DOWN}${DOWN}${DOWN}`);
};

describe("file paths in posts", () => {
  it("finds every path in the MILESTONE text, without trailing punctuation", () => {
    expect(pathsIn(MILESTONE)).toEqual(SPEC);
    const sp = pathSpans(MILESTONE)[0]!;
    expect(MILESTONE.slice(sp.start, sp.end)).toBe(SPEC[0]);
    expect(pathsIn("No paths here, just launch/view and 3/4.")).toEqual([]);
  });
});

describe("[O] open file", () => {
  it("on a tree post lists that post's paths; Enter opens the viewer; Esc returns", async () => {
    const { s, reads, screen } = start();
    toMilestone(s);
    s.key("o");
    for (const p of SPEC) expect(screen()).toContain(p);
    expect(screen()).toContain("Files named in arcade-test");
    s.key("\r");
    await settle();
    expect(reads).toEqual([{ thread: "arcade-test", path: SPEC[0] }]);
    const v = screen();
    expect(v).toContain("file viewer");
    expect(v).toMatch(/1 │ # Requirements/);
    expect(v).toMatch(/2 │ red/); // control sequences from the file are dropped
    expect(v).not.toContain("title");
    expect(v).toContain("PgUp PgDn");
    s.key(PGDN);
    expect(screen()).not.toMatch(/ 1 │ # Requirements/);
    s.key(ESC);
    expect(screen()).toContain("Files named in arcade-test");
    s.key(ESC);
    expect(screen()).toContain("boards tree");
    expect(screen()).toContain("O open file");
  });

  it("a folder shows its listing; Enter opens an entry", async () => {
    const { s, reads, screen } = start();
    toMilestone(s);
    s.key("o");
    s.key(`${DOWN}${DOWN}${DOWN}\r`);
    await settle();
    expect(screen()).toContain("games/test/");
    expect(screen()).toContain("index.html");
    s.key(`${DOWN}\r`);
    await settle();
    expect(reads.at(-1)).toEqual({
      thread: "arcade-test",
      path: "games/test/index.html",
    });
    expect(screen()).toContain("1 │ <h1>x</h1>");
    s.key(ESC);
    expect(screen()).toContain("assets/");
  });

  it("on the full thread lists the thread's paths", () => {
    const { s, screen } = start();
    s.key(`${DOWN}\r`); // open the full thread
    expect(screen()).toContain("O open file");
    s.key("O");
    for (const p of SPEC) expect(screen()).toContain(p);
  });

  it("a post with no paths says so", () => {
    const { s, screen } = start();
    s.key(DOWN);
    s.key(RIGHT);
    s.key(DOWN); // the TASK post: "Spacewar"
    s.key("o");
    expect(screen()).toContain("No file paths in this post.");
  });

  it("a missing file opens the ACCESS DENIED box and stays put", async () => {
    const { s, screen } = start();
    toMilestone(s);
    s.key(`o${DOWN}\r`); // design.md is not in FILES
    await settle();
    expect(screen()).toContain("ACCESS DENIED · NOT_FOUND");
    s.key("q");
    expect(screen()).toContain("Files named in arcade-test");
  });

  it("a click on a path (openLink) opens it from the thread that names it", async () => {
    const { s, reads, screen } = start();
    expect(s.linkable()).toBe(true);
    s.openLink("games/test/");
    await settle();
    expect(reads).toEqual([{ thread: "arcade-test", path: "games/test/" }]);
    expect(screen()).toContain("index.html");
  });

  it("a replay refuses read-only with ACCESS DENIED", async () => {
    const r = replaySession(world(), { reducedMotion: true });
    r.advance(60_000);
    r.session.key("x");
    r.session.key(DOWN);
    r.session.key(RIGHT);
    r.session.key(`${DOWN}${DOWN}${DOWN}`);
    r.session.key("o\r");
    await settle();
    expect(r.last()).toContain("ACCESS DENIED · ROLE_DENIED");
    expect(r.last()).toContain("read-only replay");
  });
});
