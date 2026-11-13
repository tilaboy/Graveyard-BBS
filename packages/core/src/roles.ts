import type { Actor } from "./emit.js";
import type { Role } from "./events.js";
import type { Projections } from "./fold.js";
import { fail, ok, type Result } from "./voice.js";

/** Per-board door permissions, read from the board steering file by the server. */
export interface BoardConfig {
  doors: Record<string, readonly Role[]>;
}

/** R6.2, R5.3, R4: may this caller run this door on this thread right now? */
export function authorizeDoor(
  p: Projections,
  board: BoardConfig,
  actor: Actor,
  door: string,
  threadId: string,
): Result<void> {
  const allowed = board.doors[door];
  if (!allowed)
    return fail(
      "NOT_FOUND",
      `door '${door}' does not exist on this board`,
      "List the doors with the board steering file.",
    );
  if (actor.role === "server" || !allowed.includes(actor.role)) {
    return fail(
      "ROLE_DENIED",
      `role '${actor.role}' may not run door '${door}'`,
      `Allowed roles: ${allowed.join(", ")}.`,
    );
  }
  const t = p.tasks[threadId];
  if (!t)
    return fail(
      "NOT_FOUND",
      `thread ${threadId} does not exist`,
      "Check the thread id.",
    );
  if (t.packet === null || t.acked !== t.packet) {
    return fail(
      "NO_ACK",
      `no ACK of the latest QWK packet on ${threadId}`,
      "Post ACK <packet-id> first.",
    );
  }
  const b = t.budget;
  if (
    b.turns_left <= 0 ||
    b.seconds_left <= 0 ||
    (b.credits_left !== undefined && b.credits_left <= 0)
  ) {
    return fail(
      "BUDGET_EXHAUSTED",
      `budget of ${threadId} is spent`,
      "Ask the Sysop to raise it.",
    );
  }
  return ok(undefined);
}
