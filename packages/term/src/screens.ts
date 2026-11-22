/**
 * Tasks 2-6, 11-14, 18-19: every screen is a pure `(state, view) => string[]`; `render` frames them.
 * Spooky wrapper, plain facts: every themed line still carries the status name, code or number.
 */
import type { Event, Status, Task } from "@graveyard/core";
import { lit, progress } from "./anim.js";
import {
  box,
  pad,
  RESET,
  sgr,
  stripUnsafe,
  truncate,
  vlen,
  wrap,
  ESC,
} from "./ansi.js";
import {
  boardNames,
  childrenOf,
  isOpen,
  online,
  openAsks,
  stalledMin,
  ago,
  parseJson,
  published,
  roleOf,
  threadsOf,
  treeTasks,
  boardOf,
  type State,
  type View,
  type NewTaskForm,
} from "./state.js";
import {
  COLOR,
  EMOJI,
  LOGIN_AUTO_MS,
  MOTION,
  POST_COLOR,
  STATUS,
  WORDS,
} from "./theme.js";
import { formatBody } from "./format.js";
import { z } from "zod";

const ART = [
  "╔═╗┬─┐┌─┐┬  ┬┌─┐┬ ┬┌─┐┬─┐┌┬┐  ╔╗ ╔╗ ╔═╗",
  "║ ╦├┬┘├─┤└┐┌┘├┤ └┬┘├─┤├┬┘ ││  ╠╩╗╠╩╗╚═╗",
  "╚═╝┴└─┴ ┴ └┘ └─┘ ┴ ┴ ┴┴└──┴┘  ╚═╝╚═╝╚═╝",
];
const TOMBS = ["   _.-._      ", "  | RIP |   † ", "__|_____|__/|_"];
const BAT = "/\\^o^/\\";

const hhmmss = (ms: number): string => new Date(ms).toISOString().slice(11, 19);
const mmss = (s: number): string =>
  `${Math.floor(Math.max(0, s) / 60)}:${String(Math.floor(Math.max(0, s) % 60)).padStart(2, "0")}`;

/** `🔥 running` — emoji, then the plain status name (R5.1). */
export const badge = (s: Status): string => {
  const t = STATUS[s];
  return sgr(t.color, `${t.emoji ? `${t.emoji} ` : ""}${s}`);
};
const badgeW = 17;
const statusLine = (s: Status): string =>
  `${pad(badge(s), badgeW)} ${sgr(COLOR.dim, STATUS[s].phrase)}`;

const sel = (v: View, i: number): string =>
  v.sel === i ? sgr(COLOR.bold, "▶ ") : "  ";
const cut = (s: string, n: number): string => truncate(stripUnsafe(s), n);

// ---- login / menu ----------------------------------------------------------

function login(s: State, v: View): string[] {
  const p = progress(v, "login", MOTION.login);
  const shown = Math.ceil(p * ART.length);
  const lines = ART.map((l, i) => (i < shown ? sgr(COLOR.sysop, l) : ""));
  // Bats cross the top during the first second of the animation; reduced motion draws none.
  const bat =
    p < 1
      ? " ".repeat(Math.floor(p * Math.max(0, v.cols - BAT.length))) +
        sgr(COLOR.dim, BAT)
      : "";
  const n = online(s).length;
  const left = Math.max(
    1,
    Math.ceil((LOGIN_AUTO_MS - (v.now - (v.fx["login"] ?? v.now))) / 1000),
  );
  return [
    bat,
    ...lines.map((l) => `  ${l}`),
    "",
    ...TOMBS.map((l) => sgr(COLOR.note, `  ${l}`)),
    "",
    `  Node 1 · 14400 baud · ${n} caller${n === 1 ? "" : "s"} ${WORDS.online}`,
    `  ${EMOJI.lesson} Bulletins: ${s.lessons.length} new lesson${s.lessons.length === 1 ? "" : "s"}`,
    "",
    sgr(COLOR.dim, `  Press any key to enter… entering in ${left}…`),
    "",
    ...boardSummary(s, v),
  ];
}

/** Login summary: per board and in total, tasks by status, open ASKs and stalled tasks. */
export function boardSummary(s: State, v: View): string[] {
  const tasks = threadsOf(s); // the tree's task set: top-level tasks and their stages
  if (tasks.length === 0)
    return [`  ${EMOJI.idle} The crypt is empty. Press N to post a task.`];
  const asks = openAsks(s);
  const cols: [string, string, (b?: string) => number][] = [
    ...(
      ["pending", "running", "blocked", "awaiting-review", "done"] as const
    ).map((st): [string, string, (b?: string) => number] => [
      STATUS[st].emoji,
      st === "awaiting-review" ? "review" : st,
      (b) =>
        tasks.filter(
          (t) => t.status === st && (!b || boardOf(t.thread_id) === b),
        ).length,
    ]),
    [
      EMOJI.monster,
      "needs you",
      (b) => asks.filter((a) => !b || boardOf(a.thread) === b).length,
    ],
    [
      "⚠",
      "stalled",
      (b) =>
        tasks.filter(
          (t) =>
            stalledMin(s, t) !== undefined &&
            (!b || boardOf(t.thread_id) === b),
        ).length,
    ],
  ];
  const names = boardNames(s);
  const bw = Math.max(8, ...names.map((b) => b.length + 3));
  const full = cols.map(([e, w]) => `${e} ${w}`);
  // Narrow screens drop the words and keep the emoji.
  const wide = 2 + bw + full.reduce((n, h) => n + vlen(h) + 2, 0) <= v.cols;
  const heads = wide ? full : cols.map(([e]) => e);
  const cw = heads.map((h) => vlen(h) + 2);
  const row = (label: string, b?: string) =>
    `  ${pad(label, bw)}${cols.map(([, , f], i) => pad(String(f(b)), cw[i]!)).join("")}`;
  return [
    sgr(
      COLOR.bold,
      `  ${pad("board", bw)}${heads.map((h, i) => pad(h, cw[i]!)).join("")}`,
    ),
    ...names.map((b) => row(`#${b}`, b)),
    sgr(COLOR.bold, row("total")),
  ];
}

