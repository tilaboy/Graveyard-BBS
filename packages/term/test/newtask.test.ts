import { describe, expect, it } from "vitest";
import { FLASH_MS, Session, parseKeys } from "../src/session.js";
import { boardNames } from "../src/state.js";
import {
  fakeSource,
  plain,
  settle,
  stateOf,
  T0,
  threeThreads,
  World,
} from "./helpers.js";

const FORM = "New task · whisper it to the crypt";

const start = () => {
  const f = fakeSource(stateOf(threeThreads()));
  const out: string[] = [];
  const s = new Session({
    source: f.src,
    write: (x) => out.push(x),
    reducedMotion: true,
    now: () => T0,
  });
  return { ...f, s, screen: () => plain(out.at(-1) ?? "") };
};

describe("web client key mapping (xterm onData -> Session)", () => {
  it("passes upper and lower case letters through unchanged", () => {
    expect(parseKeys("nN")).toEqual(["n", "N"]);
  });
  it("splits a paste and keeps UTF-8 characters whole", () => {
    expect(parseKeys("Fix 🦇\r")).toEqual(["F", "i", "x", " ", "🦇", "enter"]);
  });
  it("maps Enter, Esc, Backspace and arrows from xterm", () => {
    expect(parseKeys("\r\x1b\x7f\x1b[A")).toEqual([
      "enter",
      "esc",
      "backspace",
      "up",
    ]);
  });
  it("maps Tab, Shift+Tab and Ctrl+S (the form keys)", () => {
    expect(parseKeys("\t\x1b[Z\x13")).toEqual(["tab", "shift-tab", "ctrl-s"]);
  });
});

describe("[N] new task works wherever the help line says so", () => {
  it("on the login splash: the key enters the tree AND opens the form", () => {
    const { s, screen } = start();
    s.key("N");
    expect(screen()).toContain(FORM);
    expect(screen()).toContain("boards tree");
  });
  it.each(["n", "N"])("accepts %s on the tree", (k) => {
    const { s, screen } = start();
    s.key("x");
    s.key(k);
    expect(screen()).toContain(FORM);
  });
  it.each([
    ["boards", "b"],
    ["who", "w"],
    ["doors", "d"],
    ["log", "l"],
    ["bulletins", "u"],
  ])("on the %s screen, and the help line says so", (_n, key) => {
    const { s, screen } = start();
    s.key("x");
    s.key(key);
    expect(screen()).toContain("N new task");
    s.key("N");
    expect(screen()).toContain(FORM);
  });
  it("on a board's thread list it defaults to that board", async () => {
    const { s, acts } = start();
    s.key("xb\r");
    s.key("n\tGhost\x13");
    await settle();
    expect(acts[0]).toMatchObject({ thread: "arcade-ghost" });
  });
  it("on the Sysop queue and a thread with an open ASK, N still denies", async () => {
    const { s, acts } = start();
    s.key("xs");
    s.key("N");
    await settle();
    expect(acts[0]).toMatchObject({ type: "answer", text: "deny" });
  });
  it("on a thread with no open ASK, N starts a new task and the help line shows it", () => {
    const w = new World();
    w.start(
      "websites-calm",
      {
        handle: "builder-1",
        role: "builder",
      },
      "Calm",
    );
    const f = fakeSource(stateOf(w));
    const out: string[] = [];
    const s = new Session({
      source: f.src,
      write: (x) => out.push(x),
      reducedMotion: true,
      now: () => T0,
    });
    s.key("xb\r\r"); // boards -> threads -> thread
    expect(plain(out.at(-1) ?? "")).toContain("N new task");
    s.key("N");
    expect(plain(out.at(-1) ?? "")).toContain(FORM);
  });
});

