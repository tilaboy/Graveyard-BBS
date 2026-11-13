import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

export interface Shell {
  code: number;
  out: string;
}

/** Run a program (no shell) with a timeout. Never throws; a timeout is code 124. */
export function run(
  file: string,
  args: string[],
  cwd: string,
  timeoutMs = 120_000,
): Promise<Shell> {
  return new Promise((resolve) => {
    execFile(
      file,
      args,
      { cwd, timeout: timeoutMs, maxBuffer: 8 * 1024 * 1024 },
      (err, stdout, stderr) => {
        const e = err as (NodeJS.ErrnoException & { killed?: boolean }) | null;
        const code = !e
          ? 0
          : e.killed
            ? 124
            : typeof e.code === "number"
              ? e.code
              : 1;
        resolve({
          code,
          out: `${stdout}${stderr}${e && !e.killed && typeof e.code !== "number" ? e.message : ""}`,
        });
      },
    );
  });
}

export const worktreePath = (dataDir: string, threadId: string): string =>
  join(dataDir, "wt", threadId);

/** R4.1: `git worktree add <dataDir>/wt/<task-id> -b gy/<task-id>`, created on first use. */
export async function ensureWorktree(
  repo: string,
  dataDir: string,
  threadId: string,
): Promise<string | { error: string }> {
  const path = worktreePath(dataDir, threadId);
  if (existsSync(path)) return path;
  const r = await run(
    "git",
    ["worktree", "add", path, "-b", `gy/${threadId}`],
    repo,
  );
  return r.code === 0 ? path : { error: r.out.trim() };
}

export async function headSha(cwd: string): Promise<string | null> {
  const r = await run("git", ["rev-parse", "HEAD"], cwd, 10_000);
  return r.code === 0 ? r.out.trim() : null;
}
