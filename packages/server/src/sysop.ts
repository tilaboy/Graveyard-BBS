import { fail, ok, type Actor, type Result } from "@graveyard/core";
import { z } from "zod";
import { SERVER, type Service } from "./commands.js";

/** R6.2 Sysop endpoints. Every one goes through `Service.exec`, so the status rules apply to the Sysop too. */
export const SysopBodies = {
  answer: z.object({ thread_id: z.string(), ask_id: z.string(), text: z.string().min(1) }),
  approve: z.object({ thread_id: z.string(), ask_id: z.string() }),
  cancel: z.object({ thread_id: z.string(), reason: z.string().min(1) }),
  reorder: z.object({ lock: z.string(), order: z.array(z.string()).min(1), why: z.string().min(1) }),
  steer: z.object({ thread_id: z.string(), text: z.string().min(1).max(2000) }),
  forceDone: z.object({ thread_id: z.string() }),
  chaosKill: z.object({ handle: z.string() }),
} as const;

const denied = (a: Actor, what: string): Result<never> =>
  fail("ROLE_DENIED", `${a.role} '${a.handle}' may not ${what}`, "Sysop endpoint.");

export function answer(svc: Service, actor: Actor, b: z.infer<typeof SysopBodies.answer>): Result<unknown> {
  const r = svc.exec({ type: "post", actor, thread_id: b.thread_id, kind: "ANSWER", body: { text: b.text, ask_id: b.ask_id } });
  if (!r.ok) return r;
  // The ASK that blocked the task is now answered: the server (only) lets it run again.
  const t = svc.p.tasks[b.thread_id];
  if (t?.status === "blocked" && t.reason === `ask:${b.ask_id}`)
    svc.exec({ type: "set_status", actor: SERVER, thread_id: b.thread_id, to: "running", gate_ok: false });
  return ok({ status: svc.p.tasks[b.thread_id]?.status });
}

export const approve = (svc: Service, actor: Actor, b: z.infer<typeof SysopBodies.approve>) =>
  answer(svc, actor, { ...b, text: "approve" });

export function cancel(svc: Service, actor: Actor, b: z.infer<typeof SysopBodies.cancel>): Result<unknown> {
  const r = svc.exec({ type: "set_status", actor, thread_id: b.thread_id, to: "cancelled", reason: b.reason, gate_ok: false });
  return r.ok ? ok({ status: "cancelled" }) : r;
}

/** Task 18 / spec 00 R3.3: asks for `done` through the normal rules. It is refused for every caller, the Sysop included. */
export function forceDone(svc: Service, actor: Actor, b: z.infer<typeof SysopBodies.forceDone>): Result<unknown> {
  const r = svc.exec({ type: "set_status", actor, thread_id: b.thread_id, to: "done", gate_ok: svc.gateOk(b.thread_id) });
  return r.ok ? ok({ status: "done" }) : r;
}

/**
 * Steer a running agent: a NOTE whose `next` becomes the thread's next step in the next QWK packet.
 * shortcut: no push into a live agent session; the moderator forwards it with spawn_steer (spec 03).
 */
export function steer(svc: Service, actor: Actor, b: z.infer<typeof SysopBodies.steer>): Result<unknown> {
  if (actor.role !== "sysop" && actor.role !== "moderator") return denied(actor, "steer");
  const r = svc.exec({ type: "post", actor, thread_id: b.thread_id, kind: "NOTE", body: { text: `steer: ${b.text}`, next: b.text } });
  return r.ok ? ok({}) : r;
}

/** Reorder a lock queue (locks-and-doors.md: only the moderator or Sysop, and it must say why). */
export function reorder(svc: Service, actor: Actor, b: z.infer<typeof SysopBodies.reorder>): Result<unknown> {
  if (actor.role !== "sysop" && actor.role !== "moderator") return denied(actor, "reorder a queue");
  const queue = svc.p.locks[b.lock]?.queue ?? [];
  const same =
    b.order.length === queue.length &&
    new Set(b.order).size === queue.length &&
    queue.every((q) => b.order.includes(q.thread));
  if (!same)
    return fail("NOT_FOUND", `order must list exactly the queued threads of ${b.lock}: ${queue.map((q) => q.thread).join(", ") || "(empty)"}`, "Read the queue first.");
  return svc.raw((em) => {
    const at = (q: { caller: string; thread: string }) => ({ thread_id: q.thread, caller: q.caller });
    for (const q of queue) em.push({ type: "RELEASE", ...at(q), body: { lock: b.lock } });
    b.order.forEach((thread, i) => {
      const q = queue.find((x) => x.thread === thread)!;
      em.push({ type: "QUEUE", ...at(q), body: { lock: b.lock, position: i + 1 } });
    });
    em.push({ type: "NOTE", thread_id: b.order[0]!, caller: actor.handle, body: { text: `queue of ${b.lock} reordered: ${b.order.join(" > ")}. why: ${b.why}` } });
    return ok({ queue: b.order });
  });
}

/**
 * Task 14, tests only (GRAVEYARD_CHAOS=1): the caller goes silent. Its lock leases are marked expired,
 * so the next tick frees them and returns the task to pending.
 */
export function chaosKill(svc: Service, b: z.infer<typeof SysopBodies.chaosKill>): Result<unknown> {
  return svc.raw((em) => {
    const held = Object.values(em.p.locks).filter((l) => l.holder?.caller === b.handle);
    for (const l of held)
      em.push({ type: "HEARTBEAT", thread_id: l.holder!.thread, caller: b.handle, body: { lock: l.name, expiresAt: em.ctx.now - 1 } });
    return ok({ expired: held.map((l) => l.name) });
  });
}
