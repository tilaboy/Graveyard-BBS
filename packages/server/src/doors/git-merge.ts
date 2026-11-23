import { z } from "zod";
import { rootOf, run } from "../worktree.js";
import { defineDoor } from "./types.js";

/**
 * R4.3: merges the top task's shared branch `gy/<root>` (every stage and split thread commits
 * there) into the branch checked out in the repo (main). It runs in the repo, not the root
 * worktree: that worktree has `gy/<root>` checked out, so main cannot be merged into there.
 * The `merge` fencing token is checked by the runner; runDoor refuses split build threads.
 */
export const gitMerge = defineDoor({
  name: "git_merge",
  lock: "merge",
  argsSchema: z.object({}),
  async run(ctx) {
    const branch = `gy/${rootOf(ctx.svc.p.tasks, ctx.thread_id)}`;
    const r = await run(
      "git",
      [
        "-c",
        "user.name=graveyard",
        "-c",
        "user.email=graveyard@localhost",
        "merge",
        "--no-ff",
        "-m",
        `merge ${branch}`,
        branch,
      ],
      ctx.svc.config.repo,
    );
    return { exitCode: r.code, log: r.out, extra: { branch } };
  },
});
