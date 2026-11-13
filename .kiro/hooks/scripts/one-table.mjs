// PreToolUse hook (fail closed): the status transition table may live only in core/src/status.ts.
// Exit 0 = allow, exit 2 = deny with stderr to the agent.
import { readFileSync } from "node:fs";

let event = {};
try { event = JSON.parse(readFileSync(0, "utf8") || "{}"); } catch { process.exit(0); }

const input = event?.tool_input ?? {};
const path = String(input.path ?? "");
const text = [input.content, input.text, input.newStr, input.new_str, input.file_text]
  .filter((v) => typeof v === "string")
  .join("\n");

const allowed = path.endsWith("packages/core/src/status.ts");
const definesTable = /\bTRANSITIONS\s*=\s*\[/.test(text) || /from:\s*["']running["'][^}]*to:\s*["']done["']/.test(text);

if (definesTable && !allowed) {
  console.error(
    "Blocked: the status transition table lives only in packages/core/src/status.ts. " +
    "Import TRANSITIONS from @graveyard/core instead of redefining it.",
  );
  process.exit(2);
}
process.exit(0);
