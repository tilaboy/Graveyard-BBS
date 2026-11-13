import type { z } from "zod";
import type { Board } from "../boards.js";
import type { Service } from "../commands.js";

export interface DoorContext {
  svc: Service;
  board: Board;
  thread_id: string;
  caller: string;
  /** Git worktree of the thread (R4.1). */
  worktree: string;
}

export interface DoorResult {
  exitCode: number;
  log: string;
  extra?: Record<string, unknown>;
}

/** Design: `{ name, roles, lock?, argsSchema, run(ctx) }`. Roles come from the board steering file. */
export interface Door<S extends z.ZodType = z.ZodType> {
  name: string;
  /** Lock whose fencing token the caller must pass as `lock_token` (R4.3). */
  lock?: string;
  argsSchema: S;
  run(ctx: DoorContext, args: z.infer<S>): Promise<DoorResult>;
}

/** Registry entry with the args type erased after validation. */
export interface RegisteredDoor {
  name: string;
  lock?: string;
  argsSchema: z.ZodType;
  run(ctx: DoorContext, args: unknown): Promise<DoorResult>;
}

export const defineDoor = <S extends z.ZodType>(
  d: Door<S>,
): RegisteredDoor => ({
  name: d.name,
  ...(d.lock ? { lock: d.lock } : {}),
  argsSchema: d.argsSchema,
  run: (ctx, args) => d.run(ctx, d.argsSchema.parse(args)),
});
