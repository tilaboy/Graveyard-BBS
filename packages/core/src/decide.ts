import { Emitter, type Actor, type Ctx } from "./emit.js";
import type { Budget, BodyOf, Event, PostKind, Status } from "./events.js";
import type { Projections } from "./fold.js";
import { claim, heartbeat, release, releaseAll, tick } from "./locks.js";
import { moveStatus } from "./status.js";
import { fail, ok, type Result } from "./voice.js";

export type { Ctx, Actor } from "./emit.js";

type PostCommand = {
  [K in PostKind]: {
    type: "post";
    actor: Actor;
    thread_id: string;
    kind: K;
    body: BodyOf<K>;
  };
}[PostKind];

export type Command =
  | {
      type: "create_task";
      actor: Actor;
      thread_id: string;
      text: string;
      assigned?: string;
      parent?: string;
      budget?: Budget;
    }
  | PostCommand
  | {
      type: "review";
      actor: Actor;
      thread_id: string;
      verdict: "pass" | "reject";
      reasons: string[];
    }
  | {
      type: "set_status";
      actor: Actor;
      thread_id: string;
      to: Status;
      reason?: string;
      gate_ok: boolean;
    }
  | { type: "issue_packet"; actor: Actor; thread_id: string }
  | { type: "ack"; actor: Actor; thread_id: string; packet_id: string }
  | { type: "claim"; actor: Actor; thread_id: string; lock: string }
  | { type: "release"; actor: Actor; thread_id: string; lock: string }
  | { type: "heartbeat"; actor: Actor; thread_id: string; lock: string }
  | { type: "tick"; actor: Actor }
  | {
      type: "spend";
      actor: Actor;
      thread_id: string;
      turns?: number;
      seconds?: number;
      credits?: number;
    }
  | {
      type: "raise_budget";
      actor: Actor;
      thread_id: string;
      turns?: number;
      seconds?: number;
      credits?: number;
    };

export const qwkPacketId = (p: Projections, threadId: string): string =>
  `qwk-${threadId}-${p.seq + 1}`;

const notFound = (id: string) =>
  fail("NOT_FOUND", `thread ${id} does not exist`, "Check the thread id.");
const denied = (a: Actor, what: string) =>
  fail(
    "ROLE_DENIED",
    `${a.role} '${a.handle}' may not ${what}`,
    `Ask a caller with the right role.`,
  );

/** Pure: command in, events out. Nothing is appended unless the whole command is legal. */
export function decide(
  p: Projections,
  cmd: Command,
  ctx: Ctx,
): Result<Event[]> {
  const em = new Emitter(p, ctx);
  const r = run(em, cmd);
  return r.ok ? ok(em.events) : r;
}

