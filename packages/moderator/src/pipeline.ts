import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";

export interface Stage {
  name: string;
  role: string;
  /** #arcade: `vibe` mode skips stages whose Mode cell says "spec only". */
  specOnly: boolean;
  /** Output is a Kiro spec (design): its agents get the spec_check steps. */
  spec: boolean;
}
export type Pipelines = Record<string, Stage[]>;

const cells = (line: string): string[] =>
  line
    .split("|")
    .slice(1, -1)
    .map((c) => c.trim());

/** Stages from the first table under `## Pipeline` of a board steering file (the steering file stays the source of truth). */
export function parsePipeline(md: string): Stage[] {
  const lines = md.split("\n");
  const start = lines.findIndex((l) => l.startsWith("## Pipeline"));
  if (start < 0) return [];
  let head: string[] | undefined;
  const out: Stage[] = [];
  for (const l of lines.slice(start + 1)) {
    if (l.startsWith("## ")) break;
    if (!l.startsWith("|")) continue;
    const c = cells(l);
    if (!head) {
      head = c;
      continue;
    }
    if (/^-+$/.test(c[0] ?? "-")) continue;
    const role = c[head.indexOf("Agent role")] ?? "";
    const mode = head.includes("Mode") ? (c[head.indexOf("Mode")] ?? "") : "";
    out.push({
      name: (c[0] ?? "").replace(/`/g, ""),
      role: /^\w+/.exec(role)?.[0] ?? "",
      specOnly: /spec only/i.test(mode),
      spec: /Kiro spec/i.test(c[head.indexOf("Output")] ?? ""),
    });
  }
  return out;
}

export function loadPipelines(dir: string): Pipelines {
  const out: Pipelines = {};
  if (!existsSync(dir)) return out;
  for (const f of readdirSync(dir).filter((x) => x.endsWith(".md")))
    out[basename(f, ".md")] = parsePipeline(readFileSync(join(dir, f), "utf8"));
  return out;
}
