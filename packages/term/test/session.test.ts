import { describe, expect, it } from "vitest";
import { Session, parseKeys, type Effect } from "../src/session.js";
import {
  fakeSource,
  replaySession,
  settle,
  stateOf,
  T0,
  plain,
  threeThreads,
  World,
  actors,
} from "./helpers.js";

describe("parseKeys", () => {
  it("reads arrows, CRLF, backspace and plain chars (telnet and xterm)", () => {
    expect(parseKeys("\x1b[A\x1b[B\x1bOC\x1b[D")).toEqual([
      "up",
      "down",
      "right",
      "left",
    ]);
    expect(parseKeys("a\r\n\x7fb\x1b")).toEqual([
      "a",
      "enter",
      "backspace",
      "b",
      "esc",
    ]);
  });
});

describe("navigation", () => {
  it("login → any key → tree; letters open screens; Esc goes back; Esc on the tree shows the menu", () => {
    const t = replaySession(threeThreads());
    t.session.paint();
    expect(t.last()).toContain("Press any key");
    t.session.key("x");
    expect(t.last()).toContain("boards tree");
    t.session.key("s");
    expect(t.last()).toContain("Sysop queue");
    t.session.key("\x1b");
    expect(t.last()).toContain("boards tree");
    t.session.key("\x1b");
    expect(t.last()).toContain("[B]oards");
    t.session.key("t");
    expect(t.last()).toContain("boards tree");
  });
  it("boards → threads → thread with Enter", () => {
    const t = replaySession(threeThreads());
    t.session.key("x");
    t.advance(60_000);
    t.session.key("b\x1b[B\r\r");
    expect(t.last()).toContain("slides-pitch");
    expect(t.last()).toContain("Six slides");
  });
  it("[G]oodbye shows NO CARRIER, plays the click and closes", () => {
    const t = replaySession(threeThreads());
    t.session.key("x");
    t.session.key("m"); // sound on
    t.session.key("g");
    expect(t.last()).toContain("NO CARRIER");
    expect(t.effects).toContainEqual({ kind: "sound", name: "nocarrier" });
    expect(t.effects).toContainEqual({ kind: "close" });
  });
  it("[Enter] on a game launches it; on a deck opens the deck viewer", () => {
    const t = replaySession(threeThreads());
    t.advance(60_000);
    t.session.key("x");
    t.session.key("d\r");
    expect(t.effects).toContainEqual({
      kind: "open",
      url: "/published/games/snake/index.html",
    });
    t.session.key("\x1b[B\r");
    expect(t.last()).toContain("Deck pitch");
  });
});

describe("sound is off until the user turns it on; [M] toggles (R5.3)", () => {
  it("is muted by default and [M] switches it", () => {
    const t = replaySession(threeThreads());
    t.advance(60_000); // the replay plays all events; the ASK would ring the bell
    expect(t.effects.filter((e) => e.kind === "sound")).toEqual([]);
    t.session.key("m");
    expect(t.last()).toContain("sound on");
    t.session.key("m");
    expect(t.last()).toContain("sound off");
  });
});

describe("R5.4 the ??? bell tolls until answered", () => {
  const bells = (e: Effect[]) =>
    e.filter((x) => x.kind === "sound" && x.name === "bell").length;
  it("rings on the ASK, then every 60 s while it is unanswered", () => {
    const t = replaySession(threeThreads());
    t.session.key("m"); // unmute (this key also leaves the login screen)
    t.advance(30_000);
    expect(bells(t.effects)).toBe(1);
    t.advance(30_000);
    expect(bells(t.effects)).toBe(1);
    t.advance(30_000);
    expect(bells(t.effects)).toBe(2);
    t.advance(60_000);
    expect(bells(t.effects)).toBe(3);
  });
  it("stops once the Sysop has answered", () => {
    const w = threeThreads();
    const ask = w.events.find((e) => e.type === "ASK")!;
    w.must({
      type: "post",
      actor: actors.sysop,
      thread_id: "websites-landing",
      kind: "ANSWER",
      body: { text: "A", ask_id: ask.id },
    });
    const t = replaySession(w);
    t.session.key("m");
    t.advance(3_600_000);
    t.advance(120_000);
    t.advance(120_000);
    expect(bells(t.effects)).toBeLessThanOrEqual(1);
    expect(bells(t.effects)).toBe(1);
  });
});

describe("R5.2 reduced motion renders no animation frames", () => {
  it("needs no ticks and writes nothing as time passes", () => {
    const w = threeThreads();
    const t = replaySession(w, { reducedMotion: true });
    t.advance(60_000); // play the whole log; an ASK is open, the lantern would flicker
    t.session.key("x");
    t.session.key("s");
    expect(t.session.needsTick()).toBe(false);
    const n = t.out.length;
    for (let i = 0; i < 20; i++) t.advance(100);
    expect(t.out.length).toBe(n);
  });
  it("with motion on, the same idle screen keeps animating (lantern, fog)", () => {
    const t = replaySession(threeThreads());
    t.advance(60_000); // the ASK is now open, so the lantern flickers
    t.session.key("x");
    t.session.key("s");
    expect(t.session.needsTick()).toBe(true);
    const n = t.out.length;
    for (let i = 0; i < 20; i++) t.advance(100);
    expect(t.out.length).toBeGreaterThan(n);
  });
});

