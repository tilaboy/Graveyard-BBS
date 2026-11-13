import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadBoards } from "../../server/src/boards.js";
import { Service } from "../../server/src/commands.js";
import { loadConfig } from "../../server/src/config.js";
import { createDemoRepo } from "../../server/src/seed.js";
import { Store } from "../../server/src/store.js";
import { buildTools, callTool, type ToolCtx } from "../../server/src/tools.js";
import { step, type Bbs, type Io } from "../src/execute.js";
import { initialState, seedHub } from "../src/planner.js";
import { KiroCliRunner, KiroCrewRunner } from "../src/runner.js";
import { BOARDS, opts } from "./log.js";

const tools = buildTools();

function world() {
  const dir = mkdtempSync(join(tmpdir(), "gy-mod-"));
  const repo = join(dir, "repo");
  createDemoRepo(repo);
  const config = loadConfig(dir, { repo, dataDir: join(dir, "data") });
  const svc = new Service(
    new Store(join(dir, "g.db")),
    config,
    loadBoards(BOARDS),
  );
  const ctx = (handle: string, role: ToolCtx["actor"]["role"]): ToolCtx => ({
    svc,
    doors: [],
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
  const io: Io = { bbs, runner, now: () => Date.UTC(2026, 9, 31, 23, 0, 0) };
  return { svc, as, mod, bbs, runner, io };
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
    expect(spawn.args["agent"]).toBe("builder");
    expect(task).toContain(
      '## lessons\n- "signup form has no alt text (review rejected)" (from graveyard-bbs/websites-landing-build)',
    );
    const token = /GRAVEYARD_TOKEN=(gy_[0-9a-f]+)/.exec(task)?.[1];
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

    w.runner.recordAgent(t, "agent-42");
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
      args: ["chat", "--no-interactive", "--agent", "builder", "do it"],
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
});
