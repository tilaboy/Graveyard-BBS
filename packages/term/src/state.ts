import {
  EventSchema,
  fold,
  type Event,
  type Projections,
  type Task,
} from "@graveyard/core";
import { z } from "zod";

export interface Lesson {
  text: string;
  tags: string[];
  project: string;
  board: string;
  thread: string;
}

export interface Published {
  kind: "game" | "deck";
  slug: string;
  thread: string;
}

/** What every screen renders from. Both sources produce exactly this. */
export interface State {
  events: Event[];
  p: Projections;
  lessons: Lesson[];
  /** Wall clock (live) or replayed clock (replay), epoch ms. */
  now: number;
  runId?: string;
  landingUrl?: string;
}

export type ScreenName =
  | "login"
  | "tree"
  | "menu"
  | "boards"
  | "threads"
  | "thread"
  | "who"
  | "sysop"
  | "doors"
  | "bulletins"
  | "deck"
  | "log"
  | "bye";

export interface ReplayInfo {
  speed: number;
  playing: boolean;
  pos: number;
  total: number;
  /** Marker positions (event index) on the scrub bar. */
  markers: { at: number; kind: "ask" | "refusal" | "done" }[];
}

export interface Denied {
  error: { code: string; message: string; hint: string; voice: string };
  transition: string;
}

export interface View {
  screen: ScreenName;
  board?: string;
  thread?: string;
  /** Selected row on list screens. */
  sel: number;
  /** Lines scrolled up from the bottom of a thread. */
  scroll: number;
  cols: number;
  rows: number;
  reducedMotion: boolean;
  muted: boolean;
  now: number;
  /** Start time per animation key, e.g. `login`, `post:12`, `ghost:builder-2`, `denied`. */
  fx: Record<string, number>;
  denied?: Denied;
  /** One-line prompt. `reply` marks a Sysop [R] reply (a steer post), not an ASK answer. */
  input?: {
    prompt: string;
    buf: string;
    thread: string;
    ask: string;
    reply?: boolean;
  };
  /** Sysop "new task" prompt flow (board, title, body); `input` holds the line being typed. */
  newTask?: { step: "board" | "title" | "body"; board: string; title: string };
  flash?: string;
  replay?: ReplayInfo;
  /**
   * Start-screen tree. `open` keys are `b:<board>` (open unless false) and `t:<thread>`
   * (folded unless true). `at` is the cursor row key, so live updates keep it on the same item.
   */
  tree: { open: Record<string, boolean>; at?: string };
}

export const newView = (o: Partial<View> = {}): View => ({
  screen: "login",
  sel: 0,
  scroll: 0,
  cols: 100,
  rows: 30,
  reducedMotion: false,
  muted: true,
  now: 0,
  fx: {},
  tree: { open: {} },
  ...o,
});

export const emptyState = (): State => ({
  events: [],
  p: fold([]),
  lessons: [],
  now: 0,
});

/** Run bundle from `graveyard export` (spec 00 §2). Validated at the boundary. */
export const BundleSchema = z.object({
  runId: z.string(),
  recordedAt: z.string(),
  project: z.string().default("graveyard-bbs"),
  events: z.array(EventSchema),
  outputs: z
    .object({
      landingUrl: z.string().optional(),
      games: z.array(z.string()).default([]),
      decks: z.array(z.string()).default([]),
    })
    .default({ games: [], decks: [] }),
});
export type Bundle = z.infer<typeof BundleSchema>;

// ---- derived facts (pure) -------------------------------------------------

export const boardOf = (thread: string): string => thread.split("-")[0] ?? "";

export const isOpen = (t: Task): boolean =>
  t.status !== "done" && t.status !== "cancelled";

/** Bookkeeping threads the moderator keeps for itself; never shown as work. */
export const SYSTEM_THREADS = new Set(["mod-cursor"]);

export const threadsOf = (s: State, board?: string): Task[] =>
  Object.values(s.p.tasks).filter(
    (t) =>
      !SYSTEM_THREADS.has(t.thread_id) &&
      (!board || boardOf(t.thread_id) === board),
  );

export const boardNames = (s: State): string[] =>
  [...new Set(threadsOf(s).map((t) => boardOf(t.thread_id)))].sort();

/** Stage and split threads the moderator opened under a task, oldest first. */
export const childrenOf = (s: State, parent: string): Task[] =>
  threadsOf(s).filter((t) => t.parent === parent);

/** A task with no (known) parent: the row the tree starts from. */
const isTop = (s: State, t: Task): boolean => !t.parent || !s.p.tasks[t.parent];

