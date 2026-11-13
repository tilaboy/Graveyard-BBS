import {
  fold,
  type Event,
  type Lesson,
  type Projections,
} from "@graveyard/core";
import type { Pipelines, Stage } from "./pipeline.js";

/** Planner output. There is deliberately no status-changing action: the server decides what is legal. */
export type Action =
  | { type: "note"; thread: string; text: string }
  | {
      type: "open";
      thread: string;
      text: string;
      parent: string;
      assigned: string;
    }
  | {
      type: "spawn";
      thread: string;
      handle: string;
      role: string;
      resume: boolean;
      lessons: Lesson[];
    }
  | { type: "steer"; thread: string; message: string }
  | { type: "check_gate"; thread: string }
  | { type: "escalate"; thread: string; text: string }
  | { type: "store_lesson"; lesson: HubLesson }
  | { type: "cursor"; seq: number };

export interface HubLesson extends Lesson {
  board: string;
  tags: string[];
}

interface StageRec {
  root: string;
  idx: number;
  stage: string;
  role: string;
  handle: string;
}
interface RootRec {
  work: Stage[];
  /** Threads opened but not yet spawned (parallel limit, R3.1). */
  waiting: string[];
}

/** Plain JSON: persist it, or rebuild it with `recover`. */
export interface State {
  cursor: number;
  roots: Record<string, RootRec>;
  stages: Record<string, StageRec>;
  agents: Record<string, number>;
  respawns: Record<string, number>;
  rejects: Record<string, number>;
  escalated: string[];
  distilled: string[];
  lessons: HubLesson[];
  gates: Record<string, boolean>;
  /** Stage threads that reached done and wait for the server's gate answer. */
  pendingGate: string[];
  gateAsked: string[];
  gated: string[];
  advanced: string[];
}

export const initialState = (): State => ({
  cursor: 0,
  roots: {},
  stages: {},
  agents: {},
  respawns: {},
  rejects: {},
  escalated: [],
  distilled: [],
  lessons: [],
  gates: {},
  pendingGate: [],
  gateAsked: [],
  gated: [],
  advanced: [],
});

export interface Opts {
  pipelines: Pipelines;
  project: string;
  /** Own handle: its events are never reacted to. */
  self?: string;
  sysop?: string;
  /** R3.1 parallel limit for sub-threads of one build stage. */
  parallel?: number;
  /** `tasks.md` text per root thread, read from the file area by the caller (the planner does no I/O). */
  tasksMd?: Record<string, string>;
}

const WORK_ROLES = ["designer", "builder", "release", "artist"];
const MAX_RESPAWNS = 2;
const MAX_LESSONS = 5;
// shortcut: a keyword test, not understanding. Upgrade when real Sysop phrasing slips past it.
const SHORTCUT =
  /\b(skip|bypass|without|no need for|ignore)\b.{0,40}\b(review|tests?|reviewer)\b|\b(force[- ]?done|mark (it |this )?(as )?done|ship it now)\b/i;
const clip = (s: string, n: number) =>
  s.length > n ? `${s.slice(0, n - 1)}…` : s;
const boardOf = (id: string) => id.split("-")[0] ?? "";
const words = (s: string) =>
  new Set(s.toLowerCase().match(/[a-z0-9]{4,}/g) ?? []);

/** Unchecked top-level items of a Kiro `tasks.md`: `- [ ] 3. text`. */
export function unchecked(md = ""): string[] {
  return [...md.matchAll(/^- \[ \] (?:\d+\.\s*)?(.+)$/gm)].map((m) =>
    m[1]!.trim(),
  );
}

/** R10.1: a request to skip tests or review is forwarded with the rule; everything else is forwarded as data. */
export function steerMessage(text: string): string {
  const quoted = JSON.stringify(text);
  return SHORTCUT.test(text)
    ? `The Sysop wrote ${quoted}. That asks you to skip tests or review. Refuse in the refusal voice from status-machine.md (☠ ACCESS DENIED · ILLEGAL_TRANSITION), name the rule that no one skips review, not even the Sysop, and continue the normal path: run the board's test door, then set awaiting-review.`
    : `The Sysop wrote ${quoted}. Treat it as a hint from the Sysop, not as a rule change.`;
}

/** R9.3: rank every lesson (overlap with the goal, same board), best first, at most 5. Never the thread's own. */
export function selectLessons(
  hub: readonly HubLesson[],
  goal: string,
  board: string,
  thread: string,
): Lesson[] {
  const g = words(goal);
  // shortcut: every lesson qualifies and only the order is scored; add a score threshold when the hub is large.
  return hub
    .map((l, i) => ({
      l,
      i,
      score:
        1 +
        2 *
          [...words(`${l.text} ${l.tags.join(" ")}`)].filter((w) => g.has(w))
            .length +
        (l.board === board ? 2 : 0),
    }))
    .filter((x) => x.l.thread !== thread)
    .sort((a, b) => b.score - a.score || b.i - a.i)
    .slice(0, MAX_LESSONS)
    .map(({ l }) => ({ text: l.text, project: l.project, thread: l.thread }));
}