function menu(s: State, v: View): string[] {
  const asks = openAsks(s).length;
  const counts = new Map<Status, number>();
  for (const t of Object.values(s.p.tasks))
    counts.set(t.status, (counts.get(t.status) ?? 0) + 1);
  const key = (k: string, rest: string) =>
    `${sgr(COLOR.sysop, `[${k}]`)}${rest}`;
  const flick = asks > 0 && !lit(v) ? COLOR.dim : COLOR.bold;
  return [
    "",
    `  ${key("B", "oards")}   ${key("W", "ho's online")}   ${key("S", `ysop queue (${asks})`)}   ${key("D", "oors")}   ${key("L", "og")}   ${key("N", "ew task")}`,
    `  ${key("U", "")} Bulletins (${s.lessons.length} lesson${s.lessons.length === 1 ? "" : "s"})   ${key("M", "ute sound")}   ${key("G", "oodbye")}`,
    "",
    asks > 0
      ? `  ${sgr(`${COLOR.ask};${flick}`, `${EMOJI.ask} ${asks} open ASK: ${WORDS.ask}`)}`
      : `  ${EMOJI.idle} Nothing summons you. The crypt is quiet.`,
    "",
    ...(Object.keys(s.p.tasks).length === 0
      ? [`  ${EMOJI.idle} No threads yet.`]
      : (
          [
            "pending",
            "running",
            "blocked",
            "awaiting-review",
            "done",
            "cancelled",
          ] as const
        )
          .filter((st) => counts.has(st))
          .map(
            (st) =>
              `  ${statusLine(st)} ${sgr(COLOR.dim, `× ${counts.get(st)}`)}`,
          )),
  ];
}

// ---- boards / threads ------------------------------------------------------

function boards(s: State, v: View): string[] {
  const names = boardNames(s);
  const doors = (b: string) =>
    Object.values(s.p.locks)
      .filter((l) => l.holder && boardOf(l.holder.thread) === b)
      .map((l) => l.name)
      .join(", ");
  return [
    sgr(
      COLOR.bold,
      `  ${pad("board", 14)}${pad("open", 7)}${pad("total", 7)}busy doors`,
    ),
    ...(names.length === 0 ? [`  ${EMOJI.idle} No boards yet.`] : []),
    ...names.map((b, i) => {
      const ts = threadsOf(s, b);
      const open = ts.filter(isOpen).length;
      const idle = open === 0 ? ` ${EMOJI.idle} idle` : "";
      return `${sel(v, i)}${pad(`#${b}`, 14)}${pad(String(open), 7)}${pad(String(ts.length), 7)}${doors(b) || "—"}${idle}`;
    }),
  ];
}

export const boardsList = boardNames;

function threadRow(t: Task, v: View, i: number, w: number): string {
  const ghost = progress(v, `ghost:${t.thread_id}`, MOTION.ghost);
  const float =
    ghost < 1 && t.status === "running"
      ? `${EMOJI.agent}${"·".repeat(Math.floor(ghost * 3))}`
      : "";
  const lid = progress(v, `done:${t.thread_id}`, MOTION.lid);
  const lidArt =
    lid < 1 && t.status === "done" ? ("▔▀▄▃"[Math.floor(lid * 4)] ?? "") : "";
  const why = t.status === "blocked" && t.reason ? ` (${t.reason})` : "";
  const row = `${sel(v, i)}${pad(badge(t.status), badgeW)} ${pad(t.thread_id, 24)} ${pad(t.owner ?? "—", 12)} ${cut(t.text, Math.max(10, w - 62))}${why}${float}${lidArt}`;
  return t.status === "done" ? sgr(COLOR.dim, row) : row;
}

export const threadList = (s: State, v: View): Task[] => threadsOf(s, v.board);

function threads(s: State, v: View): string[] {
  const ts = threadList(s, v);
  return [
    sgr(
      COLOR.bold,
      `  #${v.board ?? ""}  ${ts.length} thread${ts.length === 1 ? "" : "s"}`,
    ),
    ...(ts.length === 0 ? [`  ${EMOJI.idle} Nothing new on this board.`] : []),
    ...ts.map((t, i) => threadRow(t, v, i, v.cols)),
  ];
}

// ---- thread view -----------------------------------------------------------

const SHOWN = new Set([
  "TASK",
  "NOTE",
  "ASK",
  "ANSWER",
  "MILESTONE",
  "EVIDENCE",
  "TRIED",
  "REVIEW",
  "STATUS",
  "GRANT",
  "QUEUE",
  "RELEASE",
  "REP",
]);

const EvidenceView = z.object({
  door: z.string(),
  exit_code: z.number(),
  duration_ms: z.number(),
  commit: z.string().nullable(),
});

/**
 * How one event reads. `compact` posts are one line (`head`, plain text) whose `body` holds the
 * details; the full thread shows them dim, the tree only when unfolded.
 */
interface Post {
  head: string;
  body: string[];
  style: string;
  compact?: "dim" | "refusal";
  /** The ASK an ANSWER replies to, shown as one `>` line. */
  quote?: string;
  /** Door output: wrapped as is, never reformatted (R5.6). */
  plain?: boolean;
}

const SERVER_DENIED = /^\s*☠\s*ACCESS DENIED\s*·\s*(.*)$/;
const STEER = "steer: ";

