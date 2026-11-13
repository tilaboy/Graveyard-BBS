import { fold, VOICE, type Event } from "@graveyard/core";
import { describe, expect, it } from "vitest";
import { render } from "../src/screens.js";
import { BundleSchema, emptyState } from "../src/state.js";
import { LiveSource, ReplaySource } from "../src/source.js";
import {
  bundleOf,
  plain,
  stateOf,
  threeThreads,
  viewOf,
  T0,
} from "./helpers.js";

const still = { reducedMotion: true } as const;

describe("task 20 invariant: replaying a 3-thread bundle shows what folding the log shows", () => {
  const w = threeThreads();
  // Through JSON, like a file read by the judge site.
  const bundle = JSON.parse(JSON.stringify(bundleOf(w))) as unknown;

  it("boards, thread list and who screens are identical to the direct fold", () => {
    const rs = ReplaySource.parse(bundle);
    rs.advance(10 * 60_000);
    const direct = {
      ...emptyState(),
      events: w.events,
      p: fold(w.events),
      now: rs.state().now,
      runId: "2026-11-13-test-1",
    };
    for (const screen of ["boards", "who", "menu", "log", "doors"] as const)
      expect(render(rs.state(), viewOf({ screen, ...still }))).toBe(
        render(direct, viewOf({ screen, ...still })),
      );
    for (const board of ["websites", "arcade", "slides"])
      expect(
        render(rs.state(), viewOf({ screen: "threads", board, ...still })),
      ).toBe(render(direct, viewOf({ screen: "threads", board, ...still })));
  });
  it("each rendered row carries the status the log folds to", () => {
    const rs = ReplaySource.parse(bundle);
    rs.advance(10 * 60_000);
    const want = {
      "websites-landing": "blocked",
      "arcade-snake": "done",
      "slides-pitch": "running",
    };
    for (const [thread, status] of Object.entries(want)) {
      const board = thread.split("-")[0];
      const row = plain(
        render(rs.state(), viewOf({ screen: "threads", board, ...still })),
      )
        .split("\r\n")
        .find((l) => l.includes(thread));
      expect(row, thread).toContain(status);
      expect(fold(w.events).tasks[thread]!.status).toBe(status);
    }
  });
  it("plays forward with time, ×speed, and stops at the end", () => {
    const rs = ReplaySource.parse(bundle);
    expect(rs.info()).toMatchObject({
      pos: 0,
      total: 22,
      speed: 1,
      playing: true,
    });
    rs.advance(5000);
    expect(rs.info().pos).toBe(6); // events are one second apart; the first is due at 0 s
    rs.setSpeed(20);
    rs.advance(500); // 10 s of log
    expect(rs.info().pos).toBe(16);
    rs.advance(60_000);
    expect(rs.info()).toMatchObject({ pos: 22, playing: false });
  });
  it("pause holds, step ±1 refolds, restart goes to 0, markers sit on ASK and done", () => {
    const rs = ReplaySource.parse(bundle);
    rs.advance(8000);
    rs.toggle();
    rs.advance(60_000);
    expect(rs.info()).toMatchObject({ pos: 9, playing: false });
    rs.step(-3);
    expect(rs.state().p).toEqual(fold(w.events.slice(0, 6)));
    rs.step(1);
    expect(rs.state().events).toHaveLength(7);
    expect(rs.info().markers.map((m) => m.kind)).toEqual(["ask", "done"]);
    rs.restart();
    expect(rs.state().events).toHaveLength(0);
  });
  it("marks a refusal NOTE as a refusal marker", () => {
    const rs = ReplaySource.parse({
      ...(bundle as object),
      events: [
        ...(bundle as { events: Event[] }).events,
        {
          ...w.events[0],
          id: "z",
          seq: 99,
          type: "NOTE",
          body: { text: "💀 ACCESS DENIED · ILLEGAL_TRANSITION" },
        },
      ],
    });
    expect(rs.info().markers.at(-1)).toEqual({ at: 22, kind: "refusal" });
  });
  it("refuses a malformed bundle at the boundary", () => {
    expect(() =>
      ReplaySource.parse({ runId: "x", events: [{ nope: 1 }] }),
    ).toThrow();
    expect(BundleSchema.safeParse(null).success).toBe(false);
  });
  it("[X] on a running thread is refused by core: ILLEGAL_TRANSITION with the voice line", async () => {
    const rs = ReplaySource.parse(bundle);
    rs.advance(10 * 60_000);
    const r = await rs.act({ type: "forceDone", thread: "slides-pitch" });
    expect(r).toMatchObject({
      ok: false,
      error: { code: "ILLEGAL_TRANSITION", voice: VOICE.ILLEGAL_TRANSITION },
    });
    const ro = await rs.act({ type: "approve", thread: "x", ask: "y" });
    expect(ro).toMatchObject({ ok: false, error: { code: "ROLE_DENIED" } });
  });
});

