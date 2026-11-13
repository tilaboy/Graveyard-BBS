import { DEFAULT_LEASE_MS, type Actor, type Emitter } from "./emit.js";
import { moveStatus, isTerminal } from "./status.js";
import { fail, ok, type Result } from "./voice.js";

const SERVER: Actor = { handle: "server", role: "server" };
const leaseOf = (em: Emitter) => em.ctx.leaseMs ?? DEFAULT_LEASE_MS;

/** Every door that touches a locked resource calls this with the caller's fencing token (R2.1). */
export function checkToken(
  em: Emitter,
  lock: string,
  token: number,
): Result<void> {
  const h = em.p.locks[lock]?.holder;
  return h && h.token === token
    ? ok(undefined)
    : fail(
        "STALE_TOKEN",
        `token ${token} for lock ${lock} is stale`,
        "Claim the lock again and use the new token.",
      );
}

/** Hand a free lock to the first queued task that is still waiting for it (R2.3). */
function grantNext(em: Emitter, name: string): void {
  const l = em.p.locks[name];
  while (l && !em.p.locks[name]!.holder && em.p.locks[name]!.queue.length > 0) {
    const head = em.p.locks[name]!.queue[0]!;
    const t = em.p.tasks[head.thread];
    if (t?.status !== "blocked" || t.reason !== `lock:${name}`) {
      em.push({
        type: "RELEASE",
        thread_id: head.thread,
        caller: head.caller,
        body: { lock: name },
      });
      continue;
    }
    const token = em.p.locks[name]!.lastToken + 1;
    em.push({
      type: "GRANT",
      thread_id: head.thread,
      caller: head.caller,
      body: { lock: name, token, expiresAt: em.ctx.now + leaseOf(em) },
    });
    moveStatus(em, head.thread, "running", SERVER);
  }
}

/** Drop a thread from every lock it holds or waits for, then pass the locks on. */
export function releaseAll(
  em: Emitter,
  threadId: string,
  caller: string,
): void {
  const names = Object.values(em.p.locks)
    .filter(
      (l) =>
        l.holder?.thread === threadId ||
        l.queue.some((q) => q.thread === threadId),
    )
    .map((l) => l.name);
  for (const lock of names)
    em.push({ type: "RELEASE", thread_id: threadId, caller, body: { lock } });
  for (const lock of names) grantNext(em, lock);
}

/** R2.1 / R2.2 / R2.7 */
export function claim(
  em: Emitter,
  actor: Actor,
  threadId: string,
  lock: string,
): Result<{ granted: boolean; token?: number; position?: number }> {
  const t = em.p.tasks[threadId];
  if (!t)
    return fail(
      "NOT_FOUND",
      `thread ${threadId} does not exist`,
      "Check the thread id.",
    );
  if (t.owner !== actor.handle) {
    return fail(
      "ROLE_DENIED",
      `'${actor.handle}' does not own ${threadId}`,
      "Only the task owner claims locks.",
    );
  }
  if (t.status !== "running") {
    return fail(
      "ILLEGAL_TRANSITION",
      `${t.status} task cannot claim ${lock}`,
      "Only a running task claims locks.",
    );
  }
  const l = em.p.locks[lock];
  if (
    l?.holder?.thread === threadId ||
    l?.queue.some((q) => q.thread === threadId)
  ) {
    return fail(
      "ILLEGAL_TRANSITION",
      `${threadId} already holds or awaits ${lock}`,
      "Release or wait.",
    );
  }
  em.push({
    type: "CLAIM",
    thread_id: threadId,
    caller: actor.handle,
    body: { lock },
  });
  if (!l?.holder) {
    const token = (l?.lastToken ?? 0) + 1;
    em.push({
      type: "GRANT",
      thread_id: threadId,
      caller: actor.handle,
      body: { lock, token, expiresAt: em.ctx.now + leaseOf(em) },
    });
    return ok({ granted: true, token });
  }
  const position = l.queue.length + 1;
  em.push({
    type: "QUEUE",
    thread_id: threadId,
    caller: actor.handle,
    body: { lock, position },
  });
  const moved = moveStatus(em, threadId, "blocked", actor, `lock:${lock}`);
  if (!moved.ok) return moved;
  return ok({ granted: false, position });
}

export function release(
  em: Emitter,
  actor: Actor,
  threadId: string,
  lock: string,
): Result<void> {
  const h = em.p.locks[lock]?.holder;
  if (!h || h.thread !== threadId) {
    return fail(
      "STALE_TOKEN",
      `${threadId} does not hold ${lock}`,
      "Nothing to release.",
    );
  }
  if (h.caller !== actor.handle)
    return fail(
      "ROLE_DENIED",
      `'${actor.handle}' is not the holder`,
      "Only the holder releases.",
    );
  em.push({
    type: "RELEASE",
    thread_id: threadId,
    caller: actor.handle,
    body: { lock },
  });
  grantNext(em, lock);
  return ok(undefined);
}

export function heartbeat(
  em: Emitter,
  actor: Actor,
  threadId: string,
  lock: string,
): Result<void> {
  const h = em.p.locks[lock]?.holder;
  if (!h || h.thread !== threadId || h.caller !== actor.handle) {
    return fail(
      "STALE_TOKEN",
      `${actor.handle} does not hold ${lock}`,
      "The lease may have expired; claim again.",
    );
  }
  em.push({
    type: "HEARTBEAT",
    thread_id: threadId,
    caller: actor.handle,
    body: { lock, expiresAt: em.ctx.now + leaseOf(em) },
  });
  return ok(undefined);
}

/**
 * R2.4: free every lock whose lease ran out, return the holder's task to pending, pass locks on.
 * shortcut: only locks carry a lease, so a task that holds none is never timed out; upgrade
 * when the server adds per-task heartbeats.
 */
export function tick(em: Emitter): void {
  const expired = Object.values(em.p.locks).filter(
    (l) => l.holder && em.ctx.now > l.holder.expiresAt,
  );
  for (const l of expired) {
    const h = em.p.locks[l.name]?.holder;
    if (!h || em.ctx.now <= h.expiresAt) continue; // already freed by an earlier expiry in this tick
    em.push({
      type: "SYSTEM",
      thread_id: h.thread,
      caller: SERVER.handle,
      body: { kind: "lease-expired", lock: l.name },
    });
    const t = em.p.tasks[h.thread];
    if (t && !isTerminal(t.status) && t.status !== "pending")
      moveStatus(em, h.thread, "pending", SERVER);
    releaseAll(em, h.thread, SERVER.handle);
  }
}
