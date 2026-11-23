import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  authorizeDoor,
  checkToken,
  Emitter,
  type Actor,
  type Result,
} from "@graveyard/core";
import { z } from "zod";
import { boardOf } from "../boards.js";
import { toolFail, type Service, type ToolError } from "../commands.js";
import { ensureWorktree, headSha, rootOf } from "../worktree.js";
import { deploy } from "./deploy.js";
import { gitMerge } from "./git-merge.js";
import { imageGen } from "./image-gen.js";
import { publish } from "./publish.js";
import { runTests } from "./run-tests.js";
import { specCheck } from "./spec-check.js";
import type { RegisteredDoor } from "./types.js";

export function defaultDoors(): RegisteredDoor[] {
  return [runTests, gitMerge, deploy, imageGen, publish, specCheck];
}

const TokenArg = z.object({ lock_token: z.number().int().positive() });

/**
 * R4: authorize (role, ACK, budget via core), check the fencing token, run in the worktree,
 * store the full log, append EVIDENCE as the server.
 */
export async function runDoor(
  svc: Service,
  doors: readonly RegisteredDoor[],
  actor: Actor,
  threadId: string,
  doorName: string,
  rawArgs: unknown,
): Promise<
  Result<
    { evidence_id: string; exit_code: number; extra: Record<string, unknown> },
    ToolError
  >
> {
  const board = svc.boards[boardOf(threadId)];
  if (!board)
    return toolFail(
      "NOT_FOUND",
      `no board for thread ${threadId}`,
      "Thread ids look like <board>-<slug>.",
    );
  const auth = authorizeDoor(svc.p, board, actor, doorName, threadId);
  if (!auth.ok) return auth;
  const door = doors.find((d) => d.name === doorName);
  if (!door)
    return toolFail(
      "NOT_FOUND",
      `door '${doorName}' is not installed`,
      "Check the board's Doors table.",
    );
  if (door.name === "git_merge" && !svc.mayMerge(threadId))
    return toolFail(
      "ILLEGAL_TRANSITION",
      `git_merge does not run on ${threadId}: its stage's gate names no merge`,
      `Close this thread with REVIEW pass and done (run_tests is its gate). The top task's branch gy/${rootOf(svc.p.tasks, threadId)} is merged once, on the review stage thread.`,
    );

  const args = door.argsSchema.safeParse(rawArgs ?? {});
  if (!args.success)
    return toolFail(
      "BAD_ARGS",
      args.error.issues
        .map((i) => `${i.path.join(".")}: ${i.message}`)
        .join("; "),
      "Fix the door arguments.",
    );
  if (door.lock) {
    const tok = TokenArg.safeParse(rawArgs);
    if (!tok.success)
      return toolFail(
        "BAD_ARGS",
        `door '${door.name}' needs lock_token for lock '${door.lock}'`,
        `Claim '${door.lock}' with bbs_claim_lock first.`,
      );
    // R4.3: stale token or a lock held by another thread -> refuse.
    const held = svc.p.locks[door.lock]?.holder;
    const stale = checkToken(
      new Emitter(svc.p, svc.ctx()),
      door.lock,
      tok.data.lock_token,
    );
    if (!stale.ok) return stale;
    if (held?.thread !== threadId)
      return toolFail(
        "STALE_TOKEN",
        `lock ${door.lock} is held by another thread`,
        "Claim the lock again.",
      );
  }

  const wt = await ensureWorktree(
    svc.config.repo,
    svc.config.dataDir,
    rootOf(svc.p.tasks, threadId),
  );
  if (typeof wt !== "string")
    return toolFail(
      "DOOR_FAILED",
      `worktree failed: ${wt.error}`,
      "The repo must be a git repo with a commit.",
    );

  const started = Date.now();
  let res;
  try {
    res = await door.run(
      { svc, board, thread_id: threadId, caller: actor.handle, worktree: wt },
      args.data,
    );
  } catch (e) {
    res = {
      exitCode: 1,
      log: `door crashed: ${e instanceof Error ? e.message : String(e)}\n`,
      extra: {},
    };
  }

  // R4.2: full log in the file area, addressed by sha256.
  const logSha = createHash("sha256").update(res.log).digest("hex");
  const dir = join(svc.config.dataDir, "files");
  mkdirSync(dir, { recursive: true });
  const logPath = join(dir, logSha);
  writeFileSync(logPath, res.log);
  svc.store.addFile({
    sha256: logSha,
    thread_id: threadId,
    name: `${door.name}.log`,
    path: logPath,
  });

  const posted = svc.postEvidence(threadId, {
    door: door.name,
    args: rawArgs ?? {},
    exit_code: res.exitCode,
    duration_ms: Date.now() - started,
    commit: await headSha(wt),
    log_sha256: logSha,
    extra: res.extra ?? {},
  });
  if (!posted.ok) return posted;
  return {
    ok: true,
    value: {
      evidence_id: posted.value[0]!.id,
      exit_code: res.exitCode,
      extra: res.extra ?? {},
    },
  };
}
