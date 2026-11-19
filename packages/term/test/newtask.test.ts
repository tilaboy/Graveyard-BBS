import { describe, expect, it } from "vitest";
import { FLASH_MS, Session, parseKeys } from "../src/session.js";
import {
  fakeSource,
  plain,
  settle,
  stateOf,
  T0,
  threeThreads,
  World,
} from "./helpers.js";

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
});

describe("[N] new task works wherever the help line says so", () => {
  it("on the login splash: the key enters the menu AND opens the prompt (was swallowed)", () => {
    const { s, screen } = start();
    s.key("N");
    expect(screen()).toContain("New task: board [");
  });
  it.each(["n", "N"])("accepts %s on the menu", (k) => {
    const { s, screen } = start();
    s.key("x");
    s.key(k);
    expect(screen()).toContain("New task: board [");
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
    expect(screen()).toContain("New task: board [");
  });
  it("on a board's thread list it defaults to that board", () => {
    const { s, screen } = start();
    s.key("xb\r");
    s.key("n");
    expect(screen()).toMatch(/New task: board \[(websites|arcade)\]/);
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
    expect(plain(out.at(-1) ?? "")).toContain("New task: board [");
  });
});

describe("new task: a board that does not exist yet", () => {
  it("creates <newboard>-<slug>, so the board appears with its first thread", async () => {
    const { s, acts, screen } = start();
    s.key("N"); // from login
    s.key("Crypts\rDig the grave\rWith a spade\r");
    await settle();
    expect(acts).toEqual([
      {
        type: "createTask",
        thread: "crypts-dig-the-grave",
        text: "Dig the grave — With a spade",
      },
    ]);
    expect(screen()).toContain("Created crypts-dig-the-grave (pending).");
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
    s.key("\r"); // default board
    for (const c of "Ghost") s.key(c);
    s.key("\r");
    s.key("\r"); // no body
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
