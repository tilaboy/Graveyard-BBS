import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { ROLES, type BoardConfig, type Role } from "@graveyard/core";

export interface Board extends BoardConfig {
  name: string;
  /** door name -> lock it needs (from the Doors table, "—" means none). */
  doorLocks: Record<string, string | undefined>;
  pathLocks: { glob: string; lock: string }[];
  testCommand?: string;
}

const cells = (line: string): string[] =>
  line
    .split("|")
    .slice(1, -1)
    .map((c) => c.trim().replace(/^`|`$/g, ""));

/** Rows of the first markdown table under a `## <heading>` section. */
function tableRows(md: string, heading: string): string[][] {
  const start = md.split("\n").findIndex((l) => l.startsWith(`## ${heading}`));
  if (start < 0) return [];
  const rows: string[][] = [];
  for (const l of md.split("\n").slice(start + 1)) {
    if (l.startsWith("## ")) break;
    if (!l.startsWith("|")) continue;
    const c = cells(l);
    if (c[0] === "Door" || c[0] === "Path glob" || /^-+$/.test(c[0] ?? "-"))
      continue;
    rows.push(c);
  }
  return rows;
}

/** Design "Config": board steering files are the source of truth for doors, path locks and test command. */
export function parseBoard(name: string, md: string): Board {
  const doors: Record<string, Role[]> = {};
  const doorLocks: Record<string, string | undefined> = {};
  for (const [door, roles, lock] of tableRows(md, "Doors")) {
    if (!door) continue;
    doors[door] = (roles ?? "")
      .split(",")
      .map((r) => r.trim())
      .filter((r): r is Role => (ROLES as readonly string[]).includes(r));
    doorLocks[door] = lock && lock !== "—" ? lock : undefined;
  }
  const pathLocks = tableRows(md, "Path → lock map").flatMap(([globs, lock]) =>
    (globs ?? "")
      .split(",")
      .map((g) => g.trim().replace(/^`|`$/g, ""))
      .filter(Boolean)
      .map((glob) => ({ glob, lock: lock ?? "" })),
  );
  const cmd = /## Test command\s+`([^`]+)`/.exec(md)?.[1];
  return {
    name,
    doors,
    doorLocks,
    pathLocks,
    ...(cmd ? { testCommand: cmd } : {}),
  };
}

export function loadBoards(dir: string): Record<string, Board> {
  const out: Record<string, Board> = {};
  if (!existsSync(dir)) return out;
  for (const f of readdirSync(dir).filter((x) => x.endsWith(".md"))) {
    const name = basename(f, ".md");
    out[name] = parseBoard(name, readFileSync(join(dir, f), "utf8"));
  }
  return out;
}

/** Thread ids are `<board>-<slug>` (a git ref cannot hold ':'). */
export const boardOf = (threadId: string): string =>
  threadId.split("-")[0] ?? "";
export const slugOf = (threadId: string): string =>
  threadId.slice(threadId.indexOf("-") + 1);

/** `**` crosses directories, `*` does not. */
export function globMatch(glob: string, path: string): boolean {
  const re = glob
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*\//g, "\u0000")
    .replace(/\*\*/g, "\u0001")
    .replace(/\*/g, "[^/]*")
    .replace(/\u0000/g, "(?:.*/)?")
    .replace(/\u0001/g, ".*");
  return new RegExp(`^${re}$`).test(path);
}
