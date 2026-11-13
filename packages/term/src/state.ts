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
  input?: { prompt: string; buf: string; thread: string; ask: string };
  flash?: string;
  replay?: ReplayInfo;
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

export const threadsOf = (s: State, board?: string): Task[] =>
  Object.values(s.p.tasks).filter(
    (t) => !board || boardOf(t.thread_id) === board,
  );

export const boardNames = (s: State): string[] =>
  [...new Set(Object.keys(s.p.tasks).map(boardOf))].sort();

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
