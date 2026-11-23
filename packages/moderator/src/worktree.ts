import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/** The top task of a thread: stage and split threads follow `parent` up to the Sysop's task. */
export function rootOf(
  tasks: Record<string, { parent?: string } | undefined>,
  thread: string,
): string {
  let root = thread;
  const seen = new Set<string>();
  while (!seen.has(root)) {
    seen.add(root);
    const up = tasks[root]?.parent;
    if (!up || !tasks[up]) break;
    root = up;
  }
  return root;
}

/**
 * The worktree an agent of `thread` works in: the TOP task's (its stages share it), made on
 * demand with the same path and branch the server's doors use (`<data-dir>/wt/<root>`, `gy/<root>`).
 */
export function worktreeOf(
  dataDir: string,
  repo: string,
  tasks: Record<string, { parent?: string } | undefined>,
  thread: string,
): string | undefined {
  const root = rootOf(tasks, thread);
  const d = join(dataDir, "wt", root);
  if (existsSync(d)) return d;
  const git = (...a: string[]) =>
    spawnSync("git", a, { cwd: repo, encoding: "utf8" }).status === 0;
  const made =
    git("worktree", "add", d, "-b", `gy/${root}`) ||
    git("worktree", "add", d, `gy/${root}`); // branch left over from an earlier run
  return made && existsSync(d) ? d : undefined;
}

/**
 * `tasks.md` the designer left in the root's worktree: `<data-dir>/wt/<root>/.kiro/specs/<root>/`
 * (the server's spec_check door also accepts `.kiro/specs/<slug>/`, the id after `<board>-`).
 */
export function tasksMdOf(dataDir: string, root: string): string | undefined {
  const slug = root.slice(root.indexOf("-") + 1);
  for (const d of [root, slug]) {
    const f = join(dataDir, "wt", root, ".kiro", "specs", d, "tasks.md");
    if (existsSync(f)) return readFileSync(f, "utf8");
  }
  return undefined;
}