/** Header text, body text and style for one event. Door EVIDENCE stays plain (R5.6). */
function describe(e: Event, s: State, v: View): Post {
  const style = POST_COLOR[e.type];
  switch (e.type) {
    case "ASK": {
      const open = !s.p.tasks[e.thread_id]?.answered.includes(e.id);
      const flick = open && !lit(v) ? COLOR.dim : COLOR.bold;
      return {
        head: `${EMOJI.ask} ASK ${open ? "(unanswered) " : ""}${WORDS.ask}`,
        body: [e.body.text],
        style: open ? `${COLOR.ask};${flick}` : COLOR.ask,
      };
    }
    case "ANSWER": {
      const ask = s.events.find((x) => x.id === e.body.ask_id);
      return {
        head: `${EMOJI.sysop} ANSWER`,
        body: [e.body.text],
        ...(ask && ask.type === "ASK" ? { quote: ask.body.text } : {}),
        style,
      };
    }
    case "REVIEW":
      return e.body.verdict === "reject"
        ? {
            head: `${EMOJI.refusal} REVIEW reject`,
            body: e.body.reasons,
            style: COLOR.error,
          }
        : { head: "REVIEW pass", body: e.body.reasons, style: COLOR.pass };
    case "EVIDENCE": {
      const ev = EvidenceView.safeParse(parseJson(e.body.text));
      if (!ev.success)
        return {
          head: `${EMOJI.evidence} EVIDENCE`,
          body: [e.body.text],
          style,
          plain: true,
        };
      const ok = ev.data.exit_code === 0;
      return {
        head: `${EMOJI.evidence} EVIDENCE ${sgr(ok ? COLOR.pass : COLOR.error, `[exit ${ev.data.exit_code}]`)}`,
        body: [
          `door ${ev.data.door} · ${ev.data.duration_ms} ms${ev.data.commit ? ` · commit ${ev.data.commit.slice(0, 7)}` : ""}`,
        ],
        style,
        plain: true,
      };
    }
    case "TRIED":
      return {
        head: "TRIED",
        body: [`${e.body.text} (${e.body.reason})`],
        style,
      };
    case "STATUS": {
      const t = STATUS[e.body.to];
      return {
        head: `STATUS ${t.emoji ? `${t.emoji} ` : ""}${e.body.to} · ${t.phrase} (was ${e.body.from}${e.body.reason ? `, ${e.body.reason}` : ""})`,
        body: [],
        style,
        compact: "dim",
      };
    }
    case "GRANT":
      return {
        head: `lock ${e.body.lock} granted, fencing token #${e.body.token}`,
        body: [],
        style,
        compact: "dim",
      };
    case "QUEUE":
      return {
        head: `lock ${e.body.lock}: Door busy — queued at #${e.body.position}`,
        body: [],
        style,
        compact: "dim",
      };
    case "RELEASE":
      return {
        head: `lock ${e.body.lock} released`,
        body: [],
        style,
        compact: "dim",
      };
    case "NOTE": {
      const [first = "", ...rest] = e.body.text.split("\n");
      const denied = e.caller === "server" && SERVER_DENIED.exec(first);
      if (denied)
        return {
          head: `${EMOJI.refusal} ACCESS DENIED · ${denied[1]!.replace(/\s+/g, " ").trim()}`,
          body: rest.map((l) => l.trim()).filter(Boolean),
          style: COLOR.error,
          compact: "refusal",
        };
      // A Sysop [R] reply is stored as `steer: <text>`; show it as the reply it is.
      if (e.body.text.startsWith(STEER))
        return {
          head: `${EMOJI.sysop} ${roleOf(e.caller) === "sysop" ? "Sysop reply" : "REPLY"}`,
          body: [e.body.text.slice(STEER.length)],
          style: COLOR.sysop,
        };
      return { head: "NOTE", body: [e.body.text], style };
    }
    case "MILESTONE":
      return { head: "MILESTONE", body: [e.body.text], style };
    case "TASK":
      return { head: "TASK", body: [e.body.text], style };
    case "REP":
      return { head: "REP", body: [e.body.text], style };
    default:
      return { head: e.type, body: [], style };
  }
}

export function threadLines(s: State, v: View): string[] {
  const t = v.thread ? s.p.tasks[v.thread] : undefined;
  if (!t) return [`  ${EMOJI.refusal} NOT_FOUND: thread ${v.thread ?? "?"}`];
  const w = v.cols - 6;
  const idle = stalledMin(s, t);
  const out = [
    `  ${sgr(COLOR.bold, t.thread_id)}  ${statusLine(t.status)}${t.reason ? ` (${t.reason})` : ""}`,
    ...(idle === undefined
      ? []
      : [
          `  ${sgr(`${COLOR.ask};${COLOR.bold}`, `⚠ stalled: ${t.owner} has been silent for ${ago(idle)}. No agent is working on this.`)}`,
          sgr(
            COLOR.dim,
            "    The moderator restarts it on its next step (is the moderator-step schedule on?).",
          ),
        ]),
    sgr(
      COLOR.dim,
      `  owner ${t.owner ?? "—"} · turns left ${t.budget.turns_left} · seconds left ${t.budget.seconds_left}`,
    ),
    "",
  ];
  // Posts are numbered per thread (1, 2, 3 …); the global log seq stays in the Log screen.
  let prev: Post | undefined;
  postsOf(s, t.thread_id).forEach((e, i) => {
    const d = describe(e, s, v);
    // New posts fade in like mist: dim first, then normal.
    const mist =
      progress(v, `post:${e.seq}`, MOTION.mist) < 0.5 ? `${COLOR.dim};` : "";
    // A blank line between posts; runs of one-line notes stay together.
    if (prev && !(prev.compact && d.compact)) out.push("");
    out.push(`  ${postHead(e, i + 1, d, mist)}`);
    for (const l of postBody(d, w, mist)) out.push(`${BODY_IND}${l}`);
    prev = d;
  });
  return out;
}

const HANDLE_W = 12;
const BODY_IND = "     ";
/** Tree posts show this many body lines until unfolded. */
export const POST_LINES = 6;
const hhmm = (ms: number): string => new Date(ms).toISOString().slice(11, 16);

/** A handle too long for its column shows as its role; Who's online keeps the full handle. */
export const shortHandle = (h: string): string =>
  h.length > HANDLE_W && roleOf(h) !== "caller" ? roleOf(h) : h;

/** `#n  HH:MM  caller  <kind>`; a compact post is that one dim (or red) line. */
function postHead(e: Event, n: number, d: Post, mist: string): string {
  const meta = `#${n}  ${hhmm(e.at)}  ${pad(shortHandle(e.caller), HANDLE_W)}`;
  if (d.compact)
    return sgr(
      d.compact === "refusal" ? COLOR.error : COLOR.dim,
      `${meta} ${d.head}`,
    );
  return `${sgr(COLOR.dim, meta)} ${sgr(mist + d.style, d.head)}`;
}

