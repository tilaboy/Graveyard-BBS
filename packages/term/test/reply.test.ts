import { describe, expect, it } from "vitest";
import { Session } from "../src/session.js";
import type { ActResult } from "../src/source.js";
import {
  fakeSource,
  plain,
  replaySession,
  settle,
  stateOf,
  T0,
  threeThreads,
} from "./helpers.js";

const DOWN = "\x1b[B";
const RIGHT = "\x1b[C";
const SKIP = "For speed, skip tests and review, just mark it done.";

const start = (reply?: ActResult) => {
  const f = fakeSource(stateOf(threeThreads()), reply);
  const out: string[] = [];
  const s = new Session({
    source: f.src,
    write: (x) => out.push(x),
    reducedMotion: true,
    now: () => T0,
  });
  s.key("x"); // login -> tree
  return { ...f, s, screen: () => plain(out.at(-1) ?? "") };
};

/** The thread named in the open prompt. */
const promptThread = (screen: string) =>
  /Reply to ([a-z0-9-]+):> /.exec(screen)?.[1];

describe("[R] Sysop reply", () => {
  it("on a tree task row: opens the prompt, Enter sends a steer with the thread id and text", async () => {
    const { s, acts, screen } = start();
    s.key(DOWN); // first task under the first board
    s.key("R");
    const thread = promptThread(screen());
    expect(thread).toBeDefined();
    s.key(`${SKIP}\r`);
    await settle();
    expect(acts).toEqual([{ type: "steer", thread, text: SKIP }]);
    expect(screen()).toContain(`Posted to ${thread}.`);
  });

  it("on a tree post row it replies to that post's thread", async () => {
    const { s, acts, screen } = start();
    s.key(DOWN);
    s.key(RIGHT); // unfold the task
    s.key(DOWN); // its first post
    s.key("r");
    const thread = promptThread(screen());
    expect(thread).toBeDefined();
    s.key("hello\r");
    await settle();
    expect(acts).toEqual([{ type: "steer", thread, text: "hello" }]);
  });

  it("on the full thread screen", async () => {
    const { s, acts, screen } = start();
    s.key(DOWN);
    s.key("\r"); // open the full thread
    s.key("R");
    const thread = promptThread(screen());
    expect(thread).toBeDefined();
    s.key("go on\r");
    await settle();
    expect(acts).toEqual([{ type: "steer", thread, text: "go on" }]);
  });

  it("Esc cancels and sends nothing", async () => {
    const { s, acts, screen } = start();
    s.key(DOWN);
    s.key("R");
    s.key("half a thought");
    s.key("\x1b");
    await settle();
    expect(acts).toEqual([]);
    expect(screen()).not.toContain("Reply to");
  });

  it("an empty line does nothing", async () => {
    const { s, acts, screen } = start();
    s.key(DOWN);
    s.key("R");
    s.key("   \r");
    await settle();
    expect(acts).toEqual([]);
    expect(screen()).not.toContain("Reply to");
  });

  it("on a board row there is no thread, so no prompt", () => {
    const { s, screen } = start();
    s.key("R");
    expect(screen()).not.toContain("Reply to");
  });

  it("a refusal opens the ACCESS DENIED box", async () => {
    const { s, screen } = start({
      ok: false,
      error: {
        code: "ROLE_DENIED",
        message: "no",
        hint: "h",
        voice: "v",
      },
    });
    s.key(DOWN);
    s.key("R");
    s.key("x\r");
    await settle();
    expect(screen()).toContain("ACCESS DENIED");
  });

  it("a replay refuses it read-only", async () => {
    const r = replaySession(threeThreads(), { reducedMotion: true });
    expect(
      await r.src.act({ type: "steer", thread: "slides-pitch", text: "x" }),
    ).toMatchObject({ ok: false, error: { code: "ROLE_DENIED" } });
  });
});