describe("new-task form: a box with Board, Title, Body and [ Submit ]", () => {
  it("lists the five boards and shows the form keys", () => {
    const { s, screen } = start();
    s.key("xn");
    expect(screen()).toContain("#arcade #websites #slides #media #bugfix");
    expect(screen()).toContain("[ Submit ]");
    expect(screen()).toContain("Ctrl+S or Ctrl+Enter submit");
  });
  it("Tab order is Board → Title → Body → Submit → Board; Shift+Tab goes back", () => {
    const { s } = start();
    s.key("xn");
    const field = () => s.view.form?.field;
    expect(field()).toBe("board");
    const seen = [];
    for (let i = 0; i < 4; i++) {
      s.key("\t");
      seen.push(field());
    }
    expect(seen).toEqual(["title", "body", "submit", "board"]);
    s.key("\x1b[Z");
    expect(field()).toBe("submit");
  });
  it("Board is a picker: ↑↓ cycle auto and the five, a letter jumps, nothing else can be typed", () => {
    const { s } = start();
    s.key("xn"); // on the tree the form starts on auto
    expect(s.view.form?.board).toBe("auto");
    s.key("\x1b[B");
    expect(s.view.form?.board).toBe("arcade");
    s.key("\x1b[B");
    expect(s.view.form?.board).toBe("websites");
    s.key("\x1b[A\x1b[A");
    expect(s.view.form?.board).toBe("auto");
    s.key("\x1b[A");
    expect(s.view.form?.board).toBe("bugfix");
    s.key("m");
    expect(s.view.form?.board).toBe("media");
    s.key("S");
    expect(s.view.form?.board).toBe("slides");
    s.key("a"); // a letter jumps to a board, never back to auto
    expect(s.view.form?.board).toBe("arcade");
    s.key("s");
    s.key("qxz\x7f"); // letters no board starts with, and Backspace: no change
    expect(s.view.form?.board).toBe("slides");
  });
  it("Ctrl+S submits the exact text, a multi-line body keeps its newlines", async () => {
    const { s, acts } = start();
    s.key("xn");
    s.key("w\tFix the moat!\t");
    for (const k of "Deep water") s.key(k);
    s.key("\r");
    s.key("\r");
    for (const k of "- no sharks") s.key(k);
    s.key("\x13");
    await settle();
    expect(acts).toEqual([
      {
        type: "createTask",
        thread: "websites-fix-the-moat",
        text: "Fix the moat! — Deep water\n\n- no sharks",
      },
    ]);
  });
  it("a paste with newlines lands whole in Body", async () => {
    const { s, acts } = start();
    s.key("xna\tPasted\t"); // a: #arcade
    s.key("line one\rline two\r\rline four"); // xterm turns pasted \n into \r
    expect(s.view.form?.body).toBe("line one\nline two\n\nline four");
    s.key("\t\r"); // Tab to [ Submit ], Enter
    await settle();
    expect(acts[0]).toMatchObject({
      thread: "arcade-pasted",
      text: "Pasted — line one\nline two\n\nline four",
    });
  });
  it("Enter in Body is a new line, not a submit", async () => {
    const { s, acts } = start();
    s.key("xn\tTitle\t\r\r");
    await settle();
    expect(acts).toEqual([]);
    expect(s.view.form?.body).toBe("\n\n");
  });
  it("a long body scrolls inside the box and shows how much is hidden", () => {
    const { s, screen } = start();
    s.key("xn\tLong\t");
    s.key(Array.from({ length: 30 }, (_, i) => `row ${i}`).join("\r"));
    expect(screen()).toContain("row 29");
    expect(screen()).not.toContain("row 0 ");
    expect(screen()).toMatch(/↑ \d+ · ↓ 0 more/);
    for (let i = 0; i < 40; i++) s.key("\x1b[A");
    expect(screen()).toContain("row 0");
  });
  it("Esc with nothing typed closes at once", () => {
    const { s, screen } = start();
    s.key("xn\x1b");
    expect(s.view.form).toBeUndefined();
    expect(screen()).not.toContain(FORM);
  });
  it("Esc after typing asks 'discard?': any key keeps it, Y discards", async () => {
    const { s, acts, screen } = start();
    s.key("xn\tHalf done\x1b");
    expect(screen()).toContain("Discard this task?");
    s.key("x"); // keep editing
    expect(screen()).not.toContain("Discard this task?");
    expect(s.view.form?.title).toBe("Half done");
    s.key("\x1bY");
    expect(s.view.form).toBeUndefined();
    await settle();
    expect(acts).toEqual([]);
  });
  it("a board outside the five or an empty title shows an error inline and keeps the form", async () => {
    const { s, acts, screen } = start();
    s.key("xn");
    s.view.form!.board = "games"; // the picker cannot reach this; submit still refuses it
    s.key("\tTitle\x13");
    expect(screen()).toContain(
      "Pick one of: #arcade, #websites, #slides, #media, #bugfix.",
    );
    expect(s.view.form?.field).toBe("board");
    s.key("a\t"); // pick #arcade
    s.key("\x7f\x7f\x7f\x7f\x7f!!\x13");
    expect(screen()).toContain("A title is needed");
    expect(s.view.form?.field).toBe("title");
    await settle();
    expect(acts).toEqual([]);
  });
});

