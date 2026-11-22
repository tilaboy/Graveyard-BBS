import { describe, expect, it } from "vitest";
import { STATUSES } from "@graveyard/core";
import { render } from "../src/screens.js";
import { COLOR, EMOJI } from "../src/theme.js";
import {
  actors,
  frame,
  plain,
  stateOf,
  threeThreads,
  viewOf,
  World,
} from "./helpers.js";

const w = threeThreads();
const s = stateOf(w);
const still = { reducedMotion: true } as const;

describe("snapshots: every screen (task 9)", () => {
  const screens = [
    ["login", {}],
    ["menu", {}],
    ["boards", {}],
    ["threads", { board: "websites" }],
    ["thread", { thread: "websites-landing" }],
    ["thread", { thread: "arcade-snake" }],
    ["who", {}],
    ["sysop", {}],
    ["doors", {}],
    ["bulletins", {}],
    ["log", {}],
    ["deck", {}],
    ["bye", {}],
  ] as const;
  for (const [screen, extra] of screens)
    it(`${screen} ${"thread" in extra ? extra.thread : ""}`, () => {
      const st =
        screen === "bulletins"
          ? {
              ...s,
              lessons: [
                {
                  text: "Validate email on the server.",
                  tags: ["forms"],
                  project: "graveyard-bbs",
                  board: "websites",
                  thread: "websites-landing",
                },
              ],
            }
          : s;
      expect(
        plain(render(st, viewOf({ screen, reducedMotion: true, ...extra }))),
      ).toMatchSnapshot();
    });
});