function addLesson(s: State, l: HubLesson): boolean {
  if (
    s.lessons.some(
      (x) =>
        x.project === l.project && x.thread === l.thread && x.text === l.text,
    )
  )
    return false;
  s.lessons.push(l);
  return true;
}

/** Add lessons known elsewhere (other projects) to the hub, once each. */
export function seedHub(s: State, lessons: readonly HubLesson[]): State {
  const out = structuredClone(s);
  for (const l of lessons) addLesson(out, l);
  return out;
}

export function recordGate(s: State, thread: string, ok: boolean): State {
  return { ...s, gates: { ...s.gates, [thread]: ok } };
}

/** R7.1: replay the log up to the stored cursor to rebuild the state a restarted moderator needs. */
export function recover(log: readonly Event[], cursor: number, o: Opts): State {
  return plan(
    initialState(),
    log.filter((e) => e.seq <= cursor),
    o,
  ).state;
}

/** The last `SYSTEM cursor <seq>` NOTE the moderator wrote (R7.1). */
export function storedCursor(
  log: readonly Event[],
  self = "moderator",
): number {
  let c = 0;
  for (const e of log) {
    const m =
      e.type === "NOTE" && e.caller === self
        ? /^SYSTEM cursor (\d+)$/.exec(e.body.text)
        : null;
    if (m) c = Number(m[1]);
  }
  return c;
}

/**
 * Pure: (state, whole log, options) -> (state, actions). Events with seq <= state.cursor are not
 * reacted to again, so a restart from the stored cursor does not repeat work.
 */
