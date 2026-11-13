import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  STATUSES,
  TRANSITIONS,
  VOICE,
  checkTransition,
  legalTargets,
  renderTransitionTable,
  type Actor,
  type Status,
} from "../src/index.js";
import { expectNoUnreviewedDone } from "./invariants.js";
import { CAST, World, commandArbs, simulate } from "./sim.js";

const { m1, b1, r1, r2, s1, srv } = CAST as Record<string, Actor>;

/** A world with thread t1 owned by b1, driven to the given status through legal commands only. */
function at(status: Status): World {
  const w = new World();
  const t = "t1";
  const must = (r: { ok: boolean }) => expect(r.ok).toBe(true);
  must(
    w.do({
      type: "create_task",
      actor: m1!,
      thread_id: t,
      text: "goal",
      assigned: "b1",
    }),
  );
  if (status === "pending") return w;
  if (status === "cancelled") {
    must(
      w.do({
        type: "set_status",
        actor: m1!,
        thread_id: t,
        to: "cancelled",
        reason: "no",
        gate_ok: false,
      }),
    );
    return w;
  }
  must(w.do({ type: "issue_packet", actor: m1!, thread_id: t }));
  must(
    w.do({
      type: "ack",
      actor: b1!,
      thread_id: t,
      packet_id: w.p.tasks[t]!.packet!,
    }),
  );
  must(
    w.do({
      type: "set_status",
      actor: b1!,
      thread_id: t,
      to: "running",
      gate_ok: false,
    }),
  );
  if (status === "running") return w;
  if (status === "blocked") {
    must(
      w.do({
        type: "set_status",
        actor: b1!,
        thread_id: t,
        to: "blocked",
        reason: "ask:q1",
        gate_ok: false,
      }),
    );
    return w;
  }
  must(
    w.do({
      type: "post",
      actor: srv!,
      thread_id: t,
      kind: "EVIDENCE",
      body: { text: "green" },
    }),
  );
  must(
    w.do({
      type: "set_status",
      actor: b1!,
      thread_id: t,
      to: "awaiting-review",
      gate_ok: false,
    }),
  );
  if (status === "awaiting-review") return w;
  must(
    w.do({
      type: "review",
      actor: r1!,
      thread_id: t,
      verdict: "pass",
      reasons: [],
    }),
  );
  must(
    w.do({
      type: "set_status",
      actor: r1!,
      thread_id: t,
      to: "done",
      gate_ok: true,
    }),
  );
  return w;
}

const move = (
  w: World,
  actor: Actor,
  to: Status,
  extra: { reason?: string; gate_ok?: boolean } = {},
) =>
  w.do({
    type: "set_status",
    actor,
    thread_id: "t1",
    to,
    gate_ok: extra.gate_ok ?? true,
    reason: extra.reason,
  });
const code = (r: ReturnType<World["do"]>) => (r.ok ? "OK" : r.error.code);