/** Body lines, at most `w` cells (a long path may run over rather than break). */
function postBody(d: Post, w: number, mist: string): string[] {
  if (d.compact) return d.body.map((l) => sgr(COLOR.dim, cut(l, w)));
  const style = mist + d.style;
  return [
    ...(d.quote ? [sgr(COLOR.dim, cut(`> ${d.quote}`, w))] : []),
    ...d.body.flatMap((b) =>
      d.plain
        ? wrap(stripUnsafe(b), w).map((l) => sgr(style, l))
        : formatBody(stripUnsafe(b), d.head, w, style),
    ),
  ];
}

/** The posts a thread shows, in order; their index + 1 is the per-thread post number. */
const postsOf = (s: State, thread: string): Event[] =>
  s.events.filter((e) => e.thread_id === thread && SHOWN.has(e.type));

function thread(s: State, v: View, room: number): string[] {
  const all = threadLines(s, v);
  const end = Math.max(room, all.length - v.scroll);
  return all.slice(Math.max(0, end - room), end);
}

// ---- tree (start screen) ----------------------------------------------------

export interface TreeRow {
  /** `b:<board>`, `t:<thread>`, `p:<thread>:<seq>` or `m:<board>` (the "… N more" line). */
  key: string;
  kind: "board" | "task" | "post" | "more";
  board: string;
  thread?: string;
  line: string;
  /** Lines drawn under `line` (a post's body); the cursor stays on `line`. */
  lines?: string[];
  /** Body lines a folded post hides; 0 when all show. */
  hidden?: number;
}

const LANE = 8;

/** A task that needs the Sysop: a 🧟 crawls along a lane beside it and the title blinks. */
function needsYou(v: View): { lane: string; style: string } {
  const span = LANE - 2;
  const at = v.reducedMotion
    ? 0
    : Math.floor(v.now / MOTION.crawl) % (span + 1);
  const lane = `${" ".repeat(at)}${EMOJI.monster}${" ".repeat(span - at)}`;
  const blink = !v.reducedMotion && lit(v) ? COLOR.inverse : COLOR.bold;
  return {
    lane: `${lane} ${sgr(`${COLOR.ask};${COLOR.bold}`, "needs you")}`,
    style: `${COLOR.ask};${blink}`,
  };
}

/** Every visible tree row, top to bottom: boards, their shown tasks, posts of open tasks. */
export function treeRows(s: State, v: View): TreeRow[] {
  const out: TreeRow[] = [];
  const open = v.tree.open;
  const tw = Math.max(10, v.cols - 62);
  for (const b of boardNames(s)) {
    const bOpen = open[`b:${b}`] !== false;
    const { tasks, more, needs } = treeTasks(s, b);
    const top = threadsOf(s, b).filter(
      (t) => !t.parent || !s.p.tasks[t.parent],
    ).length;
    out.push({
      key: `b:${b}`,
      kind: "board",
      board: b,
      line: `${bOpen ? "▾" : "▸"} ${sgr(COLOR.bold, `#${b}`)}  ${sgr(COLOR.dim, `(${top})`)}`,
    });
    if (!bOpen) continue;
    // A task row, its posts when open, then its stage/split threads one level deeper.
    const taskRow = (t: Task, depth: number): void => {
      const tOpen = open[`t:${t.thread_id}`] === true;
      const kids = childrenOf(s, t.thread_id);
      const n = needs.has(t.thread_id) ? needsYou(v) : undefined;
      const ind = "    ".repeat(depth + 1);
      const fold = tOpen ? "▾" : "▸";
      const mark = depth > 0 ? "└ " : "";
      const w = Math.max(10, tw - 4 * depth - mark.length);
      const title = pad(cut(t.text.split("\n")[0] ?? "", w), w);
      const sub =
        !tOpen && kids.length ? sgr(COLOR.dim, ` +${kids.length}`) : "";
      const idle = stalledMin(s, t);
      const stall =
        idle === undefined
          ? ""
          : ` ${sgr(`${COLOR.ask};${COLOR.bold}`, `⚠ stalled ${ago(idle)}`)}`;
      const row = `${ind}${mark}${fold} ${pad(badge(t.status), badgeW)} ${n ? sgr(n.style, title) : title} ${pad(cut(t.owner ?? "—", 12), 12)}${sub}${stall}${n ? ` ${n.lane}` : ""}`;
      out.push({
        key: `t:${t.thread_id}`,
        kind: "task",
        board: b,
        thread: t.thread_id,
        line: t.status === "done" ? sgr(COLOR.dim, row) : row,
      });
      if (!tOpen) return;
      postsOf(s, t.thread_id).forEach((e, i) => {
        const d = describe(e, s, v);
        const key = `p:${t.thread_id}:${e.seq}`;
        const pind = `${ind}      `;
        const body = postBody(d, Math.max(20, v.cols - 2 - pind.length), "");
        // Long posts show their first lines; → or Enter unfolds the rest. One spare line just shows.
        const limit = d.compact ? 0 : POST_LINES;
        const hidden =
          open[key] === true || body.length <= limit + (d.compact ? 0 : 1)
            ? 0
            : body.length - limit;
        const more = `${pind}… ${hidden} more line${hidden === 1 ? "" : "s"} (→)`;
        out.push({
          key,
          kind: "post",
          board: b,
          thread: t.thread_id,
          line: `${ind}    ${postHead(e, i + 1, d, "")}`,
          lines: hidden
            ? [
                ...body.slice(0, limit).map((l) => pind + l),
                sgr(COLOR.dim, more),
              ]
            : body.map((l) => pind + l),
          hidden,
        });
      });
      for (const k of kids) taskRow(k, depth + 1);
    };
    for (const t of tasks) taskRow(t, 0);
    if (more > 0)
      out.push({
        key: `m:${b}`,
        kind: "more",
        board: b,
        line: sgr(
          COLOR.dim,
          `    … ${more} more (Enter: all threads on #${b})`,
        ),
      });
  }
  return out;
}

