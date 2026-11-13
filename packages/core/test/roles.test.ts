import { describe, expect, it } from "vitest";
import {
  ROLES,
  authorizeDoor,
  type Actor,
  type BoardConfig,
} from "../src/index.js";
import { CAST, World } from "./sim.js";

const { m1, b1 } = CAST as Record<string, Actor>;
const board: BoardConfig = {
  doors: { run_tests: ["builder", "reviewer"], git_merge: ["release"] },
};

function acked(): World {
  const w = new World();
  w.do({
    type: "create_task",
    actor: m1!,
    thread_id: "t1",
    text: "g",
    assigned: "b1",
  });
  w.do({ type: "issue_packet", actor: m1!, thread_id: "t1" });
  return w;
}
const code = (w: World, a: Actor, door: string, t = "t1") => {
  const r = authorizeDoor(w.p, board, a, door, t);
  return r.ok ? "OK" : r.error.code;
};

describe("roles and doors (R6, R5.3)", () => {
  it("R6.1 knows the seven roles", () => {
    expect(ROLES).toEqual([
      "sysop",
      "moderator",
      "designer",
      "builder",
      "reviewer",
      "release",
      "artist",
    ]);
  });
  it("R5.3 a caller who has not ACKed the latest packet gets NO_ACK", () => {
    const w = acked();
    expect(code(w, b1!, "run_tests")).toBe("NO_ACK");
    w.do({
      type: "ack",
      actor: b1!,
      thread_id: "t1",
      packet_id: w.p.tasks.t1!.packet!,
    });
    expect(code(w, b1!, "run_tests")).toBe("OK");
    w.do({ type: "issue_packet", actor: m1!, thread_id: "t1" }); // a new packet needs a new ACK
    expect(code(w, b1!, "run_tests")).toBe("NO_ACK");
  });
  it("ACK of an old packet is refused", () => {
    const w = acked();
    expect(
      w.do({ type: "ack", actor: b1!, thread_id: "t1", packet_id: "qwk-old" })
        .ok,
    ).toBe(false);
    expect(
      w.do({
        type: "ack",
        actor: CAST.b2!,
        thread_id: "t1",
        packet_id: w.p.tasks.t1!.packet!,
      }).ok,
    ).toBe(false);
  });
  it("R6.2 a role the board does not allow gets ROLE_DENIED", () => {
    const w = acked();
    expect(code(w, b1!, "git_merge")).toBe("ROLE_DENIED");
    expect(code(w, CAST.s1!, "run_tests")).toBe("ROLE_DENIED");
  });
  it("unknown door or thread is NOT_FOUND", () => {
    const w = acked();
    expect(code(w, b1!, "nuke")).toBe("NOT_FOUND");
    expect(code(w, b1!, "run_tests", "zz")).toBe("NOT_FOUND");
  });
  it("an exhausted budget gives BUDGET_EXHAUSTED", () => {
    const w = acked();
    w.do({
      type: "ack",
      actor: b1!,
      thread_id: "t1",
      packet_id: w.p.tasks.t1!.packet!,
    });
    w.do({ type: "spend", actor: CAST.srv!, thread_id: "t1", turns: 999 });
    expect(code(w, b1!, "run_tests")).toBe("BUDGET_EXHAUSTED");
  });
  it("posts are gated by role: only the Sysop answers, only doors write EVIDENCE", () => {
    const w = acked();
    expect(
      w.do({
        type: "post",
        actor: b1!,
        thread_id: "t1",
        kind: "ANSWER",
        body: { text: "a", ask_id: "q" },
      }).ok,
    ).toBe(false);
    expect(
      w.do({
        type: "post",
        actor: b1!,
        thread_id: "t1",
        kind: "EVIDENCE",
        body: { text: "e" },
      }).ok,
    ).toBe(false);
    expect(
      w.do({
        type: "post",
        actor: b1!,
        thread_id: "t1",
        kind: "NOTE",
        body: { text: "n" },
      }).ok,
    ).toBe(true);
  });
});
