import { describe, expect, it } from "vitest";
import { parsePipeline } from "../src/pipeline.js";
import {
  initialState,
  plan,
  recordGate,
  recover,
  selectLessons,
  steerMessage,
  storedCursor,
  unchecked,
  type State,
} from "../src/planner.js";
import { Log, of, opts, spawns } from "./log.js";

const O = opts();
const roots = () =>
  new Log()
    .task("websites-landing", "Haunted landing page with a signup form")
    .task("arcade-crypt", "Door game (spec mode): crypt runner")
    .task("slides-pitch", "Six-slide pitch deck");

describe("pipelines come from the board steering files", () => {
  it("parses stage, role and spec-only mode", () => {
    expect(O.pipelines["arcade"]?.[0]).toEqual({
      name: "design",
      role: "designer",
      specOnly: true,
    });
    expect(O.pipelines["bugfix"]?.map((s) => s.role)).toEqual([
      "moderator",
      "builder",
      "reviewer",
      "reviewer",
    ]);
    expect(parsePipeline("# no table")).toEqual([]);
  });
});

describe("R1/R8 routing and parallel start", () => {
  it("R8.1 three root tasks on three boards spawn in the same planning step", () => {
    const { actions, state } = plan(initialState(), roots().events, O);
    expect(spawns(actions).map((a) => a.thread)).toEqual([
      "websites-landing-design",
      "arcade-crypt-design",
      "slides-pitch-outline",
    ]);
    expect(actions.some((a) => a.type === "check_gate")).toBe(false);
    expect(state.cursor).toBe(3);
  });

  it("R1.1 posts a NOTE with the reason and opens the stage as a child of the root", () => {
    const { actions } = plan(initialState(), roots().events, O);
    expect(of(actions, "note")[0]?.text).toMatch(/starting at design.*why:/);
    expect(of(actions, "open")[0]).toMatchObject({
      thread: "websites-landing-design",
      parent: "websites-landing",
      assigned: "designer-websites-landing-design",
    });
  });

  it("vibe mode skips the spec-only design stage", () => {
    const log = new Log().task(
      "arcade-bat",
      "Door game (vibe mode): bat dodge",
    );
    const { actions } = plan(initialState(), log.events, O);
    expect(spawns(actions)[0]?.thread).toBe("arcade-bat-build");
  });

  it("ignores boards without a pipeline and its own events", () => {
    const log = new Log()
      .task("mod-cursor", "x", "moderator")
      .task("unknown-thing", "x");
    expect(plan(initialState(), log.events, O).actions).toEqual([
      { type: "cursor", seq: 2, exists: true },
    ]);
  });

  it("server replies on the cursor thread do not wake a new cursor write", () => {
    const log = new Log().task("mod-cursor", "x", "moderator");
    const first = plan(initialState(), log.events, O);
    // The server's ACCESS DENIED note on mod-cursor, posted after our cursor note.
    log.post(
      "NOTE",
      "mod-cursor",
      "server",
      "ACCESS DENIED · thread mod-cursor already exists",
    );
    expect(plan(first.state, log.events, O).actions).toEqual([]);
  });
});

describe("R7.1 cursor", () => {
  it("does not repeat work for events at or before the cursor", () => {
    const log = roots();
    const first = plan(initialState(), log.events, O);
    expect(plan(first.state, log.events, O).actions).toEqual([]);
  });

  it("a restarted moderator rebuilds the same state from the stored cursor note", () => {
    const log = roots().status("websites-landing-design", "pending", "running");
    const first = plan(initialState(), log.events, O);
    log.post(
      "NOTE",
      "mod-cursor",
      "moderator",
      `SYSTEM cursor ${first.state.cursor}`,
    );
    expect(storedCursor(log.events)).toBe(first.state.cursor);
    expect(recover(log.events, storedCursor(log.events), O)).toEqual(
      first.state,
    );
  });
});