describe("new task: only the five boards", () => {
  it("typing a board name that does not exist cannot leave the five", async () => {
    const { s, acts, screen } = start();
    s.key("N"); // from login
    s.key("Games");
    expect(boardNames()).toContain(s.view.form?.board);
    s.key("\rDig the grave\rWith a spade\x13");
    await settle();
    expect(acts).toHaveLength(1);
    const thread = (acts[0] as { thread: string }).thread;
    expect(thread).not.toMatch(/^games-/);
    expect(boardNames()).toContain(thread.split("-")[0]);
    expect(screen()).toContain(`Created ${thread} (pending).`);
  });
});

describe("the 'Created … (pending).' notice clears itself", () => {
  it("is gone after FLASH_MS without any key press", async () => {
    const f = fakeSource(stateOf(threeThreads()));
    const out: string[] = [];
    let now = T0;
    const s = new Session({
      source: f.src,
      write: (x) => out.push(x),
      reducedMotion: false,
      now: () => now,
    });
    const screen = () => plain(out.at(-1) ?? "");
    s.key("x");
    s.key("n");
    s.key("a\t"); // #arcade
    for (const c of "Ghost") s.key(c);
    s.key("\x13");
    await settle();
    s.tick();
    expect(screen()).toContain("(pending).");
    now += FLASH_MS - 100;
    s.tick();
    expect(screen()).toContain("(pending).");
    now += 200;
    s.tick();
    expect(screen()).not.toContain("(pending).");
  });
});

// Issue #2 (https://github.com/tilaboy/Graveyard-BBS/issues/2): the board is chosen for the
// Sysop from the task's words, so a new task no longer needs a board picked first.
describe("new task: Board auto picks the board from the words", () => {
  it("starts on auto and shows the live guess with the words that chose it", () => {
    const { s, screen } = start();
    s.key("xn");
    expect(s.view.form?.board).toBe("auto");
    expect(screen()).toContain("auto → type a title");
    s.key("\tSnake game");
    expect(screen()).toContain("auto → #arcade (snake, game)");
  });
  it("submits on the guessed board and says which board and why", async () => {
    const { s, acts, screen } = start();
    s.key("xn\tPitch deck\tTen slides for demo day\x13");
    await settle();
    expect(acts).toEqual([
      {
        type: "createTask",
        thread: "slides-pitch-deck",
        text: "Pitch deck — Ten slides for demo day",
      },
    ]);
    expect(screen()).toContain("Created slides-pitch-deck (pending).");
    expect(screen()).toContain("Board #slides (auto: pitch, deck, slides).");
  });
  it("reads a GitHub issue link as #bugfix", async () => {
    const { s, acts } = start();
    s.key(
      "xn\tAddress Git Repo Issue 2\thttps://github.com/tilaboy/Graveyard-BBS/issues/2\x13",
    );
    await settle();
    expect(acts[0]).toMatchObject({
      thread: "bugfix-address-git-repo-issue-2",
    });
  });
  it("when no word fits, says so on Board and sends nothing", async () => {
    const { s, acts, screen } = start();
    s.key("xn\tDig the grave\x13");
    expect(screen()).toContain("auto → no board fits yet");
    expect(screen()).toContain(
      "No board fits these words. Pick one with ↑↓ or a letter.",
    );
    expect(s.view.form?.field).toBe("board");
    await settle();
    expect(acts).toEqual([]);
  });
  it("a board picked by hand wins over the words", async () => {
    const { s, acts } = start();
    s.key("xnm\tSnake game\x13"); // m: #media
    await settle();
    expect(acts[0]).toMatchObject({ thread: "media-snake-game" });
  });
});