/** Index of the cursor row. A row that went away falls back to its board, then the top. */
export function treeCursor(rows: TreeRow[], v: View): number {
  const at = v.tree.at;
  const i = rows.findIndex((r) => r.key === at);
  if (i >= 0 || !at) return Math.max(0, i);
  const id = at.split(":")[1] ?? "";
  const board = at.startsWith("b:") || at.startsWith("m:") ? id : boardOf(id);
  return Math.max(
    0,
    rows.findIndex((r) => r.key === `b:${board}`),
  );
}

function tree(s: State, v: View, room: number): string[] {
  const rows = treeRows(s, v);
  const needs = new Set(openAsks(s).map((a) => a.thread)).size;
  const head =
    needs > 0
      ? `  ${sgr(`${COLOR.ask};${COLOR.bold}`, `${EMOJI.ask} ${needs} needs you`)}`
      : `  ${EMOJI.idle} Nothing summons you.`;
  if (rows.length === 0)
    return [head, "", `  ${EMOJI.idle} No boards yet. Press N to post a task.`];
  const i = treeCursor(rows, v);
  const lines = rows.flatMap((r, j) => [
    `${j === i ? sgr(COLOR.bold, "▶ ") : "  "}${r.line}`,
    ...(r.lines ?? []).map((l) => `  ${l}`),
  ]);
  const at = rows
    .slice(0, i)
    .reduce((n, r) => n + 1 + (r.lines?.length ?? 0), 0);
  const fit = Math.max(1, room - 2);
  const start = Math.max(
    0,
    Math.min(at - Math.floor(fit / 2), lines.length - fit),
  );
  return [head, "", ...lines.slice(start, start + fit)];
}

// ---- who / sysop / doors / bulletins / log / deck --------------------------

function who(s: State): string[] {
  const on = new Set(online(s));
  // Caller column fits the longest handle (stage agents have long ones), capped at 30.
  const cw =
    Math.min(
      30,
      Math.max(
        12,
        ...Object.keys(s.p.callers)
          .filter((h) => h !== "server")
          .map((h) => h.length),
      ),
    ) + 2;
  const rows = Object.values(s.p.callers)
    .filter((c) => c.handle !== "server")
    .map((c) => {
      const t = Object.values(s.p.tasks)
        .filter((x) => x.owner === c.handle && isOpen(x))
        .at(-1);
      const held = Object.values(s.p.locks).find(
        (l) => l.holder?.caller === c.handle,
      );
      const qi = Object.values(s.p.locks)
        .flatMap((l) => l.queue.map((q, i) => ({ l, q, i })))
        .find((x) => x.q.caller === c.handle);
      const lockCol = held
        ? `holds ${held.name}`
        : qi
          ? `${qi.l.name} queue #${qi.i + 1}`
          : "—";
      const left = held?.holder
        ? mmss((held.holder.expiresAt - s.now) / 1000)
        : t
          ? mmss(t.budget.seconds_left)
          : "—";
      const quiet = s.now - (s.p.callers[c.handle]?.last_at ?? s.now);
      const idle = t ? stalledMin(s, t) : undefined;
      const state = on.has(c.handle)
        ? WORDS.online
        : idle !== undefined
          ? sgr(`${COLOR.ask};${COLOR.bold}`, `⚠ stalled ${ago(idle)}`)
          : `silent ${ago(Math.floor(quiet / 60_000))}`;
      return `  ${pad(cut(c.handle, cw - 2), cw)}${pad(roleOf(c.handle), 11)}${pad(t ? `#${boardOf(t.thread_id)}` : "—", 12)}${pad(t ? badge(t.status) : "—", badgeW)} ${pad(lockCol, 22)}${pad(left, 7)}${state}`;
    });
  return [
    sgr(
      COLOR.bold,
      `  ${pad("caller", cw)}${pad("role", 11)}${pad("board", 12)}${pad("status", badgeW + 1)}${pad("lock / queue", 22)}${pad("left", 7)}state`,
    ),
    ...(rows.length ? rows : [`  ${EMOJI.idle} Nobody has called yet.`]),
  ];
}

export const askList = openAsks;

function sysop(s: State, v: View): string[] {
  const asks = openAsks(s);
  const flick = lit(v) ? COLOR.bold : COLOR.dim;
  return [
    sgr(COLOR.bold, `  Sysop queue — ${asks.length} waiting`),
    ...(asks.length === 0
      ? [`  ${EMOJI.idle} The queue is empty. Nothing summons you.`]
      : []),
    ...asks.flatMap((a, i) => [
      `${sel(v, i)}${sgr(`${COLOR.ask};${flick}`, `${EMOJI.ask} ${a.thread}`)} ${sgr(COLOR.dim, `from ${a.caller} · ask ${a.id.slice(0, 8)}`)}`,
      ...formatBody(stripUnsafe(a.text), EMOJI.ask, v.cols - 8, COLOR.ask).map(
        (l) => `      ${l}`,
      ),
    ]),
  ];
}

export const gameList = (s: State) => published(s);

function doors(s: State, v: View): string[] {
  const locks = Object.values(s.p.locks);
  const pub = published(s);
  return [
    sgr(COLOR.bold, "  Doors (locks)"),
    ...(locks.length === 0
      ? [`  ${EMOJI.idle} No door has been touched.`]
      : []),
    ...locks.flatMap((l) => [
      `  ${pad(l.name, 14)}${l.holder ? `held by ${l.holder.caller} (${l.holder.thread}) · fencing token #${l.holder.token} · lease ${mmss((l.holder.expiresAt - s.now) / 1000)}` : `free · last fencing token #${l.lastToken}`}`,
      ...l.queue.map((q, i) =>
        sgr(
          COLOR.ask,
          `      #${i + 1} ${q.thread} (${q.caller}): Door busy — you are #${i + 1}`,
        ),
      ),
    ]),
    "",
    sgr(
      COLOR.bold,
      `  #arcade games and #slides decks${s.landingUrl ? ` · landing page ${s.landingUrl}` : ""}`,
    ),
    ...(pub.length === 0 ? [`  ${EMOJI.idle} Nothing published yet.`] : []),
    ...pub.map(
      (p, i) =>
        `${sel(v, i)}${pad(p.kind, 6)}${pad(p.slug, 22)}${sgr(COLOR.dim, `from ${p.thread}`)}  ${sgr(COLOR.sysop, p.kind === "game" ? "[Enter] launch" : "[Enter] view deck")}`,
    ),
  ];
}

