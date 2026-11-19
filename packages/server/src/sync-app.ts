import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative } from "node:path";

function files(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? files(join(dir, e.name)) : [join(dir, e.name)],
  );
}

/**
 * `.kiro/agents` as an installed app sees them. Kiro Crew only renders `{NAME}`
 * placeholders for its builtin apps and refuses to register an agent that holds
 * one, so the app copy has none: steering is inlined into the prompt (instead of
 * `resources`) and the launcher is called by its installed path.
 * shortcut: assumes the default data home ~/.kiro/crew, upgrade if Crew exposes the app root.
 */
export function appAgent(src: string, steeringDir: string): string {
  const agent = JSON.parse(src) as { prompt: string; resources?: string[] };
  const all = files(steeringDir).sort();
  const steering = (agent.resources ?? []).flatMap((r) => {
    const rel = r.replace("file://.kiro/steering/", "");
    const re = new RegExp(
      `^${rel.replace(/[.+^$()|[\]\\]/g, "\\$&").replace("*", "[^/]*")}$`,
    );
    return all.filter((f) => re.test(relative(steeringDir, f)));
  });
  delete agent.resources;
  agent.prompt =
    agent.prompt.replaceAll(
      "node packages/moderator/bin/moderator.mjs",
      "python3 ~/.kiro/crew/apps/graveyard-bbs/bin/gy.py moderator",
    ) +
    steering
      .map(
        (f) =>
          `\n\n## ${relative(steeringDir, f)}\n\n${readFileSync(f, "utf8").trim()}`,
      )
      .join("");
  return `${JSON.stringify(agent, null, 2)}\n`;
}

/** Copy agents and steering into `app/`; with `check`, only report drift. Returns drifted paths (relative to root). */
export function syncApp(root: string, check: boolean): string[] {
  const drift: string[] = [];
  const put = (to: string, text: string) => {
    if (existsSync(to) && readFileSync(to, "utf8") === text) return;
    drift.push(relative(root, to));
    if (!check) {
      mkdirSync(dirname(to), { recursive: true });
      writeFileSync(to, text);
    }
  };
  const agents = join(root, ".kiro", "agents");
  const steering = join(root, ".kiro", "steering");
  for (const f of readdirSync(agents).filter((x) => x.endsWith(".json")))
    put(
      join(root, "app", "agents", f),
      appAgent(readFileSync(join(agents, f), "utf8"), steering),
    );
  for (const f of files(steering))
    put(
      join(root, "app", "steering", relative(steering, f)),
      readFileSync(f, "utf8"),
    );
  return drift;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const check = process.argv.includes("--check");
  const drift = syncApp(process.cwd(), check);
  if (check && drift.length > 0) {
    console.error(
      `app/ has drifted from .kiro: ${drift.join(", ")}. Run: npm run sync-app`,
    );
    process.exit(1);
  }
  console.log(drift.length ? `synced: ${drift.join(", ")}` : "app/ is in sync");
}
