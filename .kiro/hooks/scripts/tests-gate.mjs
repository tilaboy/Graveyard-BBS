// Stop hook: run core tests. If they fail, return a block decision so the agent keeps going.
// This is Graveyard BBS's own rule applied to building Graveyard BBS: no "done" while tests are red.
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";

if (!existsSync("packages/core/package.json")) process.exit(0);

try {
  execFileSync("npm", ["test", "--silent", "-w", "packages/core"], { stdio: "pipe", timeout: 110000 });
} catch (err) {
  const out = (String(err.stdout ?? "") + String(err.stderr ?? "")).slice(-3000);
  console.log(JSON.stringify({
    decision: "block",
    reason: `Core tests are failing. Fix the code (never weaken tests) before stopping.\n${out}`,
  }));
}