function run(em: Emitter, cmd: Command): Result<unknown> {
  const { actor } = cmd;
  if (cmd.type === "tick") {
    if (actor.role !== "server") return denied(actor, "tick");
    tick(em);
    return ok(undefined);
  }
  if (cmd.type === "create_task") {
    if (em.p.tasks[cmd.thread_id])
      return fail(
        "ILLEGAL_TRANSITION",
        `thread ${cmd.thread_id} already exists`,
        "Pick a new thread id.",
      );
    if (cmd.parent && !em.p.tasks[cmd.parent]) return notFound(cmd.parent);
    const body: BodyOf<"TASK"> = {
      text: cmd.text,
      assigned: cmd.assigned,
      parent: cmd.parent,
      budget: cmd.budget,
    };
    em.push({
      type: "TASK",
      thread_id: cmd.thread_id,
      caller: actor.handle,
      body,
    });
    return ok(undefined);
  }

  const t = em.p.tasks[cmd.thread_id];
  if (!t) return notFound(cmd.thread_id);
  const at = { thread_id: cmd.thread_id, caller: actor.handle };

  switch (cmd.type) {
    case "post":
      // posts-are-data.md: only the Sysop answers; locks-and-doors.md: only doors write EVIDENCE.
      if (cmd.kind === "ANSWER" && actor.role !== "sysop")
        return denied(actor, "ANSWER");
      if (cmd.kind === "EVIDENCE" && actor.role !== "server")
        return denied(actor, "write EVIDENCE (doors do)");
      em.push({ type: cmd.kind, ...at, body: cmd.body } as Parameters<
        Emitter["push"]
      >[0]);
      return ok(undefined);

    case "review": {
      // R1.7: the Sysop (and anyone but a reviewer) cannot write REVIEW.
      if (actor.role !== "reviewer") return denied(actor, "write REVIEW");
      if (t.status !== "awaiting-review") {
        return fail(
          "ILLEGAL_TRANSITION",
          `${t.status}: REVIEW needs awaiting-review`,
          "Submit the task for review first.",
        );
      }
      if (actor.handle === t.owner)
        return fail(
          "SELF_REVIEW",
          `'${actor.handle}' owns ${t.thread_id}`,
          "Another reviewer must review it.",
        );
      em.push({
        type: "REVIEW",
        ...at,
        body: { verdict: cmd.verdict, reasons: cmd.reasons },
      });
      if (cmd.verdict === "pass") return ok(undefined);
      for (const reason of cmd.reasons)
        em.push({
          type: "TRIED",
          ...at,
          body: { text: reason, reason: "review rejected" },
        }); // R1.6
      return moveStatus(em, cmd.thread_id, "running", actor);
    }

    case "set_status": {
      const moved = moveStatus(
        em,
        cmd.thread_id,
        cmd.to,
        actor,
        cmd.reason,
        cmd.gate_ok,
      );
      // A task that left running/blocked for good (or lost its lease) gives up its locks and queue places.
      if (
        moved.ok &&
        (cmd.to === "done" || cmd.to === "cancelled" || cmd.to === "pending")
      )
        releaseAll(em, cmd.thread_id, actor.handle);
      return moved;
    }

    case "issue_packet":
      if (actor.role !== "moderator" && actor.role !== "server")
        return denied(actor, "issue packets");
      em.push({
        type: "SYSTEM",
        ...at,
        body: {
          kind: "qwk-issued",
          packet_id: qwkPacketId(em.p, cmd.thread_id),
        },
      });
      return ok(undefined);

    case "ack":
      if (actor.handle !== t.owner) return denied(actor, "ACK for this task");
      if (cmd.packet_id !== t.packet)
        return fail(
          "NO_ACK",
          `${cmd.packet_id} is not the latest packet`,
          "ACK the latest QWK packet.",
        );
      em.push({ type: "ACK", ...at, body: { packet_id: cmd.packet_id } });
      return ok(undefined);

    case "claim":
      return claim(em, actor, cmd.thread_id, cmd.lock);
    case "release":
      return release(em, actor, cmd.thread_id, cmd.lock);
    case "heartbeat":
      return heartbeat(em, actor, cmd.thread_id, cmd.lock);

    case "spend": {
      if (actor.role !== "server") return denied(actor, "spend budget");
      em.push({
        type: "SYSTEM",
        ...at,
        body: { kind: "budget-spent", spend: pick(cmd) },
      });
      const b = em.p.tasks[cmd.thread_id]!.budget;
      const empty =
        b.turns_left <= 0 ||
        b.seconds_left <= 0 ||
        (b.credits_left !== undefined && b.credits_left <= 0);
      if (empty && t.status === "running") {
        // R4.2: blocked: budget, and ask the Sysop.
        em.push({
          type: "ASK",
          ...at,
          body: {
            text: `Budget of ${cmd.thread_id} is spent. Raise it or cancel.`,
            to: "sysop",
          },
        });
        return moveStatus(em, cmd.thread_id, "blocked", actor, "budget");
      }
      return ok(undefined);
    }

    case "raise_budget": {
      if (actor.role !== "sysop") return denied(actor, "raise budgets");
      em.push({
        type: "SYSTEM",
        ...at,
        body: { kind: "budget-raised", spend: pick(cmd) },
      });
      if (t.status === "blocked" && t.reason === "budget")
        moveStatus(em, cmd.thread_id, "running", {
          handle: "server",
          role: "server",
        });
      return ok(undefined);
    }
  }
}

const pick = (c: { turns?: number; seconds?: number; credits?: number }) => ({
  ...(c.turns !== undefined ? { turns: c.turns } : {}),
  ...(c.seconds !== undefined ? { seconds: c.seconds } : {}),
  ...(c.credits !== undefined ? { credits: c.credits } : {}),
});
