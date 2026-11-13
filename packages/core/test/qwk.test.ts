import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  SECTION_ORDER,
  buildQwk,
  parseRep,
  type Actor,
  type QwkPacket,
} from "../src/index.js";
import { CAST, World, commandArbs, simulate } from "./sim.js";

const { m1, b1, b2, srv } = CAST as Record<string, Actor>;

function threads(): World {
  const w = new World();
  w.do({
    type: "create_task",
    actor: m1!,
    thread_id: "t1",
    text: "Haunted landing page",
    assigned: "b1",
  });
  w.do({
    type: "create_task",
    actor: m1!,
    thread_id: "t3",
    text: "Hero section",
    assigned: "b2",
    parent: "t1",
  });
  return w;
}
const build = (w: World, t: string, o = {}): QwkPacket => {
  const r = buildQwk(w.p, t, o);
  if (!r.ok) throw new Error(r.error.message);
  return r.value;
};
const section = (p: QwkPacket, n: string) =>
  p.sections.find((s) => s.name === n)?.lines ?? [];
const post = (
  w: World,
  t: string,
  a: Actor,
  kind: "NOTE" | "TRIED" | "MILESTONE",
  body: object,
) => w.do({ type: "post", actor: a, thread_id: t, kind, body } as never);

describe("buildQwk (R5.1)", () => {
  it("returns the sections in order, lessons absent when none given", () => {
    const names = build(threads(), "t1").sections.map((s) => s.name);
    expect(names).toEqual(SECTION_ORDER.filter((n) => n !== "lessons"));
  });
  it("goal has the root text and the stage; next comes from the parent", () => {
    const w = threads();
    post(w, "t1", b1!, "NOTE", { text: "plan", next: "build the hero" });
    const p = build(w, "t3", { gate: "tests green" });
    expect(section(p, "goal")).toEqual([
      "Haunted landing page",
      "stage: Hero section",
      "gate: tests green",
    ]);
    expect(section(p, "next")).toEqual(["build the hero"]);
  });
  it("summary quotes the last 8 posts and summarises older ones", () => {
    const w = threads();
    for (let i = 1; i <= 12; i++)
      post(w, "t1", b1!, "NOTE", { text: `note ${i}` });
    const s = section(build(w, "t1"), "summary");
    expect(s.filter((l) => l.startsWith(">"))).toHaveLength(8);
    expect(s.filter((l) => l.startsWith("-"))).toHaveLength(4);
  });
  it("artifacts list files with hashes; locks list what the thread holds", () => {
    const w = threads();
    post(w, "t1", b1!, "MILESTONE", {
      text: "m",
      files: [
        { path: "b.html", hash: "h2" },
        { path: "a.html", hash: "h1" },
      ],
    });
    expect(section(build(w, "t1"), "artifacts")).toEqual([
      "a.html  h1",
      "b.html  h2",
    ]);
    expect(section(build(w, "t1"), "locks")).toEqual([]);
  });
  it("unknown thread is NOT_FOUND", () => {
    expect(buildQwk(threads().p, "zz").ok).toBe(false);
  });
});

describe("R5.4 shrinking", () => {
  it("shortens summary first and never drops tried", () => {
    const w = threads();
    for (let i = 0; i < 30; i++)
      post(w, "t1", b1!, "NOTE", { text: "x".repeat(200) });
    post(w, "t1", b1!, "TRIED", { text: "regex parser", reason: "too slow" });
    const full = build(w, "t1");
    const small = build(w, "t1", { maxTokens: 200 });
    expect(small.tokens).toBeLessThan(full.tokens);
    expect(section(small, "tried")).toEqual(["- [t1] regex parser — too slow"]);
    expect(section(small, "goal")).toEqual(section(full, "goal"));
  });
  it("keeps tried even when the limit is impossible", () => {
    const w = threads();
    post(w, "t1", b1!, "TRIED", { text: "a".repeat(400), reason: "r" });
    const p = build(w, "t1", { maxTokens: 1 });
    expect(section(p, "tried")).toHaveLength(1);
    expect(section(p, "summary")).toEqual([]);
  });
});

describe("R5.6 lessons (task 12)", () => {
  const lessons = [
    { text: "Inline the CSS", project: "landing", thread: "t9" },
  ];
  it("adds a lessons section right after tried, with source project and thread", () => {
    const p = build(threads(), "t1", { lessons });
    const names = p.sections.map((s) => s.name);
    expect(names.indexOf("lessons")).toBe(names.indexOf("tried") + 1);
    expect(section(p, "lessons")).toEqual([
      "- Inline the CSS (from landing/t9)",
    ]);
  });
  it("lessons shrink before artifacts, but tried never does", () => {
    const w = threads();
    post(w, "t1", b1!, "TRIED", { text: "t", reason: "r" });
    const many = Array.from({ length: 50 }, (_, i) => ({
      text: "L".repeat(100),
      project: "p",
      thread: `t${i}`,
    }));
    const p = build(w, "t1", { lessons: many, maxTokens: 150 });
    expect(section(p, "lessons").length).toBeLessThan(50);
    expect(section(p, "tried")).toHaveLength(1);
  });
});

describe("R5.2 packets contain every TRIED (P5)", () => {
  it("includes TRIED of the thread and of its ancestors", () => {
    const w = threads();
    post(w, "t1", b1!, "TRIED", { text: "parent idea", reason: "no" });
    post(w, "t3", b2!, "TRIED", { text: "child idea", reason: "no" });
    expect(section(build(w, "t3"), "tried")).toEqual([
      "- [t1] parent idea — no",
      "- [t3] child idea — no",
    ]);
  });
  it("R5.2 holds for any command sequence, whatever the size limit", () => {
    fc.assert(
      fc.property(
        fc.commands(commandArbs, { maxCommands: 60, size: "max" }),
        fc.constantFrom(1, 100, 6000),
        (c, maxTokens) => {
          const w = simulate(c);
          for (const t of Object.values(w.p.tasks)) {
            const p = build(w, t.thread_id, { maxTokens });
            const lines = section(p, "tried");
            const chain: string[] = [];
            for (
              let a: typeof t | undefined = t;
              a;
              a = a.parent ? w.p.tasks[a.parent] : undefined
            )
              chain.unshift(a.thread_id);
            const expected = chain.flatMap((id) =>
              w.p.tasks[id]!.tried.map(
                (x) => `- [${id}] ${x.text} — ${x.reason}`,
              ),
            );
            expect(lines).toEqual(expected);
          }
        },
      ),
      { numRuns: 300 },
    );
  });
});

describe("parseRep (R5.5)", () => {
  const rep = (ids: string[]) =>
    JSON.stringify({
      changed: "form",
      evidence_ids: ids,
      tried: [],
      questions: [],
    });
  it("accepts a REP citing real evidence and rejects unknown ids", () => {
    const w = threads();
    w.do({
      type: "post",
      actor: srv!,
      thread_id: "t1",
      kind: "EVIDENCE",
      body: { text: "green" },
    });
    const id = w.p.tasks.t1!.evidence_ids[0]!;
    expect(parseRep(w.p, "t1", rep([id])).ok).toBe(true);
    const bad = parseRep(w.p, "t1", rep([id, "ghost"]));
    expect(bad.ok ? "OK" : bad.error.message).toContain("ghost");
  });
  it("rejects bad JSON, wrong shape and unknown thread", () => {
    const w = threads();
    expect(parseRep(w.p, "t1", "{").ok).toBe(false);
    expect(parseRep(w.p, "t1", "{}").ok).toBe(false);
    expect(parseRep(w.p, "zz", rep([])).ok).toBe(false);
  });
});
