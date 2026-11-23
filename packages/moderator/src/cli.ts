import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { EventSchema, fold } from "@graveyard/core";
import { z } from "zod";
import { execute, step, type Bbs } from "./execute.js";
import { loadPipelines } from "./pipeline.js";
import {
  isSpecStage,
  recover,
  seedHub,
  selectLessons,
  storedCursor,
  type State,
} from "./planner.js";
import { KiroCliRunner, KiroCrewRunner } from "./runner.js";
import { tasksMdOf, worktreeOf } from "./worktree.js";

const USAGE = `graveyard-moderator step [--runner crew|cli] [--boards DIR] [--data-dir DIR] [--project NAME]
graveyard-moderator agent <thread> <agent-id>     remember a Kiro Crew agent id (for steering)
graveyard-moderator respawn <thread>              queue a resume spawn for a stage with no live agent (rotates the child token)

Env: GRAVEYARD_URL (default http://127.0.0.1:2626), GRAVEYARD_TOKEN (the moderator's token).
"step" prints JSON: crew_calls (Kiro Crew tool calls YOU must make), errors, actions.`;

function http(url: string, token: string): Bbs {
  const h = {
    authorization: `Bearer ${token}`,
    "content-type": "application/json",
  };
  return {
    async call(tool, args) {
      const res = await fetch(`${url}/api/tools/${tool}`, {
        method: "POST",
        headers: h,
        body: JSON.stringify(args),
      });
      return (await res.json()) as Awaited<ReturnType<Bbs["call"]>>;
    },
    async events() {
      const res = await fetch(`${url}/api/events?after=0`, { headers: h });
      return z.array(EventSchema).parse(await res.json());
    },
  };
}

const readJson = <T>(path: string, fallback: T): T =>
  existsSync(path) ? (JSON.parse(readFileSync(path, "utf8")) as T) : fallback;
const writeJson = (path: string, v: unknown) => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(v, null, 2));
};

async function main(argv: string[]) {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      runner: { type: "string", default: "crew" },
      boards: { type: "string", default: ".kiro/steering/boards" },
      "data-dir": { type: "string", default: ".graveyard" },
      project: { type: "string", default: "graveyard-bbs" },
    },
  });
  const dataDir = resolve(values["data-dir"]);
  const agentsFile = join(dataDir, "moderator-agents.json");
  const stateFile = join(dataDir, "moderator-state.json");
  const respawnFile = join(dataDir, "moderator-respawn.json");
  const [cmd, thread, id] = positionals;

  if (cmd === "agent" && thread && id) {
    writeJson(agentsFile, { ...readJson(agentsFile, {}), [thread]: id });
    return;
  }
  if (cmd === "respawn" && thread) {
    // A spawn that never became a live agent. A shell cannot call spawn_run, so this only
    // QUEUES it; the next scheduled `step` (a Crew session) makes the call.
    const state = readJson<State | undefined>(stateFile, undefined);
    if (!state?.stages[thread])
      throw new Error(`no stage '${thread}' in ${stateFile}`);
    const q = new Set(readJson<string[]>(respawnFile, []));
    q.add(thread);
    writeJson(respawnFile, [...q]);
    const agents = readJson<Record<string, string>>(agentsFile, {});
    delete agents[thread];
    writeJson(agentsFile, agents);
    console.log(
      `queued ${thread}; the next moderator-step spawns it with a fresh token.`,
    );
    return;
  }
  if (cmd !== "step") {
    console.log(USAGE);
    process.exitCode = cmd ? 1 : 0;
    return;
  }
  const url = process.env["GRAVEYARD_URL"] ?? "http://127.0.0.1:2626";
  const token = process.env["GRAVEYARD_TOKEN"];
  if (!token) throw new Error("GRAVEYARD_TOKEN is not set");
  const bbs = http(url, token);
  const opts = {
    pipelines: loadPipelines(resolve(values.boards)),
    project: values.project,
  };
  // R7.1: resume from the state file, or rebuild it from the log up to the cursor note.
  const log = await bbs.events();
  let state: State =
    readJson<State | undefined>(stateFile, undefined) ??
    recover(log, storedCursor(log), opts);
  const hub = await bbs.call("bbs_list_lessons", {});
  if (hub.ok)
    state = seedHub(state, hub.value as Parameters<typeof seedHub>[1]);

  const crew = new KiroCrewRunner(readJson(agentsFile, {}));
  const runner = values.runner === "cli" ? new KiroCliRunner() : crew;
  const io = {
    bbs,
    runner,
    now: Date.now,
    bbsUrl: url,
    cwdOf: async (t: string) =>
      worktreeOf(dataDir, process.cwd(), fold(await bbs.events()).tasks, t),
    tasksMdOf: (root: string) => tasksMdOf(dataDir, root),
  };
  // Queued respawns (`moderator respawn <thread>`): stages whose earlier spawn never ran.
  const queued = readJson<string[]>(respawnFile, []);
  const errors: string[] = [];
  if (queued.length) {
    const p = fold(log);
    const actions = queued.flatMap((t) => {
      const rec = state.stages[t];
      const st = p.tasks[t]?.status;
      if (!rec || !st || st === "done" || st === "cancelled") return [];
      const goal = `${p.tasks[rec.root]?.text ?? ""} ${p.tasks[t]?.text ?? ""}`;
      return [
        {
          type: "spawn" as const,
          thread: t,
          handle: rec.handle,
          role: rec.role,
          resume: true,
          lessons: selectLessons(state.lessons, goal, t.split("-")[0] ?? "", t),
          // A design stage resumed after the Sysop's approve gets the spec_check steps.
          ...(isSpecStage(opts.pipelines, rec, t) ? { spec: true } : {}),
        },
      ];
    });
    const done = await execute(actions, io, values.project);
    errors.push(...done.errors);
    writeJson(respawnFile, []);
  }
  const r = await step(state, io, opts);
  writeJson(stateFile, r.state);
  console.log(
    JSON.stringify(
      {
        crew_calls: crew.calls,
        errors: [...errors, ...r.errors],
        actions: r.actions.length,
      },
      null,
      2,
    ),
  );
}

main(process.argv.slice(2)).catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
});
