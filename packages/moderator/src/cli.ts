import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { EventSchema } from "@graveyard/core";
import { z } from "zod";
import { step, type Bbs } from "./execute.js";
import { loadPipelines } from "./pipeline.js";
import { recover, seedHub, storedCursor, type State } from "./planner.js";
import { KiroCliRunner, KiroCrewRunner } from "./runner.js";

const USAGE = `graveyard-moderator step [--runner crew|cli] [--boards DIR] [--data-dir DIR] [--project NAME]
graveyard-moderator agent <thread> <agent-id>     remember a Kiro Crew agent id (for steering)

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

/** `tasks.md` the designer left in any worktree `<dataDir>/wt/<root>-*`. */
function tasksMdOf(dataDir: string, root: string): string | undefined {
  const wt = join(dataDir, "wt");
  if (!existsSync(wt)) return undefined;
  for (const d of readdirSync(wt).filter((x) => x.startsWith(`${root}-`))) {
    const f = join(wt, d, "tasks.md");
    if (existsSync(f)) return readFileSync(f, "utf8");
  }
  return undefined;
}

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
  const [cmd, thread, id] = positionals;

  if (cmd === "agent" && thread && id) {
    writeJson(agentsFile, { ...readJson(agentsFile, {}), [thread]: id });
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
  const r = await step(
    state,
    {
      bbs,
      runner,
      now: Date.now,
      cwdOf: (t) => {
        const d = join(dataDir, "wt", t);
        return existsSync(d) ? d : undefined;
      },
      tasksMdOf: (root) => tasksMdOf(dataDir, root),
    },
    opts,
  );
  writeJson(stateFile, r.state);
  console.log(
    JSON.stringify(
      { crew_calls: crew.calls, errors: r.errors, actions: r.actions.length },
      null,
      2,
    ),
  );
}

main(process.argv.slice(2)).catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
});
