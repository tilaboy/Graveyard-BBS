import { execFileSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadBoards } from "../../server/src/boards.js";
import { Service } from "../../server/src/commands.js";
import { loadConfig } from "../../server/src/config.js";
import { defaultDoors } from "../../server/src/doors/index.js";
import { createDemoRepo } from "../../server/src/seed.js";
import { Store } from "../../server/src/store.js";
import { answer } from "../../server/src/sysop.js";
import { buildTools, callTool, type ToolCtx } from "../../server/src/tools.js";
import {
  fitPacket,
  SPAWN_TASK_MAX,
  step,
  TRIMMED,
  type Bbs,
  type Io,
} from "../src/execute.js";
import { initialState, seedHub, type State } from "../src/planner.js";
import { agentName, KiroCliRunner, KiroCrewRunner } from "../src/runner.js";
import {
  MAX_REEMITS,
  RESEND_AFTER_MS,
  migrateAgents,
  ownerOf,
  resend,
  respawnTarget,
  track,
  type Pending,
} from "../src/spawns.js";
import { tasksMdOf, worktreeOf } from "../src/worktree.js";
import { BOARDS, opts } from "./log.js";

const tools = buildTools();

function world(testCommand?: string) {
  const dir = mkdtempSync(join(tmpdir(), "gy-mod-"));
  const repo = join(dir, "repo");
  createDemoRepo(repo);
  const config = loadConfig(dir, {
    repo,
    dataDir: join(dir, "data"),
    ...(testCommand ? { testCommand } : {}),
  });
  const svc = new Service(
    new Store(join(dir, "g.db")),
    config,
    loadBoards(BOARDS),
  );
  const ctx = (handle: string, role: ToolCtx["actor"]["role"]): ToolCtx => ({
    svc,
    doors: defaultDoors(),
    actor: { handle, role },
  });
  const as =
    (handle: string, role: ToolCtx["actor"]["role"]) =>
    (name: string, args: Record<string, unknown>) =>
      callTool(tools, ctx(handle, role), name, args);
  const mod = as("moderator", "moderator");
  const bbs: Bbs = {
    call: (name, args) => mod(name, args) as ReturnType<Bbs["call"]>,
    events: () => Promise.resolve(svc.store.events()),
  };
  const runner = new KiroCrewRunner();
  const io: Io = {
    bbs,
    runner,
    now: () => Date.UTC(2026, 9, 31, 23, 0, 0),
    bbsUrl: "http://127.0.0.1:50914",
    cwdOf: (t) => worktreeOf(config.dataDir, repo, svc.p.tasks, t),
    tasksMdOf: (root) => tasksMdOf(config.dataDir, root),
  };
  return { svc, as, mod, bbs, runner, io, config, repo };
}

