// PostToolUse hook: typecheck the workspace package that contains the written file.
// Warn-only: PostToolUse never blocks; stderr is shown to the agent.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

let event = {};
try { event = JSON.parse(readFileSync(0, "utf8") || "{}"); } catch { process.exit(0); }

const path = String(event?.tool_input?.path ?? "");
const m = path.match(/packages\/([^/]+)\//);
if (!m) process.exit(0);
const pkg = `packages/${m[1]}`;
if (!existsSync(`${pkg}/tsconfig.json`)) process.exit(0);

try {
  execFileSync("npx", ["--no-install", "tsc", "--noEmit", "-p", pkg], { stdio: "pipe" });
} catch (err) {
  const out = String(err.stdout ?? "") + String(err.stderr ?? "");
  console.error(`Typecheck failed in ${pkg}:\n${out.slice(0, 4000)}`);
  process.exit(1);
}