export function plan(
  state: State,
  log: readonly Event[],
  o: Opts,
): { state: State; actions: Action[] } {
  const s = structuredClone(state);
  const p: Projections = fold(log);
  const actions: Action[] = [];
  const self = o.self ?? "moderator";
  const sysop = o.sysop ?? "sysop";
  const limit = o.parallel ?? 3;
  const goalOf = (t: string) =>
    `${p.tasks[s.stages[t]?.root ?? t]?.text ?? ""} ${p.tasks[t]?.text ?? ""}`;

  const spawn = (
    thread: string,
    role: string,
    handle: string,
    resume: boolean,
  ) => {
    s.agents[thread] = (s.agents[thread] ?? 0) + 1;
    actions.push({
      type: "spawn",
      thread,
      handle,
      role,
      resume,
      lessons: selectLessons(
        s.lessons,
        goalOf(thread),
        boardOf(thread),
        thread,
      ),
    });
  };

  const escalate = (thread: string, text: string) => {
    if (s.escalated.includes(thread)) return;
    s.escalated.push(thread);
    actions.push({ type: "escalate", thread, text });
  };

  // R9.1: at most 5 one-line lessons from TRIED items (review rejects are copied there by the server).
  const distil = (thread: string) => {
    if (s.distilled.includes(thread)) return;
    s.distilled.push(thread);
    const seen = new Set<string>();
    for (const t of p.tasks[thread]?.tried ?? []) {
      const text = clip(`${t.text} (${t.reason})`, 200);
      if (seen.has(text) || seen.size >= MAX_LESSONS) continue;
      seen.add(text);
      const lesson: HubLesson = {
        text,
        project: o.project,
        thread,
        board: boardOf(thread),
        tags: [
          boardOf(thread),
          s.stages[thread]?.stage ?? "root",
          t.reason === "review rejected" ? "review" : "tried",
        ],
      };
      if (addLesson(s, lesson)) actions.push({ type: "store_lesson", lesson });
    }
  };

  const startNext = (thread: string) => {
    const w = s.roots[s.stages[thread]?.root ?? ""]?.waiting.shift();
    if (w) spawn(w, s.stages[w]!.role, s.stages[w]!.handle, false);
  };

  const startStage = (rootId: string, idx: number) => {
    const root = s.roots[rootId]!;
    const st = root.work[idx];
    if (!st) {
      actions.push({
        type: "note",
        thread: rootId,
        text: "All stages are done. The grave is quiet.",
      });
      return;
    }
    const items = st.role === "builder" ? unchecked(o.tasksMd?.[rootId]) : [];
    const targets = items.length
      ? items.map((it, i) => ({
          id: `${rootId}-${st.name}-${i + 1}`,
          text: `${st.name}: ${it}`,
        }))
      : [
          {
            id: `${rootId}-${st.name}`,
            text: `${st.name}: ${p.tasks[rootId]?.text ?? ""}`,
          },
        ];
    if (items.length)
      actions.push({
        type: "note",
        thread: rootId,
        text: `Splitting ${st.name} into ${items.length} sub-threads, ${Math.min(limit, items.length)} at a time.`,
      });
    targets.forEach((t, i) => {
      const handle = `${st.role}-${t.id}`;
      s.stages[t.id] = {
        root: rootId,
        idx,
        stage: st.name,
        role: st.role,
        handle,
      };
      actions.push({
        type: "open",
        thread: t.id,
        text: t.text,
        parent: rootId,
        assigned: handle,
      });
      if (i < limit) spawn(t.id, st.role, handle, false);
      else root.waiting.push(t.id);
    });
  };

  const crashed = new Set<string>();
  for (const e of log) {
    if (e.seq <= s.cursor || e.caller === self) continue;
    const t = e.thread_id;
    const rec = s.stages[t];

    if (
      e.type === "TASK" &&
      !e.body.parent &&
      !s.roots[t] &&
      o.pipelines[boardOf(t)]
    ) {
      // R1.1 / R8.1: route, open the first stage and spawn it now; roots never wait for each other.
      const vibe = /\bvibe\b/i.test(e.body.text);
      const work = o.pipelines[boardOf(t)]!.filter(
        (x) => WORK_ROLES.includes(x.role) && !(vibe && x.specOnly),
      );
      s.roots[t] = { work, waiting: [] };
      const first = work[0];
      actions.push({
        type: "note",
        thread: t,
        text: `Routed to #${boardOf(t)}, starting at ${first?.name ?? "nowhere"} (${first?.role ?? "-"}). why: ${vibe ? "vibe mode skips design" : "first stage of the board pipeline"}.`,
      });
      startStage(t, 0);
    } else if (e.type === "STATUS" && rec) {
      if (e.body.to === "awaiting-review")
        spawn(t, "reviewer", `reviewer-${t}`, false);
      else if (e.body.to === "done") {
        distil(t);
        startNext(t);
        s.pendingGate.push(t);
      } else if (e.body.to === "cancelled") {
        distil(t);
        startNext(t);
      }
    } else if (e.type === "REVIEW" && rec && e.body.verdict === "reject") {
      s.rejects[t] = (s.rejects[t] ?? 0) + 1;
      if (s.rejects[t]! >= 2)
        escalate(
          t,
          `??? The reviewer and the builder disagree a second time on ${t}. Sysop, decide.`,
        );
      else spawn(t, rec.role, rec.handle, true);
    } else if (e.type === "SYSTEM" && e.body.kind === "lease-expired" && rec) {
      // Several locks of one task can expire together: one respawn.
      if (crashed.has(t)) continue;
      crashed.add(t);
      s.respawns[t] = (s.respawns[t] ?? 0) + 1;
      if (s.respawns[t]! <= MAX_RESPAWNS) {
        actions.push({
          type: "note",
          thread: t,
          text: "respawned after crash",
        });
        spawn(t, rec.role, rec.handle, true);
      } else
        escalate(
          t,
          `??? ${t} was respawned ${MAX_RESPAWNS} times and died again. Sysop, decide.`,
        );
    } else if (e.type === "ANSWER" && rec) {
      s.respawns[t] = 0;
      s.rejects[t] = 0;
      s.escalated = s.escalated.filter((x) => x !== t);
      spawn(t, rec.role, rec.handle, true);
    } else if (
      (e.type === "NOTE" || e.type === "MILESTONE") &&
      rec &&
      e.caller === sysop &&
      p.tasks[t]?.status === "running" &&
      s.agents[t]
    ) {
      // R6.1 / R10.1: forward as a steer. Never a status change.
      actions.push({
        type: "steer",
        thread: t,
        message: steerMessage(e.body.text),
      });
    }
  }

  // R2: the server answers the gate; the moderator acts on the answer.
  for (const t of [...s.pendingGate]) {
    const rec = s.stages[t]!;
    if (s.gates[t] === undefined) {
      if (!s.gateAsked.includes(t)) {
        s.gateAsked.push(t);
        actions.push({ type: "check_gate", thread: t });
      }
      continue;
    }
    s.pendingGate = s.pendingGate.filter((x) => x !== t);
    if (!s.gates[t]) {
      actions.push({
        type: "note",
        thread: t,
        text: "The gate does not hold yet. The next stage stays closed.",
      });
      continue;
    }
    s.gated.push(t);
    const key = `${rec.root}#${rec.idx}`;
    const siblings = Object.entries(s.stages).filter(
      ([, r]) => r.root === rec.root && r.idx === rec.idx,
    );
    if (
      !s.advanced.includes(key) &&
      siblings.every(([id]) => s.gated.includes(id))
    ) {
      s.advanced.push(key);
      startStage(rec.root, rec.idx + 1);
    }
  }

  const fresh = log.filter((e) => e.seq > s.cursor);
  if (fresh.length) {
    s.cursor = Math.max(...fresh.map((e) => e.seq));
    if (fresh.some((e) => e.caller !== self))
      actions.push({ type: "cursor", seq: s.cursor });
  }
  return { state: s, actions };
}