const CALLER_ROLE =
  /^(sysop|moderator|designer|builder|reviewer|release|artist)/;
/** Handles carry their role as a prefix (`builder-2`); the log itself has no role column. */
export const roleOf = (handle: string): string =>
  CALLER_ROLE.exec(handle)?.[1] ?? (handle === "server" ? "server" : "caller");

export interface OpenAsk {
  id: string;
  thread: string;
  caller: string;
  text: string;
}

/** ASK posts with no ANSWER yet, oldest first (the Sysop queue). */
export function openAsks(s: State): OpenAsk[] {
  return s.events.flatMap((e) => {
    if (e.type !== "ASK") return [];
    const t = s.p.tasks[e.thread_id];
    return t && !t.answered.includes(e.id) && isOpen(t)
      ? [{ id: e.id, thread: e.thread_id, caller: e.caller, text: e.body.text }]
      : [];
  });
}

const ONLINE_MS = 120_000;
export const online = (s: State): string[] =>
  Object.values(s.p.callers)
    .filter((c) => c.handle !== "server" && s.now - c.last_at <= ONLINE_MS)
    .map((c) => c.handle);

/** A running task whose owner has said nothing for this long is shown as stalled. */
export const STALL_MS = 10 * 60_000;

/**
 * Minutes a `running` task's owner has been silent, when that is past STALL_MS; else undefined.
 * Silence = no event from the owner anywhere (its last_at). "running" alone says nothing about
 * whether an agent is still alive: one that asked `???` ends its turn, and only the moderator
 * restarts it.
 */
export function stalledMin(s: State, t: Task): number | undefined {
  if (t.status !== "running" || !t.owner) return undefined;
  const last = s.p.callers[t.owner]?.last_at;
  if (last === undefined) return undefined;
  const idle = s.now - last;
  return idle >= STALL_MS ? Math.floor(idle / 60_000) : undefined;
}

/** "52m" / "3h 05m". */
export const ago = (min: number): string =>
  min < 60
    ? `${min}m`
    : `${Math.floor(min / 60)}h ${String(min % 60).padStart(2, "0")}m`;

/** Door results are EVIDENCE posts holding JSON; `publish` tells us which games and decks exist. */
export function published(s: State): Published[] {
  const out = new Map<string, Published>();
  for (const e of s.events) {
    if (e.type !== "EVIDENCE") continue;
    const ev = parseJson(e.body.text);
    const extra = z
      .object({
        door: z.literal("publish"),
        exit_code: z.literal(0),
        extra: z.object({ kind: z.enum(["game", "deck"]), slug: z.string() }),
      })
      .safeParse(ev);
    if (extra.success)
      out.set(`${extra.data.extra.kind}/${extra.data.extra.slug}`, {
        ...extra.data.extra,
        thread: e.thread_id,
      });
  }
  return [...out.values()];
}

export function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/** Tasks a board shows in the tree before `… N more`. */
export const TREE_FILL = 10;

/**
 * Which tasks a board shows in the tree. Always: every task with an open ASK (needs the Sysop)
 * and every running task. Then the newest other tasks until the board shows TREE_FILL.
 * Order: needs-you first, then newest first by last activity (highest event seq on the thread).
 */
export function treeTasks(
  s: State,
  board: string,
): { tasks: Task[]; more: number; needs: Set<string> } {
  const needs = new Set(openAsks(s).map((a) => a.thread));
  const last = new Map<string, number>();
  for (const e of s.events) last.set(e.thread_id, e.seq);
  // A task counts its stage/split threads: their ASKs, running agents and activity lift it.
  const family = (t: Task): Task[] => [
    t,
    ...childrenOf(s, t.thread_id).flatMap(family),
  ];
  const needsAny = (t: Task) => family(t).some((x) => needs.has(x.thread_id));
  const runsAny = (t: Task) => family(t).some((x) => x.status === "running");
  const lastAny = (t: Task) =>
    Math.max(...family(t).map((x) => last.get(x.thread_id) ?? 0));
  const all = threadsOf(s, board)
    .filter((t) => isTop(s, t))
    .sort(
      (a, b) =>
        Number(needsAny(b)) - Number(needsAny(a)) || lastAny(b) - lastAny(a),
    );
  const must = (t: Task) => needsAny(t) || runsAny(t);
  let room = TREE_FILL - all.filter(must).length;
  const tasks = all.filter((t) => must(t) || room-- > 0);
  return { tasks, more: all.length - tasks.length, needs };
}
