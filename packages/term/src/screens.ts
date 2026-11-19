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
  parseJson,
  published,
  roleOf,
  threadsOf,
  treeTasks,
  boardOf,
  type State,
  type View,
} from "./state.js";
import { COLOR, EMOJI, MOTION, POST_COLOR, STATUS, WORDS } from "./theme.js";
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
  return [
    bat,
    ...lines.map((l) => `  ${l}`),
    "",
    ...TOMBS.map((l) => sgr(COLOR.note, `  ${l}`)),
    "",
    `  Node 1 · 14400 baud · ${n} caller${n === 1 ? "" : "s"} ${WORDS.online}`,
    `  ${EMOJI.lesson} Bulletins: ${s.lessons.length} new lesson${s.lessons.length === 1 ? "" : "s"}`,
    "",
    sgr(COLOR.dim, "  Press any key to enter… (any key skips the animation)"),
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

/** Header text, body text and style for one event. Door EVIDENCE stays plain (R5.6). */
function describe(
  e: Event,
  s: State,
  v: View,
): { head: string; body: string[]; style: string } {
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
        body: [
          ...(ask && ask.type === "ASK" ? [`> ${ask.body.text}`] : []),
          e.body.text,
        ],
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
        };
      const ok = ev.data.exit_code === 0;
      return {
        head: `${EMOJI.evidence} EVIDENCE ${sgr(ok ? COLOR.pass : COLOR.error, `[exit ${ev.data.exit_code}]`)}`,
        body: [
          `door ${ev.data.door} · ${ev.data.duration_ms} ms${ev.data.commit ? ` · commit ${ev.data.commit.slice(0, 7)}` : ""}`,
        ],
        style,
      };
    }
    case "TRIED":
      return {
        head: "TRIED",
        body: [`${e.body.text} (${e.body.reason})`],
        style,
      };
    case "STATUS":
      return {
        head: `${statusLine(e.body.to)} ${sgr(COLOR.dim, `(was ${e.body.from}${e.body.reason ? `, ${e.body.reason}` : ""})`)}`,
        body: [],
        style,
      };
    case "GRANT":
      return {
        head: `lock ${e.body.lock} granted, fencing token #${e.body.token}`,
        body: [],
        style,
      };
    case "QUEUE":
      return {
        head: `lock ${e.body.lock}: Door busy — queued at #${e.body.position}`,
        body: [],
        style,
      };
    case "RELEASE":
      return { head: `lock ${e.body.lock} released`, body: [], style };
    case "NOTE":
      return { head: "NOTE", body: [e.body.text], style };
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
  const out = [
    `  ${sgr(COLOR.bold, t.thread_id)}  ${statusLine(t.status)}${t.reason ? ` (${t.reason})` : ""}`,
    sgr(
      COLOR.dim,
      `  owner ${t.owner ?? "—"} · turns left ${t.budget.turns_left} · seconds left ${t.budget.seconds_left}`,
    ),
    "",
  ];
  // Posts are numbered per thread (1, 2, 3 …); the global log seq stays in the Log screen.
  postsOf(s, t.thread_id).forEach((e, i) => {
    const d = describe(e, s, v);
    // New posts fade in like mist: dim first, then normal.
    const mist =
      progress(v, `post:${e.seq}`, MOTION.mist) < 0.5 ? `${COLOR.dim};` : "";
    const who = e.caller === "server" ? "server" : e.caller;
    out.push(
      `  ${sgr(COLOR.dim, `#${i + 1} ${hhmmss(e.at)} ${pad(who, 12)}`)} ${sgr(mist + d.style, d.head)}`,
    );
    for (const b of d.body)
      for (const l of wrap(stripUnsafe(b), w))
        out.push(`      ${sgr(mist + d.style, l)}`);
  });
  return out;
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
      const row = `${ind}${mark}${fold} ${pad(badge(t.status), badgeW)} ${n ? sgr(n.style, title) : title} ${pad(t.owner ?? "—", 12)}${sub}${n ? ` ${n.lane}` : ""}`;
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
        const text = d.body[0]
          ? ` ${cut(d.body[0], Math.max(10, v.cols - 50 - 4 * depth))}`
          : "";
        out.push({
          key: `p:${t.thread_id}:${e.seq}`,
          kind: "post",
          board: b,
          thread: t.thread_id,
          line: `${ind}    ${sgr(COLOR.dim, `#${i + 1} ${pad(e.caller, 12)}`)} ${sgr(d.style, d.head)}${sgr(d.style, text)}`,
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
  const fit = Math.max(1, room - 2);
  const start = Math.max(
    0,
    Math.min(i - Math.floor(fit / 2), rows.length - fit),
  );
  return [
    head,
    "",
    ...rows
      .slice(start, start + fit)
      .map(
        (r, j) => `${start + j === i ? sgr(COLOR.bold, "▶ ") : "  "}${r.line}`,
      ),
  ];
}

// ---- who / sysop / doors / bulletins / log / deck --------------------------

function who(s: State): string[] {
  const on = new Set(online(s));
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
      return `  ${pad(c.handle, 14)}${pad(roleOf(c.handle), 11)}${pad(t ? `#${boardOf(t.thread_id)}` : "—", 12)}${pad(t ? badge(t.status) : "—", badgeW)} ${pad(lockCol, 22)}${pad(left, 7)}${on.has(c.handle) ? WORDS.online : "silent"}`;
    });
  return [
    sgr(
      COLOR.bold,
      `  ${pad("caller", 14)}${pad("role", 11)}${pad("board", 12)}${pad("status", badgeW + 1)}${pad("lock / queue", 22)}${pad("left", 7)}state`,
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
      ...wrap(stripUnsafe(a.text), v.cols - 8).map(
        (l) => `      ${sgr(COLOR.ask, l)}`,
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
  login: "any key: enter",
  tree: "↑↓ move · → open · ← fold · Enter full thread · R reply · N new task · B W S D L U · Esc menu",
  menu: "KEYS (no mouse): B boards W who S sysop D doors L log U news N new task",
  boards: "↑↓ select · Enter open · N new task · Esc back",
  threads: "↑↓ select · Enter open · N new task · Esc back",
  thread:
    "↑↓ scroll · R reply · A answer · P approve · N deny · X force done · Esc back",
  who: "N new task · Esc back",
  sysop:
    "↑↓ select · A answer · P approve · N deny · Enter open thread · Esc back",
  doors: "↑↓ select · Enter launch/view · N new task · Esc back",
  bulletins: "↑↓ select · Enter open source thread · N new task · Esc back",
  log: "N new task · Esc back",
  deck: "Enter open viewer · N new task · Esc back",
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
      ? "↑↓ scroll · R reply · N new task · X force done · Esc back"
      : "↑↓ select · N new task · Enter open thread · Esc back";
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
    default:
      body = bye();
  }
  body = [
    ...body.slice(0, bodyRoom),
    ...Array<string>(Math.max(0, bodyRoom - body.length)).fill(""),
    ...ov,
  ];
  const left = ` ${sgr(`${COLOR.sysop};${COLOR.bold}`, "GRAVEYARD BBS")} ${sgr(COLOR.dim, `· ${TITLES[v.screen] ?? v.screen}`)}`;
  const right = sgr(COLOR.dim, `sound ${v.muted ? "off" : "on"} [M] `);
  const header =
    left + " ".repeat(Math.max(1, v.cols - vlen(left) - vlen(right))) + right;
  const help = v.input
    ? ` ${sgr(COLOR.ask, `${v.input.prompt}> `)}${v.input.buf}█`
    : v.flash
      ? ` ${v.flash}`
      : sgr(COLOR.dim, ` ${helpFor(s, v)}`);
  const foot = v.replay ? hud(v, s.runId) : [fog(v)];
  const rows = [header, ...body, help, ...foot].map((l) => truncate(l, v.cols));
  return `${ESC}[?25l${ESC}[H${rows.map((l) => `${l}${RESET}${ESC}[K`).join("\r\n")}${ESC}[J`;
}