describe("allowed transitions (R1.1)", () => {
  it("pending → running needs the owner's ACK", () => {
    const w = at("pending");
    expect(code(move(w, b1!, "running"))).toBe("NO_ACK");
    expect(at("running").p.tasks.t1!.status).toBe("running");
  });
  it("running → blocked needs a valid reason; blocked → running is server only", () => {
    const w = at("running");
    expect(code(move(w, b1!, "blocked", { reason: "because" }))).toBe(
      "ILLEGAL_TRANSITION",
    );
    const b = at("blocked");
    expect(code(move(b, b1!, "running"))).toBe("ROLE_DENIED");
    expect(code(move(b, srv!, "running"))).toBe("ILLEGAL_TRANSITION"); // ask:q1 not answered
    b.do({
      type: "post",
      actor: s1!,
      thread_id: "t1",
      kind: "ANSWER",
      body: { text: "A", ask_id: "q1" },
    });
    expect(code(move(b, srv!, "running"))).toBe("OK");
  });
  it("running → awaiting-review needs fresh EVIDENCE (R1.3)", () => {
    const w = at("running");
    expect(code(move(w, b1!, "awaiting-review"))).toBe("NO_EVIDENCE");
    w.do({
      type: "post",
      actor: srv!,
      thread_id: "t1",
      kind: "EVIDENCE",
      body: { text: "ok" },
    });
    w.do({
      type: "post",
      actor: b1!,
      thread_id: "t1",
      kind: "MILESTONE",
      body: { text: "edit", code_change: true },
    });
    expect(code(move(w, b1!, "awaiting-review"))).toBe("NO_EVIDENCE"); // evidence is now stale
    w.do({
      type: "post",
      actor: srv!,
      thread_id: "t1",
      kind: "EVIDENCE",
      body: { text: "again" },
    });
    expect(code(move(w, b1!, "awaiting-review"))).toBe("OK");
  });
  it("awaiting-review → done needs a reviewer, a pass, and the gate", () => {
    const w = at("awaiting-review");
    expect(code(move(w, r1!, "done"))).toBe("ILLEGAL_TRANSITION"); // no REVIEW pass yet
    w.do({
      type: "review",
      actor: r1!,
      thread_id: "t1",
      verdict: "pass",
      reasons: [],
    });
    expect(code(move(w, r1!, "done", { gate_ok: false }))).toBe(
      "ILLEGAL_TRANSITION",
    ); // gate
    expect(code(move(w, r1!, "done"))).toBe("OK");
    expect(w.p.tasks.t1!.status).toBe("done");
  });
  it("awaiting-review → running on reject copies each reason as TRIED (R1.6)", () => {
    const w = at("awaiting-review");
    expect(
      w.do({
        type: "review",
        actor: r1!,
        thread_id: "t1",
        verdict: "reject",
        reasons: ["a", "b"],
      }).ok,
    ).toBe(true);
    expect(w.p.tasks.t1!.status).toBe("running");
    expect(w.p.tasks.t1!.tried.map((x) => x.text)).toEqual(["a", "b"]);
  });
  it("any non-terminal → cancelled by moderator or sysop, with a reason", () => {
    for (const s of [
      "pending",
      "running",
      "blocked",
      "awaiting-review",
    ] as const) {
      const w = at(s);
      expect(code(move(w, m1!, "cancelled", { reason: " " }))).toBe(
        "ILLEGAL_TRANSITION",
      );
      expect(code(move(w, b1!, "cancelled", { reason: "x" }))).toBe(
        "ROLE_DENIED",
      );
      expect(code(move(w, s1!, "cancelled", { reason: "x" }))).toBe("OK");
    }
  });
  it("lease expiry returns running and blocked tasks to pending (server only)", () => {
    for (const s of ["running", "blocked"] as const) {
      const w = at(s);
      expect(code(move(w, srv!, "pending"))).toBe("ILLEGAL_TRANSITION"); // no expired lease
    }
  });
});

describe("forbidden transitions (R1.2)", () => {
  const forbidden: [Status, Status][] = [
    ["running", "done"],
    ["pending", "done"],
    ["pending", "awaiting-review"],
    ["blocked", "awaiting-review"],
    ["blocked", "done"],
    ["done", "running"],
    ["done", "pending"],
    ["done", "cancelled"],
    ["cancelled", "running"],
    ["cancelled", "pending"],
  ];
  it.each(forbidden)("%s → %s is refused for every caller", (from, to) => {
    for (const a of Object.values(CAST)) {
      const w = at(from);
      const r = move(w, a, to, { reason: "x" });
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.error.code).toBe("ILLEGAL_TRANSITION");
        expect(r.error.message).toContain(`${from} → ${to}`);
      }
      expect(w.p.tasks.t1!.status).toBe(from);
    }
  });
  it("legalTargets never lists done except from awaiting-review", () => {
    for (const s of STATUSES)
      expect(legalTargets(s).includes("done")).toBe(s === "awaiting-review");
  });
  it("the table has exactly one row into done", () => {
    expect(TRANSITIONS.filter((x) => x.to === "done")).toEqual([
      expect.objectContaining({ from: "awaiting-review", who: ["reviewer"] }),
    ]);
  });
  it("unknown thread is NOT_FOUND", () => {
    const r = checkTransition(new World().p, "nope", "running", {
      actor: b1!,
      gate_ok: true,
      now: 0,
    });
    expect(r.ok ? "OK" : r.error.code).toBe("NOT_FOUND");
  });
});

