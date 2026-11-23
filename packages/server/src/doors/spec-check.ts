import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { slugOf } from "../boards.js";
import { rootOf } from "../worktree.js";
import { defineDoor } from "./types.js";

const FILES = ["requirements.md", "design.md", "tasks.md"] as const;

/**
 * The spec folder of a root task in its worktree. Designers write `.kiro/specs/<root thread id>/`
 * (e.g. arcade-flip-ghost); `.kiro/specs/<slug>/` is accepted too.
 */
export function specDir(worktree: string, root: string): string {
  const dirs = [root, slugOf(root)].map((d) =>
    join(worktree, ".kiro", "specs", d),
  );
  return dirs.find((d) => existsSync(join(d, "tasks.md"))) ?? dirs[0]!;
}

/**
 * Gate of a design stage: the three spec files exist and are not empty, tasks.md has an open
 * `- [ ]` task, and the Sysop answered the thread's latest ??? with `approve`.
 */
export const specCheck = defineDoor({
  name: "spec_check",
  argsSchema: z.object({}),
  async run(ctx) {
    const root = rootOf(ctx.svc.p.tasks, ctx.thread_id);
    const dir = specDir(ctx.worktree, root);
    const problems: string[] = [];
    for (const f of FILES) {
      const p = join(dir, f);
      if (!existsSync(p)) problems.push(`missing ${f}`);
      else if (readFileSync(p, "utf8").trim() === "")
        problems.push(`empty ${f}`);
    }
    const tasks = join(dir, "tasks.md");
    const tasksText = existsSync(tasks) ? readFileSync(tasks, "utf8") : "";
    // Same rule as the moderator's split (`unchecked` in planner.ts): top-level `- [ ] ` lines.
    if (tasksText.trim() && !/^- \[ \] /m.test(tasksText))
      problems.push("tasks.md has no open `- [ ]` task");

    const events = ctx.svc.store
      .events()
      .filter((e) => e.thread_id === ctx.thread_id);
    const ask = events.filter((e) => e.type === "ASK").at(-1);
    const approved =
      ask !== undefined &&
      events.some(
        (e) =>
          e.type === "ANSWER" &&
          e.body.ask_id === ask.id &&
          /^\s*approve\b/i.test(e.body.text),
      );
    if (!approved)
      problems.push(
        ask ? "the latest ??? has no ANSWER approve" : "no ??? asked yet",
      );

    const rel = dir.slice(ctx.worktree.length + 1);
    return {
      exitCode: problems.length ? 1 : 0,
      log: [
        `spec folder: ${rel}`,
        ...(problems.length ? problems.map((p) => `FAIL ${p}`) : ["OK"]),
        "",
      ].join("\n"),
      extra: { spec_dir: rel, problems },
    };
  },
});