function bulletins(s: State, v: View): string[] {
  return [
    sgr(
      COLOR.bold,
      `  Bulletins — ${s.lessons.length} lesson${s.lessons.length === 1 ? "" : "s"} in the hub (${WORDS.lesson})`,
    ),
    ...(s.lessons.length === 0 ? [`  ${EMOJI.idle} No lessons yet.`] : []),
    ...s.lessons.flatMap((l, i) => [
      `${sel(v, i)}${EMOJI.lesson} ${sgr(COLOR.dim, `source: ${l.project} / ${l.thread}${l.tags.length ? ` · ${l.tags.join(", ")}` : ""}`)}`,
      ...wrap(stripUnsafe(l.text), v.cols - 8).map(
        (x) => `      ${sgr(COLOR.witch, x)}`,
      ),
    ]),
  ];
}

function log(s: State, _v: View, room: number): string[] {
  return s.events
    .slice(-room)
    .map(
      (e) =>
        `  ${sgr(COLOR.dim, `#${e.seq} ${hhmmss(e.at)}`)} ${pad(e.caller, 12)}${pad(e.type, 10)}${e.thread_id}`,
    );
}

function deck(s: State, v: View): string[] {
  const d =
    published(s).filter((p) => p.kind === "deck")[v.sel] ??
    published(s).find((p) => p.kind === "deck");
  if (!d) return [`  ${EMOJI.idle} No deck published yet.`];
  const t = s.p.tasks[d.thread];
  return [
    sgr(
      COLOR.bold,
      `  Deck ${d.slug}  (thread ${d.thread}${t ? `, ${t.status}` : ""})`,
    ),
    `  ${sgr(COLOR.sysop, `[Enter] open the viewer: published/decks/${d.slug}/index.html`)}`,
    "",
    ...(t?.posts
      .filter((p) => p.type === "MILESTONE")
      .flatMap((p, i) =>
        wrap(`${i + 1}. ${stripUnsafe(p.text)}`, v.cols - 6).map(
          (l) => `    ${l}`,
        ),
      ) ?? []),
  ];
}

// ---- [O] open file: picker and viewer ----------------------------------------

/** The words of a post that can name files. */
export const postText = (e: Event): string => {
  const b = e.body as { text?: unknown; reasons?: unknown };
  return typeof b.text === "string"
    ? b.text
    : Array.isArray(b.reasons)
      ? b.reasons.join("\n")
      : "";
};

/** Rows of file content the viewer shows at once (the body minus its 2 header lines). */
export const pageOf = (v: View): number =>
  Math.max(1, Math.max(5, v.rows - 3 - (v.replay ? 2 : 1)) - 2);

function pathsScreen(v: View): string[] {
  const p = v.paths;
  if (!p) return [];
  return [
    sgr(COLOR.bold, `  Files named in ${p.thread}`),
    "",
    ...p.list.map(
      (f, i) => `${sel(v, i)}${sgr(COLOR.path, cut(f, v.cols - 4))}`,
    ),
  ];
}