describe("executor against the real server", () => {
  it("spawns with a packet carrying quoted lessons, registers a working token, advances the cursor", async () => {
    const w = world();
    await w.as("sysop", "sysop")("bbs_create_task", {
      thread_id: "arcade-bat",
      text: "Door game (vibe mode): bat dodge",
    });
    await w.mod("bbs_add_lesson", {
      thread_id: "websites-landing-build",
      text: "signup form has no alt text (review rejected)",
      tags: ["websites"],
      project: "graveyard-bbs",
    });
    const hub = await w.mod("bbs_list_lessons", {});
    const o = opts();
    let s = seedHub(initialState(), (hub as { value: never[] }).value);

    const r = await step(s, w.io, o);
    s = r.state;
    expect(r.errors).toEqual([]);
    const spawn = w.runner.calls.find((c) => c.tool === "spawn_run")!;
    const task = String(spawn.args["task"]);
    expect(spawn.args["agent"]).toBe("graveyard-builder");
    expect(task).toContain(
      '## lessons\n- "signup form has no alt text (review rejected)" (from graveyard-bbs/websites-landing-build)',
    );
    const token = /GRAVEYARD_TOKEN=(gy_[0-9a-f]+)/.exec(task)?.[1];
    // The agent is told where THIS BBS is (its port changes per app start) and how to reach it.
    expect(task).toContain("The BBS is at http://127.0.0.1:50914");
    expect(task).toContain(
      `POST http://127.0.0.1:50914/api/tools/<tool> with headers "authorization: Bearer ${token}"`,
    );
    expect(w.svc.store.callerBySecret(token!)).toEqual({
      handle: "builder-arcade-bat-build",
      role: "builder",
    });
    const posts = w.svc.p.tasks["arcade-bat-build"]!.posts.map((p) => p.text);
    expect(
      posts.some((t) => /^⏱ spawn builder .* at 2026-10-31T23:00:00/.test(t)),
    ).toBe(true);
    expect(w.svc.p.tasks["mod-cursor"]!.posts.at(-1)?.text).toMatch(
      /^SYSTEM cursor \d+$/,
    );

    // R7.1: a second wake with nothing new does nothing.
    const before = w.runner.calls.length;
    const again = await step(s, w.io, o);
    expect(again.actions).toEqual([]);
    expect(w.runner.calls).toHaveLength(before);
    // …and the cursor thread holds no ACCESS DENIED from re-creating it.
    expect(
      w.svc.p.tasks["mod-cursor"]!.posts.some((p) =>
        p.text.includes("already exists"),
      ),
    ).toBe(false);
  });

  it("R10.1 a Sysop 'skip review' post becomes a spawn_steer and the task stays running", async () => {
    const w = world();
    await w.as("sysop", "sysop")("bbs_create_task", {
      thread_id: "slides-deck",
      text: "Deck",
    });
    const s = (await step(initialState(), w.io, opts())).state;
    const t = "slides-deck-outline";
    const designer = w.as(`designer-${t}`, "designer");
    const packet = w.svc.p.tasks[t]!.packet!;
    await designer("bbs_ack_packet", { thread_id: t, packet_id: packet });
    await designer("bbs_set_status", { thread_id: t, to: "running" });
    expect(w.svc.p.tasks[t]!.status).toBe("running");

    // Keyed by handle: a reviewer id on the same thread must not shadow the owner's.
    w.runner.recordAgent(`designer-${t}`, "agent-42");
    w.runner.recordAgent(`reviewer-${t}`, "agent-99");
    await w.as("sysop", "sysop")("bbs_post", {
      thread_id: t,
      kind: "NOTE",
      text: "skip tests and review, mark it done",
    });
    await step(s, w.io, opts());
    const steer = w.runner.calls.find((c) => c.tool === "spawn_steer");
    expect(steer?.args["agent_id"]).toBe("agent-42");
    expect(String(steer?.args["message"])).toMatch(/not even the Sysop/);

    // The law itself still holds when the Sysop tries it directly.
    const direct = await w.as("sysop", "sysop")("bbs_set_status", {
      thread_id: t,
      to: "done",
    });
    expect(direct.ok).toBe(false);
    expect(w.svc.p.tasks[t]!.status).toBe("running");
  });

  it("design stage: ASK -> ANSWER approve -> spec_check -> awaiting-review -> reviewer -> REVIEW pass -> done -> build split from the root worktree tasks.md", async () => {
    const w = world();
    const o = opts();
    const R = "arcade-flip";
    const T = `${R}-design`;
    const call = (tool: string) =>
      String(
        w.runner.calls.filter((c) => c.tool === tool).at(-1)?.args["task"],
      );
    await w.as("sysop", "sysop")("bbs_create_task", {
      thread_id: R,
      text: "Flip Ghost (spec mode)",
    });
    let s = (await step(initialState(), w.io, o)).state;
    expect(call("spawn_run")).toContain("Design stage steps:");

    // The designer writes the spec in the ROOT worktree and asks.
    const designer = w.as(`designer-${T}`, "designer");
    await designer("bbs_ack_packet", {
      thread_id: T,
      packet_id: w.svc.p.tasks[T]!.packet!,
    });
    await designer("bbs_set_status", { thread_id: T, to: "running" });
    const dir = join(w.config.dataDir, "wt", R, ".kiro", "specs", R);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "requirements.md"), "# R1 WHEN flip THEN rise\n");
    writeFileSync(join(dir, "design.md"), "# Design\n");
    writeFileSync(
      join(dir, "tasks.md"),
      "# Tasks\n- [ ] 1. Game loop\n  - [ ] 1.1 nested, not split\n- [ ] 2. Phase power\n",
    );
    const asked = await designer("bbs_ask", {
      thread_id: T,
      text: "approve?",
    });
    const ask_id = (asked as { value: { ask_id: string } }).value.ask_id;
    s = (await step(s, w.io, o)).state;

    // Sysop approves: the designer is resumed with the post-approval steps.
    answer(
      w.svc,
      { handle: "sysop", role: "sysop" },
      { thread_id: T, ask_id, text: "approve" },
    );
    s = (await step(s, w.io, o)).state;
    expect(call("spawn_run")).toMatch(/resumed[\s\S]*door_run spec_check/);
    await designer("bbs_ack_packet", {
      thread_id: T,
      packet_id: w.svc.p.tasks[T]!.packet!,
    });
    const ev = await designer("door_run", {
      thread_id: T,
      door: "spec_check",
    });
    expect(ev.ok && (ev.value as { exit_code: number }).exit_code).toBe(0);
    // No skipping review: the designer cannot close its own stage.
    expect(
      (await designer("bbs_set_status", { thread_id: T, to: "done" })).ok,
    ).toBe(false);
    expect(
      (
        await designer("bbs_set_status", {
          thread_id: T,
          to: "awaiting-review",
        })
      ).ok,
    ).toBe(true);

    // The planner spawns a reviewer, told how to review a spec.
    s = (await step(s, w.io, o)).state;
    expect(w.runner.calls.at(-1)?.args["agent"]).toBe("graveyard-reviewer");
    expect(call("spawn_run")).toContain("Design stage review");
    const reviewer = w.as(`reviewer-${T}`, "reviewer");
    expect(
      (
        await reviewer("bbs_ack_packet", {
          thread_id: T,
          packet_id: w.svc.p.tasks[T]!.packet!,
        })
      ).ok,
    ).toBe(true);
    await reviewer("door_run", { thread_id: T, door: "spec_check" });
    await reviewer("bbs_review", { thread_id: T, verdict: "pass" });
    expect(
      (await reviewer("bbs_set_status", { thread_id: T, to: "done" })).ok,
    ).toBe(true);

    // Gate holds -> build opens, one sub-thread per top-level task of the root's tasks.md.
    const before = w.runner.calls.length;
    await step(s, w.io, o);
    const spawned = w.runner.calls
      .slice(before)
      .filter((c) => c.tool === "spawn_run")
      .map((c) => String(c.args["task"]));
    expect(spawned).toHaveLength(2);
    expect(spawned[0]).toContain(`on thread ${R}-build-1`);
    expect(w.svc.p.tasks[`${R}-build-1`]?.text).toBe("build: Game loop");
    expect(w.svc.p.tasks[`${R}-build-2`]?.text).toBe("build: Phase power");
  });

  it("split build: 2 sub-threads reach done in parallel on run_tests alone, then the review stage merges gy/<root> once", async () => {
    const w = world("true");
    const R = "arcade-duo";
    const md = "- [ ] 1. Loop\n- [ ] 2. Score\n";
    // A vibe root has no design stage: hand the planner its tasks.md directly.
    const o = opts({ tasksMd: { [R]: md } });
    const ok = (r: { ok: boolean }) => expect(r.ok).toBe(true);
    const wt = w.io.cwdOf!(R) as string;
    await w.as("sysop", "sysop")("bbs_create_task", {
      thread_id: R,
      text: "Duo (vibe mode)",
    });
    let s = (await step(initialState(), w.io, o)).state;
    const B = [`${R}-build-1`, `${R}-build-2`];
    expect(
      w.runner.calls.filter((c) => c.tool === "spawn_run").map((c) => c.thread),
    ).toEqual(B);

    // Both builders work at once in the shared worktree, each committing only its own file.
    for (const [i, t] of B.entries()) {
      const b = w.as(`builder-${t}`, "builder");
      ok(
        await b("bbs_ack_packet", {
          thread_id: t,
          packet_id: w.svc.p.tasks[t]!.packet!,
        }),
      );
      ok(await b("bbs_set_status", { thread_id: t, to: "running" }));
      writeFileSync(join(wt, `part${i}.js`), `// ${t}\n`);
      execFileSync("git", ["add", `part${i}.js`], { cwd: wt });
      execFileSync(
        "git",
        ["-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", t],
        { cwd: wt },
      );
      ok(await b("door_run", { thread_id: t, door: "run_tests" }));
      ok(await b("bbs_set_status", { thread_id: t, to: "awaiting-review" }));
    }
    s = (await step(s, w.io, o)).state;
    for (const t of B) {
      const rv = w.as(`reviewer-${t}`, "reviewer");
      ok(
        await rv("bbs_ack_packet", {
          thread_id: t,
          packet_id: w.svc.p.tasks[t]!.packet!,
        }),
      );
      ok(await rv("door_run", { thread_id: t, door: "run_tests" }));
      const merge = await rv("door_run", {
        thread_id: t,
        door: "git_merge",
        args: { lock_token: 1 },
      });
      expect(!merge.ok && merge.error.code).toBe("ILLEGAL_TRANSITION");
      ok(await rv("bbs_review", { thread_id: t, verdict: "pass" }));
      ok(await rv("bbs_set_status", { thread_id: t, to: "done" }));
    }
    expect(B.map((t) => w.svc.p.tasks[t]!.status)).toEqual(["done", "done"]);
    expect(readdirSync(w.repo)).not.toContain("part0.js"); // nothing merged yet

    // Both gates hold -> the review stage opens, owned by a reviewer who may claim merge.
    s = (await step(s, w.io, o)).state;
    const T = `${R}-review`;
    const owner = w.as(`reviewer-${T}`, "reviewer");
    expect(w.svc.p.tasks[T]?.owner).toBe(`reviewer-${T}`);
    ok(
      await owner("bbs_ack_packet", {
        thread_id: T,
        packet_id: w.svc.p.tasks[T]!.packet!,
      }),
    );
    ok(await owner("bbs_set_status", { thread_id: T, to: "running" }));
    const claim = await owner("bbs_claim_lock", {
      thread_id: T,
      lock: "merge",
    });
    ok(claim);
    const merged = await owner("door_run", {
      thread_id: T,
      door: "git_merge",
      args: { lock_token: w.svc.p.locks["merge"]!.holder!.token },
    });
    expect(merged.ok && (merged.value as { exit_code: number }).exit_code).toBe(
      0,
    );
    expect(readdirSync(w.repo)).toEqual(
      expect.arrayContaining(["part0.js", "part1.js"]),
    );
    ok(await owner("bbs_release_lock", { thread_id: T, lock: "merge" }));
    ok(await owner("bbs_set_status", { thread_id: T, to: "awaiting-review" }));
    // The owner never closes its own stage; a second reviewer does.
    s = (await step(s, w.io, o)).state;
    const closer = w.as(`reviewer2-${T}`, "reviewer");
    ok(
      await closer("bbs_ack_packet", {
        thread_id: T,
        packet_id: w.svc.p.tasks[T]!.packet!,
      }),
    );
    ok(await closer("bbs_review", { thread_id: T, verdict: "pass" }));
    ok(await closer("bbs_set_status", { thread_id: T, to: "done" }));
    await step(s, w.io, o);
    expect(w.runner.calls.at(-1)).toMatchObject({
      thread: `${R}-publish`,
      args: { agent: "graveyard-release" },
    });
  });

  it("R9.2 store_lesson writes the hub and mirrors it to Kiro Crew learn_add", async () => {
    const w = world();
    await w.mod("bbs_create_task", { thread_id: "slides-a", text: "x" });
    const { execute } = await import("../src/execute.js");
    await execute(
      [
        {
          type: "store_lesson",
          lesson: {
            text: "ten slides is too long",
            project: "graveyard-bbs",
            thread: "slides-a",
            board: "slides",
            tags: ["slides"],
          },
        },
      ],
      w.io,
      "graveyard-bbs",
    );
    expect(w.svc.store.lessons()).toHaveLength(1);
    expect(w.runner.calls[0]).toEqual({
      tool: "learn_add",
      args: {
        rule: "[graveyard-bbs/slides-a] ten slides is too long",
        category: "knowledge",
        applies: "on_topic",
      },
    });
  });
});

