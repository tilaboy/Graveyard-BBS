import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { type Actor, type Status, checkToken, Emitter } from "../src/index.js";
import { expectLocksSound } from "./invariants.js";
import { CAST, World, commandArbs, simulate } from "./sim.js";

const { m1, b1, b2, srv } = CAST as Record<string, Actor>;

/** Two running tasks: t1 owned by b1, t3 owned by b2. */
function two(): World {
  const w = new World();
  for (const [t, a] of [
    ["t1", b1!],
    ["t3", b2!],
  ] as const) {
    w.do({
      type: "create_task",
      actor: m1!,
      thread_id: t,
      text: t,
      assigned: a.handle,
    });
    w.do({ type: "issue_packet", actor: m1!, thread_id: t });
    w.do({
      type: "ack",
      actor: a,
      thread_id: t,
      packet_id: w.p.tasks[t]!.packet!,
    });
    w.do({
      type: "set_status",
      actor: a,
      thread_id: t,
      to: "running",
      gate_ok: true,
    });
  }
  return w;
}
const claim = (w: World, a: Actor, t: string, lock = "schema") =>
  w.do({ type: "claim", actor: a, thread_id: t, lock });
const status = (w: World, t: string): Status => w.p.tasks[t]!.status;

describe("locks (R2)", () => {
  it("R2.1 a free lock is granted with rising fencing tokens", () => {
    const w = two();
    claim(w, b1!, "t1");
    expect(w.p.locks.schema!.holder!.token).toBe(1);
    w.do({ type: "release", actor: b1!, thread_id: "t1", lock: "schema" });
    claim(w, b2!, "t3");
    expect(w.p.locks.schema!.holder!.token).toBe(2);
  });
  it("R2.2 / R2.7 a held lock queues the claimer, blocked with lock:<name>", () => {
    const w = two();
    claim(w, b1!, "t1");
    const r = claim(w, b2!, "t3");
    expect(r.ok && w.events.at(-2)).toMatchObject({
      type: "QUEUE",
      body: { position: 1 },
    });
    expect(status(w, "t3")).toBe("blocked");
    expect(w.p.tasks.t3!.reason).toBe("lock:schema");
  });
  it("R2.3 release grants the queue head and unblocks it", () => {
    const w = two();
    claim(w, b1!, "t1");
    claim(w, b2!, "t3");
    w.do({ type: "release", actor: b1!, thread_id: "t1", lock: "schema" });
    expect(w.p.locks.schema!.holder).toMatchObject({ thread: "t3", token: 2 });
    expect(status(w, "t3")).toBe("running");
  });
  it("only a running owner claims; the holder alone releases or heartbeats", () => {
    const w = two();
    expect(claim(w, b2!, "t1").ok).toBe(false);
    claim(w, b1!, "t1");
    expect(claim(w, b1!, "t1").ok).toBe(false); // already holds
    expect(
      w.do({ type: "release", actor: b2!, thread_id: "t3", lock: "schema" }).ok,
    ).toBe(false);
    expect(
      w.do({ type: "heartbeat", actor: b2!, thread_id: "t1", lock: "schema" })
        .ok,
    ).toBe(false);
    expect(
      w.do({ type: "claim", actor: b1!, thread_id: "nope", lock: "x" }).ok,
    ).toBe(false);
  });
  it("heartbeat extends the lease; tick frees an expired lock (R2.4)", () => {
    const w = two();
    claim(w, b1!, "t1");
    w.now += 50_000;
    w.do({ type: "heartbeat", actor: b1!, thread_id: "t1", lock: "schema" });
    w.now += 50_000; // 100 s after the grant, 50 s after the heartbeat
    w.do({ type: "tick", actor: srv! });
    expect(w.p.locks.schema!.holder?.thread).toBe("t1");
    w.now += 20_000;
    w.do({ type: "tick", actor: srv! });
    expect(w.p.locks.schema!.holder).toBeUndefined();
    expect(status(w, "t1")).toBe("pending");
    expect(
      w.events.some(
        (e) => e.type === "SYSTEM" && e.body.kind === "lease-expired",
      ),
    ).toBe(true);
  });
  it("expiry hands the lock to the queue head", () => {
    const w = two();
    claim(w, b1!, "t1");
    claim(w, b2!, "t3");
    w.now += 61_000;
    w.do({ type: "tick", actor: srv! });
    expect(w.p.locks.schema!.holder).toMatchObject({ thread: "t3", token: 2 });
    expect(status(w, "t3")).toBe("running");
    expect(status(w, "t1")).toBe("pending");
  });
  it("a manual lease-expired move to pending also drops the task's locks and queue places", () => {
    const w = two();
    claim(w, b2!, "t3", "deploy");
    claim(w, b1!, "t1");
    claim(w, b2!, "t3"); // t3 holds deploy, waits for schema
    w.now += 61_000;
    w.do({
      type: "set_status",
      actor: srv!,
      thread_id: "t3",
      to: "pending",
      gate_ok: false,
    });
    expect(w.p.locks.schema!.queue).toEqual([]);
    expect(w.p.locks.deploy!.holder).toBeUndefined();
  });
  it("tick is server only", () => {
    expect(two().do({ type: "tick", actor: b1! }).ok).toBe(false);
  });
  it("cancelling a task frees its locks and drops it from queues", () => {
    const w = two();
    claim(w, b1!, "t1");
    claim(w, b2!, "t3");
    w.do({
      type: "set_status",
      actor: CAST.s1!,
      thread_id: "t3",
      to: "cancelled",
      reason: "x",
      gate_ok: false,
    });
    expect(w.p.locks.schema!.queue).toEqual([]);
    w.do({
      type: "set_status",
      actor: CAST.s1!,
      thread_id: "t1",
      to: "cancelled",
      reason: "x",
      gate_ok: false,
    });
    expect(w.p.locks.schema!.holder).toBeUndefined();
  });
  it("checkToken refuses a stale fencing token (STALE_TOKEN)", () => {
    const w = two();
    claim(w, b1!, "t1");
    const em = new Emitter(w.p, { now: 0, newId: () => "x" });
    expect(checkToken(em, "schema", 1).ok).toBe(true);
    const r = checkToken(em, "schema", 0);
    expect(r.ok ? "OK" : r.error.code).toBe("STALE_TOKEN");
  });
});

