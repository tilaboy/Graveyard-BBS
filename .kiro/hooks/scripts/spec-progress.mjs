// SessionStart hook: print unchecked tasks from every spec so the agent starts from the plan.
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const specsDir = ".kiro/specs";
if (!existsSync(specsDir)) process.exit(0);

const lines = ["# Graveyard BBS open spec tasks"];
for (const spec of readdirSync(specsDir).sort()) {
  const file = join(specsDir, spec, "tasks.md");
  if (!existsSync(file)) continue;
  const tasks = readFileSync(file, "utf8").split("\n");
  const open = tasks.filter((l) => /^\s*- \[ \]/.test(l));
  const doneCount = tasks.filter((l) => /^\s*- \[x\]/i.test(l)).length;
  lines.push(`\n## ${spec} (${doneCount} done, ${open.length} open)`);
  lines.push(...open.slice(0, 5));
}
console.log(lines.join("\n"));
