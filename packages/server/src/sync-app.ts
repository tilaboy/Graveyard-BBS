import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative } from "node:path";

/** `.kiro/agents` as an installed app sees them: steering and launcher through `{APP_ROOT}` (spec 05 design §6). */
export function appAgent(src: string): string {
  return src
    .replaceAll("file://.kiro/steering/", "file://{APP_ROOT}/steering/")
    .replaceAll(
      "node packages/moderator/bin/moderator.mjs",
      "python3 {APP_ROOT}/bin/gy.py moderator",
    );
}

function files(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? files(join(dir, e.name)) : [join(dir, e.name)],
  );
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
  for (const f of readdirSync(agents).filter((x) => x.endsWith(".json")))
    put(
      join(root, "app", "agents", f),
      appAgent(readFileSync(join(agents, f), "utf8")),
    );
  const steering = join(root, ".kiro", "steering");
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