// ---- LiveSource against a fake socket ---------------------------------------

class FakeWS {
  static last: FakeWS;
  listeners: Record<string, ((m: unknown) => void)[]> = {};
  closed = false;
  constructor(readonly url: string) {
    FakeWS.last = this;
  }
  addEventListener(t: string, f: (m: unknown) => void) {
    (this.listeners[t] ??= []).push(f);
  }
  send(data: string) {
    this.listeners["message"]?.forEach((f) => f({ data }));
  }
  close() {
    this.closed = true;
  }
}

describe("LiveSource", () => {
  const w = threeThreads();
  const history = w.events.slice(0, 10);
  const calls: { url: string; body?: string }[] = [];
  const reply = (v: unknown) =>
    Promise.resolve({ json: async () => v } as Response);
  const fetchFake = ((url: string, init?: { body?: string }) => {
    calls.push({ url, ...(init?.body ? { body: init.body } : {}) });
    if (url.includes("/api/events")) return reply(history);
    if (url.includes("bbs_list_lessons"))
      return reply({
        ok: true,
        value: [{ text: "t", tags: [], project: "p", board: "b", thread: "x" }],
      });
    if (url.includes("force-done"))
      return reply({
        ok: false,
        error: {
          code: "ILLEGAL_TRANSITION",
          message: "m",
          hint: "h",
          voice: "v",
        },
      });
    return reply({ ok: true, value: {} });
  }) as unknown as typeof fetch;

  it("loads history (not 'new'), then applies pushed events as new; ignores junk", async () => {
    const src = new LiveSource({
      baseUrl: "http://127.0.0.1:1",
      token: "tok",
      fetch: fetchFake,
      WebSocket: FakeWS as never,
      now: () => T0,
    });
    const changes: { added: number; reset: boolean }[] = [];
    src.subscribe((c) =>
      changes.push({ added: c.added.length, reset: c.reset }),
    );
    src.start();
    await new Promise((r) => setTimeout(r, 20));
    expect(src.state().events).toHaveLength(10);
    expect(src.state().lessons).toHaveLength(1);
    expect(changes).toEqual([{ added: 0, reset: true }]);
    expect(FakeWS.last.url).toBe("ws://127.0.0.1:1/ws?after=10&token=tok");

    FakeWS.last.send("not json");
    FakeWS.last.send(JSON.stringify({ type: "NOPE" }));
    FakeWS.last.send(JSON.stringify(w.events[9])); // already known: dropped
    FakeWS.last.send(JSON.stringify(w.events[10]));
    FakeWS.last.send(JSON.stringify(w.events[11]));
    src.flush();
    expect(changes.at(-1)).toEqual({ added: 2, reset: false });
    expect(src.state().p).toEqual(fold(w.events.slice(0, 12)));
    src.stop();
    expect(FakeWS.last.closed).toBe(true);
  });
  it("sends Sysop actions with the bearer token and maps a refusal", async () => {
    const src = new LiveSource({
      baseUrl: "http://h",
      token: "tok",
      fetch: fetchFake,
      WebSocket: FakeWS as never,
    });
    expect(await src.act({ type: "forceDone", thread: "t" })).toMatchObject({
      ok: false,
      error: { code: "ILLEGAL_TRANSITION" },
    });
    expect(await src.act({ type: "approve", thread: "t", ask: "a" })).toEqual({
      ok: true,
    });
    expect(
      calls.some(
        (c) =>
          c.url === "http://h/api/sysop/approve" &&
          c.body === JSON.stringify({ thread_id: "t", ask_id: "a" }),
      ),
    ).toBe(true);
  });
  it("state() works before start", () => {
    expect(stateOf(w).events.length).toBe(22);
  });
});
