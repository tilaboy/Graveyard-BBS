import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { EventSchema, fold } from "@graveyard/core";
import { z } from "zod";
import { step, type Bbs, type SpawnAction } from "./execute.js";
import { loadPipelines } from "./pipeline.js";
import { recover, seedHub, storedCursor, type State } from "./planner.js";
import { KiroCliRunner, KiroCrewRunner } from "./runner.js";
import {
  migrateAgents,
  ownerOf,
  resend,
  respawnTarget,
  ROLES,
  track,
  type Pending,
} from "./spawns.js";
import { tasksMdOf, worktreeOf } from "./worktree.js";

const USAGE = `graveyard-moderator step [--runner crew|cli] [--boards DIR] [--data-dir DIR] [--project NAME]
graveyard-moderator agent <thread> <agent-id> [--handle H]   confirm a spawn: remember its Kiro Crew agent id
graveyard-moderator respawn <thread> [--role ROLE]           queue a spawn (default role: the one the thread waits on)

Env: GRAVEYARD_URL (default http://127.0.0.1:2626), GRAVEYARD_TOKEN (the moderator's token).
"step" prints JSON: crew_calls (Kiro Crew tool calls YOU must make), errors, actions.
A spawn_run stays pending, and is sent again each step with a fresh token, until "agent" confirms it.`;

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
      handle: { type: "string" },
      role: { type: "string" },
    },
  });
  const dataDir = resolve(values["data-dir"]);
  const agentsFile = join(dataDir, "moderator-agents.json");
  const stateFile = join(dataDir, "moderator-state.json");
  const pendingFile = join(dataDir, "moderator-pending.json");
  const [cmd, thread, id] = positionals;
  const saved = readJson<State | undefined>(stateFile, undefined);
  const agents = migrateAgents(readJson(agentsFile, {}), saved?.stages ?? {});
  const pending = readJson<Pending>(pendingFile, {});
  const connect = () => {
    const token = process.env["GRAVEYARD_TOKEN"];
    if (!token) throw new Error("GRAVEYARD_TOKEN is not set");
    const url = process.env["GRAVEYARD_URL"] ?? "http://127.0.0.1:2626";
    return { url, bbs: http(url, token) };
  };

  if (cmd === "agent" && thread && id) {
    const handle =
      values.handle ?? ownerOf(thread, pending, saved?.stages ?? {});
    agents[handle] = id;
    delete pending[handle];
    writeJson(agentsFile, agents);
    writeJson(pendingFile, pending);
    console.log(`${handle} = ${id}`);
    return;
  }
  if (cmd === "respawn" && thread) {
    // A shell cannot call spawn_run, so this only QUEUES it; the next scheduled `step`
    // (a Crew session) sends it with a fresh token.
    const rec = saved?.stages[thread];
    if (!rec) throw new Error(`no stage '${thread}' in ${stateFile}`);
    if (values.role && !(ROLES as readonly string[]).includes(values.role))
      throw new Error(`--role must be one of ${ROLES.join(", ")}`);
    const status = fold(await connect().bbs.events()).tasks[thread]?.status;
    const t = respawnTarget(thread, rec, status, values.role);
    pending[t.handle] = {
      thread,
      ...t,
      resume: true,
      packet: "",
      at: Date.now(),
      sent: 0,
    };
    delete agents[t.handle];
    writeJson(pendingFile, pending);
    writeJson(agentsFile, agents);
    console.log(
      `queued ${t.handle} (${t.role}) on ${thread}; the next moderator-step spawns it with a fresh token.`,
    );
    return;
  }
  if (cmd !== "step") {
    console.log(USAGE);
    process.exitCode = cmd ? 1 : 0;
    return;
  }
  const { url, bbs } = connect();
  const opts = {
    pipelines: loadPipelines(resolve(values.boards)),
    project: values.project,
  };
  // R7.1: resume from the state file, or rebuild it from the log up to the cursor note.
  const log = await bbs.events();
  let state: State = saved ?? recover(log, storedCursor(log), opts);
  const hub = await bbs.call("bbs_list_lessons", {});
  if (hub.ok)
    state = seedHub(state, hub.value as Parameters<typeof seedHub>[1]);

  const crew = new KiroCrewRunner(agents);
  const runner = values.runner === "cli" ? new KiroCliRunner() : crew;
  const io = {
    bbs,
    runner,
    now: Date.now,
    bbsUrl: url,
    cwdOf: async (t: string) =>
      worktreeOf(dataDir, process.cwd(), fold(await bbs.events()).tasks, t),
    tasksMdOf: (root: string) => tasksMdOf(dataDir, root),
    spawned: (a: SpawnAction, packet: string) =>
      track(pending, a, packet, Date.now()),
  };
  // Spawns sent before and never confirmed, plus `respawn` requests. The cli runner starts its
  // process itself, so its spawns need no confirmation: the ledger is cleared after the step.
  const errors = await resend(pending, state, log, io, opts);
  const r = await step(state, io, opts);
  writeJson(stateFile, r.state);
  writeJson(pendingFile, runner === crew ? pending : {});
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