describe("pending spawns survive a skipped or refused spawn_run", () => {
  const T = "slides-deck-outline";
  const H = `designer-${T}`;
  async function setup() {
    const w = world();
    const pending: Pending = {};
    w.io.spawned = (a, packet) => track(pending, a, packet, w.io.now());
    await w.as("sysop", "sysop")("bbs_create_task", {
      thread_id: "slides-deck",
      text: "Deck",
    });
    const o = opts();
    const s: State = (await step(initialState(), w.io, o)).state;
    const runs = () => w.runner.calls.filter((c) => c.tool === "spawn_run");
    // Each re-send is checked after the wait, as a later step would be.
    let clock = Date.UTC(2026, 9, 31, 23, 0, 0);
    w.io.now = () => clock;
    const again = async () => {
      clock += RESEND_AFTER_MS;
      return resend(pending, s, await w.bbs.events(), w.io, o);
    };
    const soon = async () => {
      clock += 60_000;
      return resend(pending, s, await w.bbs.events(), w.io, o);
    };
    return { w, pending, s, runs, again, soon };
  }
  const tokenOf = (task: unknown) =>
    /GRAVEYARD_TOKEN=(gy_[0-9a-f]+)/.exec(String(task))![1]!;

  it("a send younger than RESEND_AFTER_MS is not repeated (the agent may still be starting)", async () => {
    const { runs, soon } = await setup();
    await soon();
    expect(runs()).toHaveLength(1);
  });

  it("a spawn whose id is never recorded is sent again next step, with a fresh token", async () => {
    const { w, pending, runs, again } = await setup();
    expect(pending[H]).toMatchObject({ thread: T, sent: 1 });
    const first = runs().at(-1)!;
    // The handle and thread travel beside the call, for `moderator agent ... --handle`.
    expect(first).toMatchObject({ thread: T, handle: H });
    expect(await again()).toEqual([]);
    expect(runs()).toHaveLength(2);
    const second = runs().at(-1)!;
    expect(tokenOf(second.args["task"])).not.toBe(tokenOf(first.args["task"]));
    expect(w.svc.store.callerBySecret(tokenOf(first.args["task"]))).toBeFalsy();
    expect(pending[H]?.sent).toBe(2);
  });

  it("after `agent` confirms it (or the agent ACKs its packet) it is not sent again", async () => {
    const a = await setup();
    delete a.pending[ownerOf(T, a.pending, a.s.stages)];
    await a.again();
    expect(a.runs()).toHaveLength(1);

    const b = await setup();
    await b.w.as(H, "designer")("bbs_ack_packet", {
      thread_id: T,
      packet_id: b.pending[H]!.packet,
    });
    await b.again();
    expect(b.runs()).toHaveLength(1);
    expect(b.pending).toEqual({});
  });

  it(`${MAX_REEMITS} re-emits, then one ??? to the Sysop`, async () => {
    const { w, pending, runs, again } = await setup();
    for (let i = 0; i < MAX_REEMITS + 3; i++) await again();
    expect(runs()).toHaveLength(1 + MAX_REEMITS);
    const asks = w.svc.p.tasks[T]!.posts.filter(
      (p) => p.type === "ASK" && p.text.includes(`${H} never started`),
    );
    expect(asks).toHaveLength(1);
    expect(asks[0]?.text).toMatch(/spawn limits/);
    expect(pending).toEqual({});
  });

  it("respawn --role reviewer on an awaiting-review thread sends a graveyard-reviewer spawn_run", async () => {
    const { pending, s, runs, again } = await setup();
    const rec = s.stages[T]!;
    expect(respawnTarget(T, rec, "running")).toEqual({
      role: "designer",
      handle: H,
    });
    const t = respawnTarget(T, rec, "awaiting-review");
    expect(t).toEqual(respawnTarget(T, rec, "pending", "reviewer"));
    delete pending[H];
    pending[t.handle] = {
      thread: T,
      ...t,
      resume: true,
      packet: "",
      at: 0,
      sent: 0,
    };
    await again();
    expect(runs().at(-1)).toMatchObject({
      handle: `reviewer-${T}`,
      args: { agent: "graveyard-reviewer" },
    });
  });

  it("ids are keyed by handle: an old thread-keyed file migrates, two pending spawns need --handle", () => {
    const stages = {
      [T]: {
        root: "slides-deck",
        idx: 0,
        stage: "outline",
        role: "designer",
        handle: H,
      },
    };
    expect(
      migrateAgents({ [T]: "126253", [`reviewer-${T}`]: "r1" }, stages),
    ).toEqual({ [H]: "126253", [`reviewer-${T}`]: "r1" });
    const p = (handle: string) => ({
      thread: T,
      handle,
      role: "x",
      resume: false,
      packet: "",
      at: 0,
      sent: 1,
    });
    expect(ownerOf(T, {}, stages)).toBe(H);
    expect(ownerOf(T, { r: p(`reviewer-${T}`) }, stages)).toBe(`reviewer-${T}`);
    expect(() =>
      ownerOf(T, { a: p(H), b: p(`reviewer-${T}`) }, stages),
    ).toThrow(/--handle/);
  });

  it(`a packet too big for spawn_run is trimmed to ${SPAWN_TASK_MAX}, keeping token, packet id and goal`, async () => {
    const { w, pending, runs, again } = await setup();
    for (let i = 0; i < 10; i++)
      await w.as("sysop", "sysop")("bbs_post", {
        thread_id: T,
        kind: "NOTE",
        text: `note ${i} ${"boo ".repeat(150)}`,
      });
    const full = await w.mod("bbs_get_packet", { thread_id: T });
    expect(
      String((full as { value: { text: string } }).value.text).length,
    ).toBeGreaterThan(SPAWN_TASK_MAX);
    await again();
    const task = String(runs().at(-1)!.args["task"]);
    expect(task.length).toBeLessThanOrEqual(SPAWN_TASK_MAX);
    const token = tokenOf(task);
    expect(w.svc.store.callerBySecret(token)).toEqual({
      handle: H,
      role: "designer",
    });
    expect(task).toContain(`"authorization: Bearer ${token}"`);
    expect(task).toContain(`packet_id ${pending[H]!.packet}`);
    expect(task).toContain("## goal\nDeck");
    expect(task).toContain(`## summary\n`);
    expect(task).toContain(TRIMMED);
  });

  it("fitPacket trims summary, then tried, then lessons, and keeps goal and next whole", () => {
    const text = [
      "## goal\nDeck\nstage: outline",
      `## summary\n${Array.from({ length: 20 }, (_, i) => `> #${i} ${"x".repeat(50)}`).join("\n")}`,
      "## tried\n- [a] one — no",
      "## lessons\n- l1\n- l2",
      "## next\nwrite it",
    ].join("\n\n");
    const out = fitPacket(text, 400);
    expect(out.length).toBeLessThanOrEqual(400);
    expect(out).toContain("## goal\nDeck\nstage: outline");
    expect(out).toContain("## next\nwrite it");
    expect(out).toContain(`> #19 `);
    expect(out).not.toContain("> #0 ");
    expect(out).toContain("## tried\n- [a] one — no");
    expect(out.split(TRIMMED)).toHaveLength(2);
    expect(fitPacket(text, 10_000)).toBe(text);
  });
});

