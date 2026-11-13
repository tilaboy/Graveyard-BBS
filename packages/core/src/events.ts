import { z } from "zod";

export const ROLES = [
  "sysop",
  "moderator",
  "designer",
  "builder",
  "reviewer",
  "release",
  "artist",
] as const;
export type Role = (typeof ROLES)[number];

export const STATUSES = [
  "pending",
  "running",
  "blocked",
  "awaiting-review",
  "done",
  "cancelled",
] as const;
export type Status = (typeof STATUSES)[number];

const text = z.string();
const budget = z.object({
  turns_left: z.number().int().nonnegative(),
  seconds_left: z.number().nonnegative(),
  credits_left: z.number().nonnegative().optional(),
});
export type Budget = z.infer<typeof budget>;

const spend = z.object({
  turns: z.number().nonnegative().optional(),
  seconds: z.number().nonnegative().optional(),
  credits: z.number().nonnegative().optional(),
});

const base = z.object({
  id: z.string(),
  seq: z.number().int().positive(),
  at: z.number(),
  thread_id: z.string(),
  caller: z.string(),
});

const ev = <T extends string, B extends z.ZodType>(type: T, body: B) =>
  base.extend({ type: z.literal(type), body });

/** R3.4: every event carries id, seq, at, thread_id, caller, type, body. */
export const EventSchema = z.discriminatedUnion("type", [
  ev(
    "TASK",
    z.object({
      text,
      assigned: z.string().optional(),
      parent: z.string().optional(),
      budget: budget.optional(),
    }),
  ),
  ev("NOTE", z.object({ text, next: text.optional() })),
  ev("ASK", z.object({ text, to: z.string().optional() })),
  ev("ANSWER", z.object({ text, ask_id: z.string() })),
  ev(
    "MILESTONE",
    z.object({
      text,
      code_change: z.boolean().optional(),
      files: z
        .array(z.object({ path: z.string(), hash: z.string() }))
        .optional(),
      next: text.optional(),
    }),
  ),
  ev("EVIDENCE", z.object({ text })),
  ev("TRIED", z.object({ text, reason: text })),
  ev(
    "REVIEW",
    z.object({ verdict: z.enum(["pass", "reject"]), reasons: z.array(text) }),
  ),
  ev("CLAIM", z.object({ lock: text })),
  ev(
    "GRANT",
    z.object({
      lock: text,
      token: z.number().int().positive(),
      expiresAt: z.number(),
    }),
  ),
  ev("QUEUE", z.object({ lock: text, position: z.number().int().positive() })),
  ev("RELEASE", z.object({ lock: text })),
  ev("HEARTBEAT", z.object({ lock: text, expiresAt: z.number() })),
  ev(
    "STATUS",
    z.object({
      from: z.enum(STATUSES),
      to: z.enum(STATUSES),
      reason: text.optional(),
    }),
  ),
  ev("ACK", z.object({ packet_id: text })),
  ev("REP", z.object({ text })),
  ev(
    "SYSTEM",
    z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("lease-expired"), lock: text }),
      z.object({ kind: z.literal("budget-spent"), spend }),
      z.object({ kind: z.literal("budget-raised"), spend }),
      z.object({ kind: z.literal("qwk-issued"), packet_id: text }),
    ]),
  ),
]);

export type Event = z.infer<typeof EventSchema>;
export type EventType = Event["type"];
export type BodyOf<T extends EventType> = Extract<Event, { type: T }>["body"];

/** Post kinds a caller may write through the `post` command. */
export const POST_KINDS = [
  "NOTE",
  "ASK",
  "ANSWER",
  "MILESTONE",
  "EVIDENCE",
  "TRIED",
] as const;
export type PostKind = (typeof POST_KINDS)[number];

/** Plain text of a post-like event, for QWK summaries. */
export function postText(e: Event): string | undefined {
  switch (e.type) {
    case "TASK":
    case "NOTE":
    case "ASK":
    case "ANSWER":
    case "MILESTONE":
    case "EVIDENCE":
    case "REP":
      return e.body.text;
    case "TRIED":
      return `${e.body.text} (${e.body.reason})`;
    case "REVIEW":
      return `${e.body.verdict}: ${e.body.reasons.join("; ")}`;
    default:
      return undefined;
  }
}
