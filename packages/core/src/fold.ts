import type { Budget, Event, Status } from "./events.js";
import { postText } from "./events.js";

export const DEFAULT_BUDGET: Budget = { turns_left: 50, seconds_left: 3600 };

export interface Tried {
  text: string;
  reason: string;
  thread_id: string;
  seq: number;
}

export interface PostLine {
  seq: number;
  caller: string;
  type: Event["type"];
  text: string;
}

export interface Task {
  thread_id: string;
  text: string;
  parent?: string;
  owner?: string;
  status: Status;
  /** Why the task is blocked: `lock:<name>`, `ask:<postId>` or `budget`. */
  reason?: string;
  budget: Budget;
  last_code_seq: number;
  last_evidence_seq: number;
  evidence_ids: string[];
  review: { verdict: "pass" | "reject" | null; by: string | null };
  /** Latest QWK packet issued for this thread, and the one the owner acked. */
  packet: string | null;
  acked: string | null;
  answered: string[];
  tried: Tried[];
  artifacts: Record<string, string>;
  next?: string;
  posts: PostLine[];
}

export interface Lock {
  name: string;
  holder?: { caller: string; thread: string; token: number; expiresAt: number };
  queue: { caller: string; thread: string }[];
  lastToken: number;
}

export interface CallerInfo {
  handle: string;
  posts: number;
  last_at: number;
}

export interface Projections {
  seq: number;
  tasks: Record<string, Task>;
  locks: Record<string, Lock>;
  callers: Record<string, CallerInfo>;
}

export const emptyProjections = (): Projections => ({
  seq: 0,
  tasks: {},
  locks: {},
  callers: {},
});

/** R3.2: pure and deterministic. */
export function fold(events: readonly Event[]): Projections {
  return foldFrom(emptyProjections(), events);
}

/** R3.3: `fold(a ++ b)` equals `foldFrom(fold(a), b)`. Never mutates `p`. */
export function foldFrom(
  p: Projections,
  events: readonly Event[],
): Projections {
  const out = structuredClone(p);
  for (const e of events) apply(out, e);
  return out;
}

function lockOf(p: Projections, name: string): Lock {
  return (p.locks[name] ??= { name, queue: [], lastToken: 0 });
}

function apply(p: Projections, e: Event): void {
  p.seq = Math.max(p.seq, e.seq);
  const c = (p.callers[e.caller] ??= {
    handle: e.caller,
    posts: 0,
    last_at: e.at,
  });
  c.posts += 1;
  c.last_at = e.at;

  if (e.type === "TASK") {
    p.tasks[e.thread_id] ??= {
      thread_id: e.thread_id,
      text: e.body.text,
      parent: e.body.parent,
      owner: e.body.assigned,
      status: "pending",
      budget: e.body.budget ?? { ...DEFAULT_BUDGET },
      last_code_seq: 0,
      last_evidence_seq: 0,
      evidence_ids: [],
      review: { verdict: null, by: null },
      packet: null,
      acked: null,
      answered: [],
      tried: [],
      artifacts: {},
      posts: [],
    };
  }

  const t = p.tasks[e.thread_id];
  const line = postText(e);
  if (t && line !== undefined)
    t.posts.push({ seq: e.seq, caller: e.caller, type: e.type, text: line });

  switch (e.type) {
    case "GRANT": {
      const l = lockOf(p, e.body.lock);
      l.holder = {
        caller: e.caller,
        thread: e.thread_id,
        token: e.body.token,
        expiresAt: e.body.expiresAt,
      };
      l.queue = l.queue.filter((q) => q.thread !== e.thread_id);
      l.lastToken = Math.max(l.lastToken, e.body.token);
      return;
    }
    case "QUEUE":
      lockOf(p, e.body.lock).queue.push({
        caller: e.caller,
        thread: e.thread_id,
      });
      return;
    case "RELEASE": {
      const l = lockOf(p, e.body.lock);
      if (l.holder?.thread === e.thread_id) delete l.holder;
      l.queue = l.queue.filter((q) => q.thread !== e.thread_id);
      return;
    }
    case "HEARTBEAT": {
      const l = lockOf(p, e.body.lock);
      if (l.holder?.thread === e.thread_id)
        l.holder.expiresAt = e.body.expiresAt;
      return;
    }
  }
  if (!t) return;

  switch (e.type) {
    case "NOTE":
      if (e.body.next) t.next = e.body.next;
      break;
    case "ANSWER":
      t.answered.push(e.body.ask_id);
      break;
    case "MILESTONE":
      if (e.body.code_change) t.last_code_seq = e.seq;
      if (e.body.next) t.next = e.body.next;
      for (const f of e.body.files ?? []) t.artifacts[f.path] = f.hash;
      break;
    case "EVIDENCE":
      t.last_evidence_seq = e.seq;
      t.evidence_ids.push(e.id);
      break;
    case "TRIED":
      t.tried.push({
        text: e.body.text,
        reason: e.body.reason,
        thread_id: e.thread_id,
        seq: e.seq,
      });
      break;
    case "REVIEW":
      t.review = { verdict: e.body.verdict, by: e.caller };
      break;
    case "STATUS":
      t.status = e.body.to;
      if (e.body.to === "blocked") t.reason = e.body.reason;
      else delete t.reason;
      if (e.body.to === "awaiting-review")
        t.review = { verdict: null, by: null };
      break;
    case "ACK":
      t.acked = e.body.packet_id;
      break;
    case "SYSTEM":
      if (e.body.kind === "qwk-issued") t.packet = e.body.packet_id;
      else if (
        e.body.kind === "budget-spent" ||
        e.body.kind === "budget-raised"
      ) {
        const sign = e.body.kind === "budget-spent" ? -1 : 1;
        const s = e.body.spend;
        t.budget.turns_left = Math.max(
          0,
          t.budget.turns_left + sign * (s.turns ?? 0),
        );
        t.budget.seconds_left = Math.max(
          0,
          t.budget.seconds_left + sign * (s.seconds ?? 0),
        );
        if (t.budget.credits_left !== undefined) {
          t.budget.credits_left = Math.max(
            0,
            t.budget.credits_left + sign * (s.credits ?? 0),
          );
        }
      }
      break;
  }
}
