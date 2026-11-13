import type { Actor, Emitter } from "./emit.js";
import type { Status } from "./events.js";
import type { Projections, Task } from "./fold.js";
import { fail, ok, type ErrorCode, type Result } from "./voice.js";

type Who = "assigned" | "owner" | "server" | "reviewer" | "moderator" | "sysop";
type Need =
  | "acked"
  | "reason"
  | "reason_cleared"
  | "fresh_evidence"
  | "review_pass"
  | "not_owner"
  | "gate"
  | "review_reject"
  | "lease_expired";

export interface Transition {
  from: Status | "*";
  to: Status;
  who: readonly Who[];
  needs: readonly Need[];
}

/**
 * THE transition table (status-machine.md). The only place it lives:
 * server, MCP, hooks and UI import it. There is deliberately no row into `done`
 * except from `awaiting-review` by a `reviewer`.
 */
export const TRANSITIONS: readonly Transition[] = [
  { from: "pending", to: "running", who: ["assigned"], needs: ["acked"] },
  {
    from: "running",
    to: "blocked",
    who: ["owner", "server"],
    needs: ["reason"],
  },
  {
    from: "blocked",
    to: "running",
    who: ["server"],
    needs: ["reason_cleared"],
  },
  {
    from: "running",
    to: "awaiting-review",
    who: ["owner"],
    needs: ["fresh_evidence"],
  },
  {
    from: "awaiting-review",
    to: "done",
    who: ["reviewer"],
    needs: ["not_owner", "review_pass", "gate"],
  },
  {
    from: "awaiting-review",
    to: "running",
    who: ["reviewer"],
    needs: ["review_reject"],
  },
  { from: "running", to: "pending", who: ["server"], needs: ["lease_expired"] },
  { from: "blocked", to: "pending", who: ["server"], needs: ["lease_expired"] },
  {
    from: "*",
    to: "cancelled",
    who: ["moderator", "sysop"],
    needs: ["reason"],
  },
];

export const isTerminal = (s: Status): boolean =>
  s === "done" || s === "cancelled";

export interface TransitionRequest {
  actor: Actor;
  /** Blocking or cancelling reason. */
  reason?: string;
  /** Board gate verdict, supplied by the server (doors' EVIDENCE decides it). */
  gate_ok: boolean;
  now: number;
}

const REASON_RE = /^(lock:.+|ask:.+|budget)$/;

function whoOk(who: Who, a: Actor, t: Task): boolean {
  if (who === "assigned" || who === "owner")
    return t.owner !== undefined && a.handle === t.owner;
  return a.role === who;
}

function needOk(
  n: Need,
  p: Projections,
  t: Task,
  to: Status,
  r: TransitionRequest,
): boolean {
  switch (n) {
    case "acked":
      return t.packet !== null && t.acked === t.packet;
    case "reason":
      return to === "blocked"
        ? REASON_RE.test(r.reason ?? "")
        : (r.reason ?? "").trim() !== "";
    case "reason_cleared": {
      const why = t.reason ?? "";
      if (why.startsWith("lock:"))
        return p.locks[why.slice(5)]?.holder?.thread === t.thread_id;
      if (why.startsWith("ask:")) return t.answered.includes(why.slice(4));
      return (
        t.budget.turns_left > 0 &&
        t.budget.seconds_left > 0 &&
        (t.budget.credits_left ?? 1) > 0
      );
    }
    case "fresh_evidence":
      return t.last_evidence_seq > 0 && t.last_evidence_seq > t.last_code_seq;
    case "review_pass":
      return t.review.verdict === "pass";
    case "review_reject":
      return t.review.verdict === "reject";
    case "not_owner":
      return r.actor.handle !== t.owner && t.review.by !== t.owner;
    case "gate":
      return r.gate_ok;
    case "lease_expired":
      return Object.values(p.locks).some(
        (l) => l.holder?.thread === t.thread_id && r.now > l.holder.expiresAt,
      );
  }
}

const NEED_CODE: Partial<Record<Need, ErrorCode>> = {
  acked: "NO_ACK",
  fresh_evidence: "NO_EVIDENCE",
  not_owner: "SELF_REVIEW",
};

/** R1.1 / R1.2: allow only listed transitions whose preconditions hold. */
export function checkTransition(
  p: Projections,
  threadId: string,
  to: Status,
  r: TransitionRequest,
): Result<Transition> {
  const t = p.tasks[threadId];
  if (!t)
    return fail(
      "NOT_FOUND",
      `thread ${threadId} does not exist`,
      "Check the thread id.",
    );
  const row = TRANSITIONS.find(
    (x) =>
      x.to === to &&
      (x.from === t.status || (x.from === "*" && !isTerminal(t.status))),
  );
  if (!row) {
    return fail(
      "ILLEGAL_TRANSITION",
      `${t.status} → ${to}: no such transition`,
      `Legal moves from ${t.status}: ${legalTargets(t.status).join(", ") || "none (terminal)"}.`,
    );
  }
  if (!row.who.some((w) => whoOk(w, r.actor, t))) {
    return fail(
      "ROLE_DENIED",
      `${t.status} → ${to}: ${r.actor.role} '${r.actor.handle}' may not do this`,
      `Only: ${row.who.join(", ")}.`,
    );
  }
  for (const n of row.needs) {
    if (!needOk(n, p, t, to, r)) {
      return fail(
        NEED_CODE[n] ?? "ILLEGAL_TRANSITION",
        `${t.status} → ${to}: missing precondition ${n}`,
        `Satisfy '${n}' first, then retry.`,
      );
    }
  }
  return ok(row);
}

export function legalTargets(from: Status): Status[] {
  return TRANSITIONS.filter(
    (x) => x.from === from || (x.from === "*" && !isTerminal(from)),
  ).map((x) => x.to);
}

/** Markdown table for docs, MCP tool descriptions and the hook guard (task 9). */
export function renderTransitionTable(): string {
  const rows = TRANSITIONS.map(
    (x) =>
      `| ${x.from} | ${x.to} | ${x.who.join(", ")} | ${x.needs.join(", ")} |`,
  );
  return ["| From | To | Who | Needs |", "|---|---|---|---|", ...rows].join(
    "\n",
  );
}

/** Check a transition and, if legal, append its STATUS event. Every status change goes through here. */
export function moveStatus(
  em: Emitter,
  threadId: string,
  to: Status,
  actor: Actor,
  reason?: string,
  gate_ok = false,
): Result<void> {
  const checked = checkTransition(em.p, threadId, to, {
    actor,
    reason,
    gate_ok,
    now: em.ctx.now,
  });
  if (!checked.ok) return checked;
  const from = em.p.tasks[threadId]!.status;
  em.push({
    type: "STATUS",
    thread_id: threadId,
    caller: actor.handle,
    body: { from, to, ...(reason ? { reason } : {}) },
  });
  return ok(undefined);
}