describe("R5.1 / R4.1 themed lines keep their plain fact", () => {
  it("the thread list shows emoji AND status name for every status (cancelled is hidden)", () => {
    const st = {
      ...s,
      p: {
        ...s.p,
        tasks: Object.fromEntries(
          STATUSES.map((status, i) => [
            `websites-${i}`,
            {
              ...s.p.tasks["websites-landing"]!,
              thread_id: `websites-${i}`,
              status,
            },
          ]),
        ),
      },
    };
    const out = frame(st, { screen: "threads", board: "websites", ...still });
    for (const status of STATUSES.filter((x) => x !== "cancelled"))
      expect(out).toContain(status);
    expect(out).not.toContain("cancelled");
    for (const e of [
      EMOJI.pending,
      EMOJI.running,
      EMOJI.blocked,
      EMOJI.review,
      EMOJI.done,
    ])
      expect(out).toContain(e);
  });
  it("live badges: the same thread shows its new status after an event", () => {
    const w2 = threeThreads();
    const before = frame(stateOf(w2), {
      screen: "threads",
      board: "slides",
      ...still,
    });
    expect(before).toContain("running");
    w2.must({
      type: "set_status",
      actor: actors.b1,
      thread_id: "slides-pitch",
      to: "awaiting-review",
      gate_ok: false,
    });
    expect(
      frame(stateOf(w2), { screen: "threads", board: "slides", ...still }),
    ).toContain("awaiting-review");
  });
  it("blocked rows show the reason, the sysop queue shows the ASK text", () => {
    expect(
      frame(s, { screen: "threads", board: "websites", ...still }),
    ).toContain("blocked");
    expect(
      frame(s, { screen: "threads", board: "websites", ...still }),
    ).toMatch(/ask:e\d+/);
    expect(frame(s, { screen: "sysop", ...still })).toContain(
      "Dark theme or blood-red?",
    );
  });
  it("EVIDENCE renders plain with its exit code; ANSWER quotes the ASK with >", () => {
    const w2 = threeThreads();
    w2.evidence("websites-landing", "run_tests", 1);
    const ask = w2.events.find((e) => e.type === "ASK")!;
    w2.must({
      type: "post",
      actor: actors.sysop,
      thread_id: "websites-landing",
      kind: "ANSWER",
      body: { text: "B, blood-red", ask_id: ask.id },
    });
    const out = frame(stateOf(w2), {
      screen: "thread",
      thread: "websites-landing",
      ...still,
    });
    expect(out).toContain("[exit 1]");
    expect(out).toContain("door run_tests");
    expect(out).toContain("> ❓🦇 Dark theme or blood-red?");
    expect(out).toContain("B, blood-red");
  });
  it("lock events show the fencing token and queue place", () => {
    const w2 = new World();
    w2.start("websites-a", actors.b1, "a");
    w2.start("websites-b", actors.b2, "b");
    w2.must({
      type: "claim",
      actor: actors.b1,
      thread_id: "websites-a",
      lock: "deploy",
    });
    w2.must({
      type: "claim",
      actor: actors.b2,
      thread_id: "websites-b",
      lock: "deploy",
    });
    const out = frame(stateOf(w2), { screen: "doors", ...still });
    expect(out).toMatch(/fencing token #1/);
    expect(out).toContain("Door busy — you are #1");
    expect(frame(stateOf(w2), { screen: "who", ...still })).toContain(
      "deploy queue #1",
    );
  });
  it("the login screen counts bulletins (R4.6)", () => {
    expect(
      frame({ ...s, lessons: [] }, { screen: "login", ...still }),
    ).toContain("Bulletins: 0 new lessons");
  });
});

describe("R1.8 / R4.2 ACCESS DENIED", () => {
  it("shows code, transition, fact and the voice line", () => {
    const out = frame(s, {
      screen: "thread",
      thread: "slides-pitch",
      ...still,
      denied: {
        transition: "running → done",
        error: {
          code: "ILLEGAL_TRANSITION",
          message: "running → done is not allowed",
          hint: "Submit for review.",
          voice: "Not even the Sysop may raise the dead without a review.",
        },
      },
    });
    expect(out).toContain("ACCESS DENIED · ILLEGAL_TRANSITION  running → done");
    expect(out).toContain("running → done is not allowed");
    expect(out).toContain(
      "Not even the Sysop may raise the dead without a review.",
    );
    expect(out).toContain("hint: Submit for review.");
  });
});

describe("motion (task 16)", () => {
  it("reduced motion: every time gives the same frame", () => {
    const at = (now: number) =>
      render(
        s,
        viewOf({
          screen: "sysop",
          reducedMotion: true,
          now,
          fx: { "post:3": 0, login: 0 },
        }),
      );
    expect(at(0)).toBe(at(777));
    expect(at(0)).toBe(at(123456));
  });
  it("motion: the lantern flickers, never faster than twice a second", () => {
    // The last row is the drifting fog; compare the rest.
    const at = (now: number) =>
      render(s, viewOf({ screen: "sysop", now }))
        .split("\r\n")
        .slice(0, -1)
        .join();
    expect(at(0)).not.toBe(at(500));
    expect(at(0)).toBe(at(499));
    expect(at(0)).toBe(at(1000));
  });
  it("new posts fade in like mist (dim first) and settle after 400 ms", () => {
    const seq = s.events.find((e) => e.type === "MILESTONE")!.seq;
    const at = (now: number) =>
      render(
        s,
        viewOf({
          screen: "thread",
          thread: "websites-landing",
          reducedMotion: false,
          now: 1000 + now,
          fx: { [`post:${seq}`]: 1000 },
        }),
      );
    expect(at(0)).toContain(`${COLOR.dim};`);
    expect(at(0)).not.toBe(at(450));
  });
  it("the login banner draws line by line and skips to full under reduced motion", () => {
    const lines = (now: number, reducedMotion: boolean) =>
      plain(
        render(
          s,
          viewOf({ screen: "login", reducedMotion, now, fx: { login: 0 } }),
        ),
      )
        .split("\r\n")
        .filter((l) => l.includes("║") || l.includes("╚═╝")).length;
    expect(lines(0, false)).toBeLessThan(lines(3000, false));
    expect(lines(0, true)).toBe(lines(3000, false));
  });
  it("a refusal shakes and flashes red for 300 ms, then stays red", () => {
    const denied = {
      transition: "x",
      error: {
        code: "ILLEGAL_TRANSITION",
        message: "m",
        hint: "h",
        voice: "v",
      },
    };
    const at = (now: number, reducedMotion = false) =>
      render(
        s,
        viewOf({
          screen: "menu",
          reducedMotion,
          now,
          denied,
          fx: { denied: 0 },
        }),
      );
    expect(at(10)).toContain(`${COLOR.error};${COLOR.inverse}`);
    expect(at(400)).not.toContain(COLOR.inverse);
    expect(at(10, true)).not.toContain(COLOR.inverse);
  });
});

describe("R3.1 posts render stripped", () => {
  it("ESC[2J and OSC in agent text never reach the screen", () => {
    const w2 = threeThreads();
    w2.must({
      type: "post",
      actor: actors.b1,
      thread_id: "slides-pitch",
      kind: "NOTE",
      body: { text: "hi \x1b[2J\x1b]0;pwned\x07there \x1b[31mred\x1b[0m" },
    });
    const raw = render(
      stateOf(w2),
      viewOf({ screen: "thread", thread: "slides-pitch", reducedMotion: true }),
    );
    expect(raw).not.toContain("\x1b[2J" + "\x1b]"); // only our own frame clear remains
    expect(raw).not.toContain("\x1b]");
    expect(raw).not.toContain("pwned\x07");
    expect(plain(raw)).toContain("hi there red");
    expect(raw.match(/\x1b\[2J/g)).toBeNull();
  });
});