describe("R1.6 Sysop actions", () => {
  const goSysop = () => {
    const f = fakeSource(stateOf(threeThreads()));
    const out: string[] = [];
    const s = new Session({
      source: f.src,
      write: (x) => out.push(x),
      reducedMotion: true,
      now: () => T0,
    });
    s.key("xs");
    return { ...f, s, out };
  };
  it("[A] types an answer, Enter sends it, Esc cancels", async () => {
    const { s, acts } = goSysop();
    s.key("aBlood\x7fd red\r");
    await settle();
    expect(acts).toEqual([
      {
        type: "answer",
        thread: "websites-landing",
        ask: expect.any(String),
        text: "Blood red",
      },
    ]);
    s.key("ax\x1b");
    await settle();
    expect(acts).toHaveLength(1);
  });
  it("[P] approves and [N] denies", async () => {
    const { s, acts } = goSysop();
    s.key("pn");
    await settle();
    expect(acts.map((a) => a.type)).toEqual(["approve", "answer"]);
    expect(acts[1]).toMatchObject({ text: "deny" });
  });
});

describe("R3.3 / task 23 [X] force done is refused with the voice line", () => {
  it("replay: running → done shows ACCESS DENIED · ILLEGAL_TRANSITION, plays the organ, any key closes it", async () => {
    const t = replaySession(threeThreads());
    t.session.key("x");
    t.session.key("m"); // sound on
    t.advance(60_000);
    t.session.key("b\x1b[B\r\r"); // boards → #slides → slides-pitch (running)
    t.session.key("x");
    await settle();
    expect(t.last()).toContain(
      "ACCESS DENIED · ILLEGAL_TRANSITION  running → done",
    );
    expect(t.last()).toContain(
      "Not even the Sysop may raise the dead without a review.",
    );
    expect(t.effects).toContainEqual({ kind: "sound", name: "organ" });
    t.session.key("q");
    expect(t.last()).not.toContain("ACCESS DENIED");
  });
  it("a read-only replay refuses answers with ROLE_DENIED", async () => {
    const t = replaySession(threeThreads());
    t.advance(60_000);
    t.session.key("xs\rp"); // enter, sysop queue, open thread, [P]
    await settle();
    expect(t.last()).toContain("ROLE_DENIED");
  });
});

describe("replay controls (task 21)", () => {
  it("shows the REPLAY badge with run id; Space pauses; 5 and 2 set ×5 / ×20; arrows step", () => {
    const t = replaySession(threeThreads());
    t.session.key("x");
    expect(t.last()).toContain("REPLAY ×1 — real log 2026-11-13-test-1");
    t.session.key("5");
    expect(t.last()).toContain("REPLAY ×5");
    t.session.key("2");
    expect(t.last()).toContain("REPLAY ×20");
    t.session.key(" ");
    expect(t.last()).toContain("paused");
    t.session.key("\x1b"); // off the tree, where ←/→ fold and open
    t.session.key("\x1b[C");
    expect(t.last()).toContain("1/22");
    t.session.key("\x1b[D");
    expect(t.last()).toContain("0/22");
  });
});

describe("unused", () => {
  it("World is importable", () => expect(new World().events).toEqual([]));
});

describe("Sysop [N] new task", () => {
  const start = (reply?: Parameters<typeof fakeSource>[1]) => {
    const f = fakeSource(stateOf(threeThreads()), reply);
    const out: string[] = [];
    const s = new Session({
      source: f.src,
      write: (x) => out.push(x),
      reducedMotion: true,
      now: () => T0,
    });
    s.key("x"); // leave login
    return { ...f, s, out, screen: () => plain(out.at(-1) ?? "") };
  };
  it("is listed on the menu and in the help line", () => {
    const { s, screen } = start();
    expect(screen()).toContain("N new task");
    s.key("\x1b"); // tree → menu
    expect(screen()).toContain("[N]ew task");
  });
  it("asks board, title and body, then sends create_task with a thread id", async () => {
    const { s, acts, screen } = start();
    s.key("n");
    expect(screen()).toContain("Board  [arcade");
    s.key("websites\rFix the moat!\rDeep water\x13");
    await settle();
    expect(acts).toEqual([
      {
        type: "createTask",
        thread: "websites-fix-the-moat",
        text: "Fix the moat! — Deep water",
      },
    ]);
    expect(screen()).toContain("Created websites-fix-the-moat (pending).");
  });
  it("defaults the board, skips an empty body and avoids an existing thread id", async () => {
    const { s, acts } = start();
    s.key("n\rLanding\x13"); // arcade-landing, no body
    s.key("n\rSnake\x13"); // arcade-snake exists -> arcade-snake-2
    await settle();
    expect(acts.map((a) => a.type === "createTask" && a.thread)).toEqual([
      "arcade-landing",
      "arcade-snake-2",
    ]);
  });
  it("Esc, an empty title or a bad board creates nothing", async () => {
    const { s, acts, screen } = start();
    s.key("n\x1b");
    s.key("n\r\x13");
    expect(screen()).toContain("A title is needed");
    s.key("\x1b"); // nothing typed: closes
    s.key("nbad board\x13");
    expect(screen()).toContain("letters and digits only");
    await settle();
    expect(acts).toEqual([]);
  });
  it("shows the refusal when the server says no", async () => {
    const { s, screen } = start({
      ok: false,
      error: {
        code: "ROLE_DENIED",
        message: "nope",
        hint: "h",
        voice: "v",
      },
    });
    s.key("n\rTitle\x13");
    await settle();
    expect(screen()).toContain("ACCESS DENIED");
    expect(screen()).toContain("ROLE_DENIED");
  });
});
