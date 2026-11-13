import { z } from "zod";
import type { Projections, Task } from "./fold.js";
import { qwkPacketId } from "./decide.js";
import { fail, ok, type Result } from "./voice.js";

export const SECTION_ORDER = [
  "goal",
  "summary",
  "tried",
  "lessons",
  "artifacts",
  "locks",
  "constraints",
  "next",
] as const;
export type SectionName = (typeof SECTION_ORDER)[number];

/** A lesson matched by the server (matching and storage live outside core, spec 03). */
export interface Lesson {
  text: string;
  project: string;
  thread: string;
}

export interface QwkOptions {
  /** Token limit, default 6 000 (qwk-packets.md). */
  maxTokens?: number;
  gate?: string;
  constraints?: readonly string[];
  lessons?: readonly Lesson[];
}

export interface QwkPacket {
  id: string;
  sections: { name: SectionName; lines: string[] }[];
  tokens: number;
}

const RECENT = 8;
const OLDER_MAX = 20;
const clip = (s: string, n: number) =>
  s.length > n ? `${s.slice(0, n - 1)}…` : s;
const tokensOf = (sections: QwkPacket["sections"]) =>
  Math.ceil(
    sections.reduce(
      (n, s) => n + s.name.length + s.lines.join("\n").length,
      0,
    ) / 4,
  );

function chain(p: Projections, t: Task): Task[] {
  const out: Task[] = [];
  const seen = new Set<string>();
  for (
    let c: Task | undefined = t;
    c && !seen.has(c.thread_id);
    c = c.parent ? p.tasks[c.parent] : undefined
  ) {
    seen.add(c.thread_id);
    out.unshift(c);
  }
  return out;
}

/** R5.1 / R5.4 / R5.6: sections in fixed order; shrink summary, lessons, artifacts, constraints, never tried. */
export function buildQwk(
  p: Projections,
  threadId: string,
  opts: QwkOptions = {},
): Result<QwkPacket> {
  const t = p.tasks[threadId];
  if (!t)
    return fail(
      "NOT_FOUND",
      `thread ${threadId} does not exist`,
      "Check the thread id.",
    );
  const ancestors = chain(p, t);
  const root = ancestors[0]!;

  const posts = t.posts.filter((x) => x.type !== "TASK" && x.type !== "TRIED");
  const older = posts
    .slice(0, Math.max(0, posts.length - RECENT))
    .slice(-OLDER_MAX);
  const recent = posts.slice(-RECENT);
  const b = t.budget;
  const held = Object.values(p.locks).flatMap((l) => [
    ...(l.holder?.thread === threadId
      ? [`holds ${l.name} (token ${l.holder.token})`]
      : []),
    ...l.queue.flatMap((q, i) =>
      q.thread === threadId ? [`queued for ${l.name} (position ${i + 1})`] : [],
    ),
  ]);
  const lines: Record<SectionName, string[]> = {
    goal: [
      root.text,
      ...(root === t ? [] : [`stage: ${t.text}`]),
      ...(opts.gate ? [`gate: ${opts.gate}`] : []),
    ],
    summary: [
      ...older.map((x) => `- ${x.caller} ${x.type}: ${clip(x.text, 80)}`),
      ...recent.map((x) => `> #${x.seq} ${x.caller} ${x.type}: ${x.text}`),
    ],
    tried: ancestors.flatMap((a) =>
      a.tried.map((x) => `- [${a.thread_id}] ${x.text} — ${x.reason}`),
    ),
    lessons: (opts.lessons ?? []).map(
      (l) => `- ${l.text} (from ${l.project}/${l.thread})`,
    ),
    artifacts: Object.entries(t.artifacts)
      .sort(([a], [c]) => a.localeCompare(c))
      .map(([path, hash]) => `${path}  ${hash}`),
    locks: held,
    constraints: [
      ...(opts.constraints ?? []),
      `budget left: ${b.turns_left} turns, ${b.seconds_left} s${b.credits_left !== undefined ? `, ${b.credits_left} credits` : ""}`,
    ],
    next: [
      (t.parent ? p.tasks[t.parent]?.next : undefined) ?? t.next ?? "",
    ].filter(Boolean),
  };

  const sections = SECTION_ORDER.filter(
    (n) => n !== "lessons" || opts.lessons !== undefined,
  ).map((name) => ({
    name,
    lines: lines[name],
  }));
  const max = opts.maxTokens ?? 6000;
  for (const name of [
    "summary",
    "lessons",
    "artifacts",
    "constraints",
  ] as const) {
    const s = sections.find((x) => x.name === name);
    while (s && s.lines.length > 0 && tokensOf(sections) > max) {
      if (name === "summary") s.lines.shift();
      else s.lines.pop();
    }
  }
  return ok({
    id: t.packet ?? qwkPacketId(p, threadId),
    sections,
    tokens: tokensOf(sections),
  });
}

const RepSchema = z.object({
  changed: z.string(),
  evidence_ids: z.array(z.string()),
  tried: z.array(z.object({ text: z.string(), reason: z.string() })),
  questions: z.array(z.string()),
});
export type Rep = z.infer<typeof RepSchema>;

/** R5.5: validate a REP packet (JSON text) and reject evidence ids the thread does not have. */
export function parseRep(
  p: Projections,
  threadId: string,
  text: string,
): Result<Rep> {
  const t = p.tasks[threadId];
  if (!t)
    return fail(
      "NOT_FOUND",
      `thread ${threadId} does not exist`,
      "Check the thread id.",
    );
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return fail(
      "NOT_FOUND",
      "REP is not valid JSON",
      "Send changed, evidence_ids, tried, questions as JSON.",
    );
  }
  const parsed = RepSchema.safeParse(raw);
  if (!parsed.success)
    return fail(
      "NOT_FOUND",
      `REP is malformed: ${parsed.error.issues[0]?.message ?? "?"}`,
      "Send changed, evidence_ids, tried, questions.",
    );
  const unknown = parsed.data.evidence_ids.filter(
    (id) => !t.evidence_ids.includes(id),
  );
  if (unknown.length > 0)
    return fail(
      "NOT_FOUND",
      `unknown evidence ids: ${unknown.join(", ")}`,
      "Cite only EVIDENCE posts of this thread.",
    );
  return ok(parsed.data);
}
