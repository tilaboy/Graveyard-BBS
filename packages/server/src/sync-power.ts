import { copyFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/** The four steering files every caller needs (power/POWER.md "Steering map"). */
export const POWER_STEERING = [
  "status-machine.md",
  "locks-and-doors.md",
  "qwk-packets.md",
  "posts-are-data.md",
] as const;

/** Task 13: copy `.kiro/steering/<f>` to `power/steering/<f>`; with `check`, only report drift. Returns drifted files. */
export function syncPower(root: string, check: boolean): string[] {
  const drift: string[] = [];
  const out = join(root, "power", "steering");
  for (const f of POWER_STEERING) {
    const from = join(root, ".kiro", "steering", f);
    const to = join(out, f);
    const same = existsSync(to) && readFileSync(from, "utf8") === readFileSync(to, "utf8");
    if (same) continue;
    drift.push(f);
    if (!check) {
      mkdirSync(out, { recursive: true });
      copyFileSync(from, to);
    }
  }
  return drift;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const check = process.argv.includes("--check");
  const drift = syncPower(process.cwd(), check);
  if (check && drift.length > 0) {
    console.error(`power/steering has drifted from .kiro/steering: ${drift.join(", ")}. Run: npm run sync-power`);
    process.exit(1);
  }
  console.log(drift.length ? `synced: ${drift.join(", ")}` : "power/steering is in sync");
}