describe("runners", () => {
  it("task 8 KiroCliRunner runs `kiro-cli chat --no-interactive --agent <role>` with the token in env", async () => {
    const seen: { file: string; args: string[]; env: NodeJS.ProcessEnv }[] = [];
    const r = new KiroCliRunner((file, args, o) => {
      seen.push({ file, args, env: o.env });
      return { pid: 4242 };
    });
    const id = await r.spawn({
      thread: "slides-a",
      handle: "builder-1",
      role: "builder",
      task: "do it",
      env: { GRAVEYARD_TOKEN: "gy_x", GRAVEYARD_TASK: "slides-a" },
    });
    expect(id).toBe("4242");
    expect(seen[0]).toMatchObject({
      file: "kiro-cli",
      args: [
        "chat",
        "--no-interactive",
        "--agent",
        "graveyard-builder",
        "do it",
      ],
    });
    expect(seen[0]?.env["GRAVEYARD_TOKEN"]).toBe("gy_x");
    expect(await r.steer()).toBe(false);
  });

  it("KiroCrewRunner passes cwd to spawn_run when given", async () => {
    const r = new KiroCrewRunner();
    await r.spawn({
      thread: "t",
      handle: "h",
      role: "builder",
      task: "x",
      env: {},
      cwd: "/tmp/wt",
    });
    expect(r.calls[0]?.args["cwd"]).toBe("/tmp/wt");
  });

  it("every role maps to an agent file that exists, in the app and in .kiro", () => {
    const root = join(import.meta.dirname, "../../..");
    for (const dir of ["app/agents", ".kiro/agents"])
      for (const f of readdirSync(join(root, dir))) {
        const role = f.replace(/\.json$/, "");
        const file = JSON.parse(readFileSync(join(root, dir, f), "utf8")) as {
          name: string;
        };
        expect(file.name).toBe(agentName(role));
      }
  });
});