describe("lock properties", () => {
  const cmds = fc.commands(commandArbs, { maxCommands: 60, size: "max" });
  it("R2.5 / R2.6 / R2.7 one holder at a time, tokens strictly rise, queued tasks are blocked (P2)", () => {
    fc.assert(
      fc.property(cmds, (c) => void simulate(c, expectLocksSound)),
      { numRuns: 1000 },
    );
  });
  it("R2.4 after tick no expired lease remains and its running/blocked holder is pending (P6)", () => {
    let expiries = 0;
    fc.assert(
      fc.property(cmds, (c) => {
        const w = new World();
        // Replay with a hook that snapshots the world before each server tick.
        let before: World["p"] | undefined;
        const orig = w.do.bind(w);
        w.do = (cmd) => {
          if (cmd.type === "tick") before = w.p;
          const r = orig(cmd);
          if (cmd.type === "tick" && r.ok && before) {
            for (const l of Object.values(before.locks)) {
              if (!l.holder || w.now <= l.holder.expiresAt) continue;
              expiries++;
              const was = before.tasks[l.holder.thread]!.status;
              expect(
                w.p.locks[l.name]?.holder?.token === l.holder.token,
                `${l.name} still held`,
              ).toBe(false);
              if (was === "running" || was === "blocked")
                expect(w.p.tasks[l.holder.thread]!.status).toBe("pending");
            }
            for (const l of Object.values(w.p.locks))
              expect(l.holder && w.now > l.holder.expiresAt).toBeFalsy();
          }
          return r;
        };
        fc.modelRun(() => ({ model: {}, real: w }), c);
      }),
      { numRuns: 1000 },
    );
    expect(expiries).toBeGreaterThan(50); // not vacuous
  });
});