describe("no one skips review (R1.5, R1.7)", () => {
  it("owner reviewing own task is SELF_REVIEW", () => {
    const w = at("awaiting-review");
    const r = w.do({
      type: "review",
      actor: { handle: "b1", role: "reviewer" },
      thread_id: "t1",
      verdict: "pass",
      reasons: [],
    });
    expect(code(r)).toBe("SELF_REVIEW");
  });
  it("owner requesting done is SELF_REVIEW even if the owner holds the reviewer role", () => {
    const w = at("awaiting-review");
    w.do({
      type: "review",
      actor: r1!,
      thread_id: "t1",
      verdict: "pass",
      reasons: [],
    });
    expect(code(move(w, { handle: "b1", role: "reviewer" }, "done"))).toBe(
      "SELF_REVIEW",
    );
  });
  it("the Sysop cannot write REVIEW", () => {
    const w = at("awaiting-review");
    expect(
      code(
        w.do({
          type: "review",
          actor: s1!,
          thread_id: "t1",
          verdict: "pass",
          reasons: [],
        }),
      ),
    ).toBe("ROLE_DENIED");
  });
  it("the Sysop cannot set done, not even after a reviewer's pass", () => {
    const w = at("awaiting-review");
    w.do({
      type: "review",
      actor: r2!,
      thread_id: "t1",
      verdict: "pass",
      reasons: [],
    });
    expect(code(move(w, s1!, "done"))).toBe("ROLE_DENIED");
    expect(w.p.tasks.t1!.status).toBe("awaiting-review");
  });
  it("the Sysop cannot skip review from running", () => {
    const w = at("running");
    const r = move(w, s1!, "done");
    expect(code(r)).toBe("ILLEGAL_TRANSITION");
    if (!r.ok) expect(r.error.voice).toBe(VOICE.ILLEGAL_TRANSITION);
  });
  it("a REVIEW pass from before a re-submission does not count", () => {
    const w = at("awaiting-review");
    w.do({
      type: "review",
      actor: r1!,
      thread_id: "t1",
      verdict: "reject",
      reasons: ["x"],
    });
    w.do({
      type: "post",
      actor: srv!,
      thread_id: "t1",
      kind: "EVIDENCE",
      body: { text: "fixed" },
    });
    move(w, b1!, "awaiting-review");
    expect(code(move(w, r2!, "done"))).toBe("ILLEGAL_TRANSITION");
  });
});

describe("task 9: renderTransitionTable", () => {
  it("renders one row per transition", () => {
    const lines = renderTransitionTable().split("\n");
    expect(lines).toHaveLength(TRANSITIONS.length + 2);
    expect(lines).toContain(
      "| awaiting-review | done | reviewer | not_owner, review_pass, gate |",
    );
  });
});

describe("model-based properties", () => {
  const cmds = fc.commands(commandArbs, { maxCommands: 60, size: "max" });

  it("R1.4 no sequence of commands reaches done without awaiting-review (P1)", () => {
    fc.assert(
      fc.property(cmds, (c) => {
        const w = simulate(c);
        expectNoUnreviewedDone(w.events);
      }),
      { numRuns: 1500 },
    );
  });

  it("R1.9 no role, sysop included, reaches done without REVIEW pass by a non-owner", () => {
    fc.assert(
      fc.property(cmds, (c) => {
        simulate(c, (w) => expectNoUnreviewedDone(w.events));
      }),
      { numRuns: 1500 },
    );
  });

  it("the golden path is reachable, so the properties are not vacuous", () => {
    let done = 0;
    fc.assert(
      fc.property(cmds, (c) => {
        if (Object.values(simulate(c).p.tasks).some((t) => t.status === "done"))
          done++;
      }),
      { numRuns: 300 },
    );
    expect(done).toBeGreaterThan(10);
  });
});