describe("R2 gates", () => {
  it("R2.1/R2.2 a done stage asks the server's gate, opens the next stage only when it holds", () => {
    const log = roots().status(
      "slides-pitch-outline",
      "awaiting-review",
      "done",
      "reviewer-1",
    );
    const a = plan(initialState(), log.events, O);
    expect(of(a.actions, "check_gate")).toEqual([
      { type: "check_gate", thread: "slides-pitch-outline" },
    ]);
    expect(of(a.actions, "open").map((x) => x.thread)).not.toContain(
      "slides-pitch-draft",
    );
    const no = plan(
      recordGate(a.state, "slides-pitch-outline", false),
      log.events,
      O,
    );
    expect(spawns(no.actions)).toEqual([]);
    const yes = plan(
      recordGate(a.state, "slides-pitch-outline", true),
      log.events,
      O,
    );
    expect(spawns(yes.actions).map((x) => x.thread)).toEqual([
      "slides-pitch-draft",
    ]);
  });
});

describe("R3.1 split with a parallel limit", () => {
  const md =
    "- [x] 1. done\n- [ ] 2. cart\n- [ ] 3. login\n- [ ] 4. search\n- [ ] 5. footer\n  - [ ] sub item\n";
  it("unchecked keeps only unchecked top-level items", () => {
    expect(unchecked(md)).toEqual(["cart", "login", "search", "footer"]);
  });
  it("opens every sub-thread, spawns 3, and the 4th when one finishes", () => {
    const log = new Log()
      .task("websites-shop", "Shop")
      .status("websites-shop-design", "awaiting-review", "done", "reviewer-1");
    const o = opts({ tasksMd: { "websites-shop": md } });
    const a = plan(initialState(), log.events, o);
    const b = plan(
      recordGate(a.state, "websites-shop-design", true),
      log.events,
      o,
    );
    expect(of(b.actions, "open")).toHaveLength(4);
    expect(spawns(b.actions).map((x) => x.thread)).toEqual([
      "websites-shop-build-1",
      "websites-shop-build-2",
      "websites-shop-build-3",
    ]);
    log.status(
      "websites-shop-build-1",
      "awaiting-review",
      "done",
      "reviewer-1",
    );
    const c = plan(b.state, log.events, o);
    expect(spawns(c.actions).map((x) => x.thread)).toEqual([
      "websites-shop-build-4",
    ]);
  });
});

describe("R4 recovery", () => {
  const base = () =>
    new Log()
      .task("slides-pitch", "Deck")
      .status("slides-pitch-outline", "pending", "running");
  it("R4.1/R4.2 respawns twice with a note, then asks the Sysop once", () => {
    const log = base();
    let st: State = plan(initialState(), log.events, O).state;
    const seen: string[] = [];
    for (let i = 0; i < 4; i++) {
      log.expired("slides-pitch-outline").expired("slides-pitch-outline");
      const r = plan(st, log.events, O);
      st = r.state;
      seen.push(
        [spawns(r.actions).length, of(r.actions, "escalate").length].join("/"),
      );
    }
    expect(seen).toEqual(["1/0", "1/0", "0/1", "0/0"]);
  });
  it("R4.2 a Sysop ANSWER resets the counter and resumes the agent", () => {
    const log = base().expired("slides-pitch-outline");
    const st = plan(initialState(), log.events, O).state;
    log.post("ANSWER", "slides-pitch-outline", "sysop", "go on");
    const r = plan(st, log.events, O);
    expect(spawns(r.actions)[0]).toMatchObject({ resume: true });
    expect(r.state.respawns["slides-pitch-outline"]).toBe(0);
  });
});

