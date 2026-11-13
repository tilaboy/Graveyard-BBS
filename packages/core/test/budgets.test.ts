import { describe, expect, it } from "vitest";
import type { Actor } from "../src/index.js";
import { CAST, World } from "./sim.js";

const { m1, b1, s1, srv } = CAST as Record<string, Actor>;

function running(budget = { turns_left: 3, seconds_left: 100 }): World {
  const w = new World();
  w.do({
    type: "create_task",
    actor: m1!,
    thread_id: "t1",
    text: "g",
    assigned: "b1",
    budget,
  });
  w.do({ type: "issue_packet", actor: m1!, thread_id: "t1" });
  w.do({
    type: "ack",
    actor: b1!,
    thread_id: "t1",
    packet_id: w.p.tasks.t1!.packet!,
  });
  w.do({
    type: "set_status",
    actor: b1!,
    thread_id: "t1",
    to: "running",
    gate_ok: true,
  });
  return w;
}
const spend = (w: World, turns: number, actor = srv!) =>
  w.do({ type: "spend", actor, thread_id: "t1", turns });

describe("budgets (R4)", () => {
  it("R4.1 a thread has a budget, with defaults", () => {
    const w = new World();
    w.do({
      type: "create_task",
      actor: m1!,
      thread_id: "t1",
      text: "g",
      assigned: "b1",
    });
    expect(w.p.tasks.t1!.budget.turns_left).toBeGreaterThan(0);
    expect(w.p.tasks.t1!.budget.seconds_left).toBeGreaterThan(0);
  });
  it("spending lowers the budget without blocking while some is left", () => {
    const w = running();
    spend(w, 2);
    expect(w.p.tasks.t1!.budget.turns_left).toBe(1);
    expect(w.p.tasks.t1!.status).toBe("running");
  });
  it("R4.2 reaching 0 blocks the task with reason budget and asks the Sysop", () => {
    const w = running();
    spend(w, 5);
    expect(w.p.tasks.t1!.budget.turns_left).toBe(0);
    expect(w.p.tasks.t1!.status).toBe("blocked");
    expect(w.p.tasks.t1!.reason).toBe("budget");
    expect(
      w.events.some((e) => e.type === "ASK" && e.body.to === "sysop"),
    ).toBe(true);
  });
  it("only the server spends; only the Sysop raises, and raising unblocks", () => {
    const w = running();
    expect(spend(w, 1, b1!).ok).toBe(false);
    spend(w, 5);
    expect(
      w.do({ type: "raise_budget", actor: b1!, thread_id: "t1", turns: 9 }).ok,
    ).toBe(false);
    expect(w.p.tasks.t1!.status).toBe("blocked");
    expect(
      w.do({ type: "raise_budget", actor: s1!, thread_id: "t1", turns: 9 }).ok,
    ).toBe(true);
    expect(w.p.tasks.t1!.status).toBe("running");
    expect(w.p.tasks.t1!.budget.turns_left).toBe(9);
  });
  it("a credits budget blocks at 0 too", () => {
    const w = running({
      turns_left: 9,
      seconds_left: 9,
      credits_left: 1,
    } as never);
    w.do({ type: "spend", actor: srv!, thread_id: "t1", credits: 1 });
    expect(w.p.tasks.t1!.reason).toBe("budget");
  });
});
