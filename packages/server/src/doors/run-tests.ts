import { z } from "zod";
import { slugOf } from "../boards.js";
import { rootOf, run } from "../worktree.js";
import { defineDoor } from "./types.js";

/** R4.1 / R4.4: run the board's test command inside the thread's worktree, with a timeout. */
export const runTests = defineDoor({
  name: "run_tests",
  argsSchema: z.object({
    timeout_s: z.number().positive().max(900).default(120),
  }),
  async run(ctx, args) {
    const slug = slugOf(rootOf(ctx.svc.p.tasks, ctx.thread_id));
    const cmd =
      ctx.svc.config.testCommand ??
      ctx.board.testCommand?.replaceAll("<slug>", slug);
    if (!cmd)
      return {
        exitCode: 1,
        log: `board '${ctx.board.name}' has no test command\n`,
      };
    const r = await run("sh", ["-c", cmd], ctx.worktree, args.timeout_s * 1000);
    return {
      exitCode: r.code,
      log: `$ ${cmd}\n${r.out}${r.code === 124 ? "\n[timed out]\n" : ""}`,
      extra: { command: cmd },
    };
  },
});