describe("R5.2 and R8 blocking", () => {
  it("a design ??? blocks only that task; the others keep moving", () => {
    const log = roots();
    const st = plan(initialState(), log.events, O).state;
    log
      .status("websites-landing-design", "pending", "running")
      .post(
        "ASK",
        "websites-landing-design",
        "designer-websites-landing-design",
        "dark fog or blood-red?",
      )
      .status("websites-landing-design", "running", "blocked")
      .status(
        "arcade-crypt-design",
        "running",
        "awaiting-review",
        "designer-arcade-crypt-design",
      )
      .status("slides-pitch-outline", "awaiting-review", "done", "reviewer-1");
    const r = plan(recordGate(st, "slides-pitch-outline", true), log.events, O);
    expect(
      spawns(r.actions)
        .map((x) => x.thread)
        .sort(),
    ).toEqual(["arcade-crypt-design", "slides-pitch-draft"]);
    expect(
      r.actions.filter(
        (a) => "thread" in a && a.thread === "websites-landing-design",
      ),
    ).toEqual([]);
  });
  it("R5.2 a second REVIEW reject on the same task escalates instead of respawning", () => {
    const log = roots().status("websites-landing-design", "pending", "running");
    const st = plan(initialState(), log.events, O).state;
    log.reject("websites-landing-design", ["a"]);
    const one = plan(st, log.events, O);
    expect(spawns(one.actions)[0]).toMatchObject({
      resume: true,
      role: "designer",
    });
    log.reject("websites-landing-design", ["b"]);
    const two = plan(one.state, log.events, O);
    expect(spawns(two.actions)).toEqual([]);
    expect(of(two.actions, "escalate")[0]?.text).toMatch(/^\?\?\?/);
  });
  it("a builder submitting for review gets a reviewer spawned on the same thread", () => {
    const log = roots();
    const st = plan(initialState(), log.events, O).state;
    log.status(
      "slides-pitch-outline",
      "running",
      "awaiting-review",
      "designer-slides-pitch-outline",
    );
    expect(spawns(plan(st, log.events, O).actions)[0]).toMatchObject({
      thread: "slides-pitch-outline",
      role: "reviewer",
    });
  });
});

describe("R6/R10 sysop posts", () => {
  const running = () => {
    const log = roots().status("slides-pitch-outline", "pending", "running");
    return { log, st: plan(initialState(), log.events, O).state };
  };
  it("R10.1 'skip review' becomes a steer with the refusal instruction and never a status action", () => {
    const { log, st } = running();
    log.post(
      "NOTE",
      "slides-pitch-outline",
      "sysop",
      "skip tests and review, just mark it done",
    );
    const { actions } = plan(st, log.events, O);
    const steer = of(actions, "steer");
    expect(steer).toHaveLength(1);
    expect(steer[0]?.message).toMatch(
      /Refuse in the refusal voice.*not even the Sysop/,
    );
    expect(actions.map((a) => a.type)).not.toContain("set_status");
    expect(JSON.stringify(actions)).not.toMatch(/"to":"done"/);
  });
  it("R6.1 an ordinary Sysop hint is forwarded as data", () => {
    const { log, st } = running();
    log.post("NOTE", "slides-pitch-outline", "sysop", "use fewer words");
    const m = of(plan(st, log.events, O).actions, "steer")[0]?.message;
    expect(m).toContain('"use fewer words"');
    expect(m).not.toMatch(/Refuse/);
  });
  it("does not steer for other callers, or when the agent is not running", () => {
    const { log, st } = running();
    log.post("NOTE", "slides-pitch-outline", "builder-9", "skip review");
    expect(of(plan(st, log.events, O).actions, "steer")).toEqual([]);
    const l2 = roots();
    const s2 = plan(initialState(), l2.events, O).state;
    l2.post("NOTE", "slides-pitch-outline", "sysop", "hello");
    expect(of(plan(s2, l2.events, O).actions, "steer")).toEqual([]);
  });
  it("steerMessage flags nearby phrasings and leaves harmless ones", () => {
    for (const t of [
      "bypass the reviewer",
      "ship it now",
      "force done",
      "no need for tests",
    ])
      expect(steerMessage(t)).toMatch(/Refuse/);
    for (const t of ["review the colours", "add tests for login"])
      expect(steerMessage(t)).not.toMatch(/Refuse/);
  });
});