const SGR_ANY = /\x1b\[[0-9;]*m/g;

/** File text as screen lines. It is untrusted: no control sequences, not even colours. */
export const fileLines = (text: string): string[] =>
  stripUnsafe(text.replace(/\r\n?/g, "\n"))
    .replace(SGR_ANY, "")
    .replace(/\n$/, "")
    .split("\n");

function fileScreen(v: View): string[] {
  const f = v.file;
  if (!f) return [];
  const c = f.content;
  const page = pageOf(v);
  if (c.kind === "dir") {
    const start = Math.max(0, v.sel - page + 1);
    return [
      `  ${sgr(`${COLOR.path};${COLOR.bold}`, `${c.path || "."}/`)}  ${sgr(COLOR.dim, `${c.entries.length} entr${c.entries.length === 1 ? "y" : "ies"} · ${f.thread}`)}`,
      "",
      ...(c.entries.length === 0 ? [`  ${EMOJI.idle} Empty folder.`] : []),
      ...c.entries
        .slice(start, start + page)
        .map(
          (e, i) =>
            `${sel(v, start + i)}${e.endsWith("/") ? sgr(COLOR.path, e) : e}`,
        ),
    ];
  }
  // File text is untrusted: no control sequences, not even colours.
  const lines = fileLines(c.text);
  const md = /\.(md|markdown)$/i.test(c.path);
  const nw = String(lines.length).length;
  const top = Math.min(v.scroll, Math.max(0, lines.length - page));
  return [
    `  ${sgr(`${COLOR.path};${COLOR.bold}`, c.path)}  ${sgr(COLOR.dim, `${lines.length} line${lines.length === 1 ? "" : "s"} · ${top + 1}-${Math.min(lines.length, top + page)} · ${f.thread}`)}`,
    "",
    ...lines.slice(top, top + page).map((l, i) => {
      const n = sgr(COLOR.dim, `${String(top + i + 1).padStart(nw)} │`);
      return `  ${n} ${md && /^#{1,6}\s/.test(l) ? sgr(COLOR.bold, l) : l}`;
    }),
  ];
}

function bye(): string[] {
  return [
    "",
    "",
    sgr(COLOR.error, `  ${WORDS.logout}`),
    sgr(COLOR.dim, `  The line goes cold… you are logged out.`),
  ];
}

// ---- frame ----------------------------------------------------------------

const HELP: Record<string, string> = {
  login: "any key: enter · N new task · M sound",
  tree: "↑↓ move · ←→ fold · Enter thread · O open file · R reply · N new task · B W S D L U · Esc menu",
  menu: "KEYS (no mouse): B boards W who S sysop D doors L log U news N new task",
  boards: "↑↓ select · Enter open · N new task · Esc back",
  threads: "↑↓ select · Enter open · N new task · Esc back",
  thread:
    "↑↓ scroll · O open file · R reply · A answer · P approve · N deny · X force done · Esc back",
  who: "N new task · Esc back",
  sysop:
    "↑↓ select · A answer · P approve · N deny · Enter open thread · Esc back",
  doors: "↑↓ select · Enter launch/view · N new task · Esc back",
  bulletins: "↑↓ select · Enter open source thread · N new task · Esc back",
  log: "N new task · Esc back",
  deck: "Enter open viewer · N new task · Esc back",
  paths: "↑↓ select · Enter open · Esc back",
  file: "↑↓ PgUp PgDn scroll · Esc back",
  bye: "",
};

/** True where [N] means "deny": a thread or the Sysop queue with an ASK to answer. */
export function denyScreen(s: State, v: View): boolean {
  if (v.screen === "sysop") return askList(s)[v.sel] !== undefined;
  if (v.screen === "thread")
    return askList(s).some((x) => x.thread === v.thread);
  return false;
}

/** Help line: where no ASK is open, [N] starts a new task instead of denying. */
function helpFor(s: State, v: View): string {
  const h = helpBase(s, v);
  return ["login", "tree", "bye"].includes(v.screen) ? h : `${h} · T tree`;
}

function helpBase(s: State, v: View): string {
  if ((v.screen === "thread" || v.screen === "sysop") && !denyScreen(s, v))
    return v.screen === "thread"
      ? "↑↓ scroll · O open file · R reply · N new task · X force done · Esc back"
      : "↑↓ select · N new task · Enter open thread · Esc back";
  if (v.screen === "file" && v.file?.content.kind === "dir")
    return "↑↓ select · Enter open · Esc back";
  return HELP[v.screen] ?? "";
}

/** Replay HUD (task 21): badge always visible, scrub bar with markers, controls. */
function hud(v: View, runId: string | undefined): string[] {
  const r = v.replay;
  if (!r) return [];
  const w = Math.min(40, v.cols - 40);
  const bar: string[] = Array.from({ length: w }, (_, i) =>
    r.total > 0 && i <= Math.round((r.pos / r.total) * (w - 1)) ? "█" : "░",
  );
  for (const m of r.markers) {
    const i = Math.min(
      w - 1,
      Math.round((m.at / Math.max(1, r.total)) * (w - 1)),
    );
    bar[i] = m.kind === "ask" ? "?" : m.kind === "refusal" ? "!" : "d";
  }
  return [
    `${sgr(`${COLOR.error};${COLOR.bold}`, ` REPLAY ×${r.speed} — real log ${runId ?? "?"} `)} ${r.playing ? "▶ playing" : "⏸ paused"}  [${bar.join("")}] ${r.pos}/${r.total}`,
    sgr(
      COLOR.dim,
      ` Space play/pause · 1 5 2 speed 1× 5× 20× · ${v.screen === "tree" ? "" : "←/→ step event · "}Home restart · markers: ? ask  ! refusal  d done`,
    ),
  ];
}

function fog(v: View): string {
  const shift = v.reducedMotion ? 0 : Math.floor(v.now / MOTION.fog);
  const base = "· ░ ·· ▒ · ░░ · ";
  const line = base.repeat(Math.ceil(v.cols / base.length) + 1);
  return sgr(
    COLOR.dim,
    line.slice(shift % base.length, (shift % base.length) + v.cols),
  );
}

function overlay(v: View): string[] {
  const d = v.denied;
  if (!d) return [];
  const p = progress(v, "denied", MOTION.shake);
  const shake = p < 1 && Math.floor(p * 6) % 2 === 1 ? " " : "";
  const flash = p < 1 ? `${COLOR.error};${COLOR.inverse}` : COLOR.error;
  const lines = [
    `${EMOJI.refusal} ACCESS DENIED · ${d.error.code}  ${d.transition}`,
    `fact: ${d.error.message}`,
    `> "${d.error.voice}"`,
    `> hint: ${d.error.hint}`,
  ];
  return box(
    lines.map((l) => cut(l, v.cols - 6)),
    Math.min(v.cols - 4, 96),
    { double: true, style: flash },
  ).map((l) => shake + "  " + l);
}

// ---- new-task form (a box over the current screen) -------------------------

/** Body lines the form shows at most before it scrolls. */
export const FORM_BODY_ROWS = 12;
export const FORM_HELP =
  "Tab next field · Shift+Tab back · Ctrl+S or Ctrl+Enter submit · Esc cancel";

/** The end of `s` that fits `n` cells, so the cursor stays in view. */
function tail(s: string, n: number): string {
  const ch = [...s];
  let out = "";
  for (let i = ch.length - 1; i >= 0; i--) {
    if (vlen(ch[i]! + out) > n) break;
    out = ch[i]! + out;
  }
  return out;
}

function formBox(s: State, f: NewTaskForm, v: View, room: number): string[] {
  const width = Math.min(v.cols - 4, 76);
  const cw = width - 4; // inside the border, one space each side
  const on = (fl: NewTaskForm["field"]) => f.field === fl;
  const label = (fl: NewTaskForm["field"], t: string) =>
    on(fl)
      ? sgr(`${COLOR.sysop};${COLOR.bold}`, pad(t, 7))
      : sgr(COLOR.dim, pad(t, 7));
  const input = (fl: NewTaskForm["field"], text: string, sel = false) => {
    const n = cw - 9;
    const cur = on(fl) ? "█" : "";
    const shown = tail(text, n - vlen(cur));
    const body = sel && on(fl) ? sgr(COLOR.inverse, shown) : shown;
    const br = (b: string) => sgr(on(fl) ? COLOR.sysop : COLOR.dim, b);
    return `${br("[")}${pad(body + cur, n)}${br("]")}`;
  };
  const err = (fl: "board" | "title") =>
    f.error?.field === fl
      ? [sgr(COLOR.error, `       ${EMOJI.refusal} ${f.error.text}`)]
      : [];
  const boards = boardNames(s);
  const pick = boards.length
    ? [
        `       ${sgr(COLOR.dim, "↑↓")} ${boards
          .map((b) =>
            b === f.board
              ? sgr(`${COLOR.sysop};${COLOR.bold}`, `#${b}`)
              : sgr(COLOR.dim, `#${b}`),
          )
          .join(
            " ",
          )}${boards.includes(f.board.toLowerCase()) ? "" : sgr(COLOR.dim, "  (new board)")}`,
      ]
    : [
        sgr(
          COLOR.dim,
          "       (type a board name; it is created with the task)",
        ),
      ];
  const fixed = 9 + pick.length + err("board").length + err("title").length;
  const rows = Math.max(3, Math.min(FORM_BODY_ROWS, room - fixed));
  const wrapped = wrap(f.body + (on("body") ? "█" : ""), cw - 2);
  const scroll = Math.min(f.scroll, Math.max(0, wrapped.length - rows));
  const end = wrapped.length - scroll;
  const shown = wrapped.slice(Math.max(0, end - rows), end);
  const gutter = sgr(on("body") ? COLOR.sysop : COLOR.dim, "┊ ");
  const above = Math.max(0, end - rows);
  const bodyHead = `${label("body", "Body")}${sgr(COLOR.dim, "Enter = new line")}${
    above || scroll
      ? sgr(COLOR.dim, `  (↑ ${above} · ↓ ${scroll} more, ↑↓ scroll)`)
      : ""
  }`;
  const submit = on("submit")
    ? sgr(`${COLOR.sysop};${COLOR.inverse}`, "[ Submit ]")
    : sgr(COLOR.sysop, "[ Submit ]");
  const buttons = f.confirm
    ? sgr(
        `${COLOR.error};${COLOR.bold}`,
        "Discard this task? Y discard · any other key keeps it",
      )
    : `${" ".repeat(Math.max(0, cw - 24))}${submit}  ${sgr(COLOR.dim, "Esc cancel")}`;
  const lines = [
    "",
    `${label("board", "Board")}${input("board", f.board, f.fresh)}`,
    ...pick,
    ...err("board"),
    `${label("title", "Title")}${input("title", f.title)}`,
    ...err("title"),
    bodyHead,
    ...shown.map((l) => gutter + l),
    ...Array<string>(rows - shown.length).fill(gutter),
    "",
    buttons,
  ].map((l) => ` ${l}`);
  return box(lines, width, {
    double: true,
    style: COLOR.sysop,
    title: `${EMOJI.sysop} New task · whisper it to the crypt`,
  });
}

const TITLES: Record<string, string> = {
  login: "login",
  tree: "boards tree",
  menu: "main menu",
  boards: "boards",
  threads: "threads",
  thread: "thread",
  who: "who's online",
  sysop: "sysop queue",
  doors: "doors",
  bulletins: "bulletins",
  log: "log",
  deck: "deck viewer",
  paths: "open file",
  file: "file viewer",
  bye: "goodbye",
};

/** The whole screen as one ANSI string. `render(state, view)` is deterministic in both arguments. */
export function render(s: State, v: View): string {
  const room = Math.max(5, v.rows - 3 - (v.replay ? 2 : 1));
  const ov = overlay(v);
  const bodyRoom = room - ov.length;
  let body: string[];
  switch (v.screen) {
    case "login":
      body = login(s, v);
      break;
    case "tree":
      body = tree(s, v, bodyRoom);
      break;
    case "menu":
      body = menu(s, v);
      break;
    case "boards":
      body = boards(s, v);
      break;
    case "threads":
      body = threads(s, v);
      break;
    case "thread":
      body = thread(s, v, bodyRoom);
      break;
    case "who":
      body = who(s);
      break;
    case "sysop":
      body = sysop(s, v);
      break;
    case "doors":
      body = doors(s, v);
      break;
    case "bulletins":
      body = bulletins(s, v);
      break;
    case "log":
      body = log(s, v, bodyRoom);
      break;
    case "deck":
      body = deck(s, v);
      break;
    case "paths":
      body = pathsScreen(v);
      break;
    case "file":
      body = fileScreen(v);
      break;
    default:
      body = bye();
  }
  body = [
    ...body.slice(0, bodyRoom),
    ...Array<string>(Math.max(0, bodyRoom - body.length)).fill(""),
    ...ov,
  ];
  if (v.form) {
    const fb = formBox(s, v.form, v, bodyRoom);
    const top = Math.max(0, Math.floor((body.length - fb.length) / 2));
    const left = " ".repeat(
      Math.max(0, Math.floor((v.cols - vlen(fb[0] ?? "")) / 2)),
    );
    fb.slice(0, body.length).forEach((l, i) => (body[top + i] = left + l));
  }
  const left = ` ${sgr(`${COLOR.sysop};${COLOR.bold}`, "GRAVEYARD BBS")} ${sgr(COLOR.dim, `· ${TITLES[v.screen] ?? v.screen}`)}`;
  const right = sgr(COLOR.dim, `sound ${v.muted ? "off" : "on"} [M] `);
  const header =
    left + " ".repeat(Math.max(1, v.cols - vlen(left) - vlen(right))) + right;
  const help = v.form
    ? sgr(COLOR.dim, ` ${FORM_HELP}`)
    : v.input
      ? ` ${sgr(COLOR.ask, `${v.input.prompt}> `)}${v.input.buf}█`
      : v.flash
        ? ` ${v.flash}`
        : sgr(COLOR.dim, ` ${helpFor(s, v)}`);
  const foot = v.replay ? hud(v, s.runId) : [fog(v)];
  const rows = [header, ...body, help, ...foot].map((l) => truncate(l, v.cols));
  return `${ESC}[?25l${ESC}[H${rows.map((l) => `${l}${RESET}${ESC}[K`).join("\r\n")}${ESC}[J`;
}
