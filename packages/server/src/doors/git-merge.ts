import { z } from "zod";
import { run } from "../worktree.js";
import { defineDoor } from "./types.js";

/** R4.3: merges `gy/<thread>` into the repo's checked-out branch. The `merge` fencing token is checked by the runner. */
export const gitMerge = defineDoor({
  name: "git_merge",
  lock: "merge",
  argsSchema: z.object({}),
  async run(ctx) {
    const r = await run(
      "git",
      ["-c", "user.name=graveyard", "-c", "user.email=graveyard@localhost", "merge", "--no-ff", "-m", `merge gy/${ctx.thread_id}`, `gy/${ctx.thread_id}`],
      ctx.svc.config.repo,
    );
    return { exitCode: r.code, log: r.out, extra: { branch: `gy/${ctx.thread_id}` } };
  },
});