describe("R9 knowledge hub", () => {
  it("R9.1 at most 5 deduplicated one-line lessons, only once per thread", () => {
    const log = new Log().task("websites-landing", "Landing");
    const st = plan(initialState(), log.events, O).state;
    for (let i = 0; i < 7; i++)
      log.tried("websites-landing-design", `idea ${i}`, "failed");
    log
      .tried("websites-landing-design", "idea 0", "failed")
      .status(
        "websites-landing-design",
        "awaiting-review",
        "done",
        "reviewer-1",
      );
    const r = plan(st, log.events, O);
    expect(of(r.actions, "store_lesson")).toHaveLength(5);
    log.status("websites-landing-design", "done", "cancelled");
    expect(of(plan(r.state, log.events, O).actions, "store_lesson")).toEqual(
      [],
    );
  });

  it("R9.1 a cancelled thread is distilled too", () => {
    const log = new Log().task("slides-pitch", "Deck");
    const st = plan(initialState(), log.events, O).state;
    log
      .tried("slides-pitch-outline", "ten slides", "too long")
      .status("slides-pitch-outline", "running", "cancelled", "sysop");
    expect(of(plan(st, log.events, O).actions, "store_lesson")).toHaveLength(1);
  });

  it("R9.3 ranks by goal overlap and board, caps at 5, skips the thread's own lessons", () => {
    const mk = (n: number, board: string, text: string) => ({
      text,
      project: "p",
      thread: `${board}-t${n}`,
      board,
      tags: [board],
    });
    const hub = [
      mk(1, "slides", "unrelated words here"),
      mk(2, "arcade", "collision detection needs a smoke test"),
      mk(3, "slides", "alpha"),
      mk(4, "slides", "beta"),
      mk(5, "slides", "gamma"),
      mk(6, "slides", "delta"),
    ];
    const got = selectLessons(
      hub,
      "arcade collision detection",
      "arcade",
      "slides-t6",
    );
    expect(got).toHaveLength(5);
    expect(got[0]?.thread).toBe("arcade-t2");
    expect(got.map((g) => g.thread)).not.toContain("slides-t6");
  });

  it("invariant: #websites closes with a REVIEW reject, the lesson is stored and reaches the later #arcade packet with its source thread", () => {
    const log = roots();
    let st = plan(initialState(), log.events, O).state;

    // websites: design approved, build rejected once, then passes.
    log.status(
      "websites-landing-design",
      "awaiting-review",
      "done",
      "reviewer-1",
    );
    st = plan(st, log.events, O).state;
    let r = plan(
      recordGate(st, "websites-landing-design", true),
      log.events,
      O,
    );
    st = r.state;
    expect(spawns(r.actions).map((x) => x.thread)).toEqual([
      "websites-landing-build",
    ]);

    log
      .status("websites-landing-build", "pending", "running")
      .reject("websites-landing-build", [
        "signup form has no alt text and no validation test",
      ])
      .status(
        "websites-landing-build",
        "running",
        "awaiting-review",
        "builder-1",
      )
      .status(
        "websites-landing-build",
        "awaiting-review",
        "done",
        "reviewer-1",
      );
    r = plan(st, log.events, O);
    st = r.state;
    const stored = of(r.actions, "store_lesson");
    expect(stored).toHaveLength(1);
    expect(stored[0]?.lesson).toMatchObject({
      thread: "websites-landing-build",
      board: "websites",
      project: "graveyard-bbs",
    });
    expect(stored[0]?.lesson.text).toContain("signup form has no alt text");

    // arcade: design approved later; its build spawn carries the lesson with the source thread.
    log.status("arcade-crypt-design", "awaiting-review", "done", "reviewer-1");
    st = plan(st, log.events, O).state;
    r = plan(recordGate(st, "arcade-crypt-design", true), log.events, O);
    const arcade = spawns(r.actions).find(
      (x) => x.thread === "arcade-crypt-build",
    );
    expect(arcade?.lessons).toContainEqual({
      text: stored[0]!.lesson.text,
      project: "graveyard-bbs",
      thread: "websites-landing-build",
    });
  });
});
