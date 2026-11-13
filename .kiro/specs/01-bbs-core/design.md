# Design — 01 BBS core

## Shape

Command → `decide(state, command, ctx) → Event[] | Error` → append → `fold`.
Classic event sourcing. `decide` and `fold` are pure.

```ts
type Ctx = { now: number; newId: () => string };

function decide(p: Projections, cmd: Command, ctx: Ctx): Result<Event[], DomainError>;
function fold(events: readonly Event[]): Projections;
function foldFrom(p: Projections, events: readonly Event[]): Projections;
```

## Events (zod discriminated union on `type`)

`TASK, NOTE, ASK, ANSWER, MILESTONE, EVIDENCE, TRIED, REVIEW, CLAIM, GRANT, QUEUE, RELEASE,
HEARTBEAT, STATUS, ACK, REP, SYSTEM`

Common envelope: `{ id, seq, at, thread_id, caller, type, body }`.

## Status table (single source of truth)

```ts
export const TRANSITIONS = [
  { from: "pending",         to: "running",         who: ["assigned"],            needs: ["acked"] },
  { from: "running",         to: "blocked",         who: ["owner", "server"],     needs: ["reason"] },
  { from: "blocked",         to: "running",         who: ["server"],              needs: ["reason_cleared"] },
  { from: "running",         to: "awaiting-review", who: ["owner"],               needs: ["fresh_evidence"] },
  { from: "awaiting-review", to: "done",            who: ["reviewer"],            needs: ["review_pass", "not_owner", "gate"] },
  { from: "awaiting-review", to: "running",         who: ["reviewer"],            needs: ["review_reject"] },
  { from: "running",         to: "pending",         who: ["server"],              needs: ["lease_expired"] },
  { from: "blocked",         to: "pending",         who: ["server"],              needs: ["lease_expired"] },
  { from: "*",               to: "cancelled",       who: ["moderator", "sysop"],  needs: ["reason"] },
] as const;
```

Each `needs` key maps to a pure predicate over projections. The UI, MCP tool descriptions
and the hook guard all render from this table.

## Locks

```ts
type Lock = { name: string; holder?: { caller; task; token; expiresAt }; queue: QueueEntry[]; lastToken: number };
```

- Claim free → `GRANT{token: lastToken+1, expiresAt: now+lease}`.
- Claim held → `QUEUE{position}` and `STATUS blocked lock:<name>`.
- Release / expiry → `RELEASE` then `GRANT` for queue head, then `STATUS running` for it.
- Expiry is evaluated by a `tick(now)` command the server sends every second.

## QWK builder

`buildQwk(p, threadId, limits) → { id, sections, tokens }`. Token count is estimated
(chars / 4). Shrinking order: summary → artifacts list → constraints. Never `tried`.

## Errors

`ILLEGAL_TRANSITION | NO_EVIDENCE | SELF_REVIEW | ROLE_DENIED | NO_ACK | STALE_TOKEN |
BUDGET_EXHAUSTED | NOT_FOUND`. Each carries a plain `hint` and a themed `voice` line
(Halloween style, from a fixed table in `core/src/voice.ts`) shown in the ACCESS DENIED box.

## Lessons in QWK packets

`buildQwk` takes an optional `lessons: Lesson[]` (already matched by the server) and renders
them as a `lessons` section after `tried`: text, source project, source thread. Matching and
storage live outside core (see spec 03).

## Testing strategy

- Unit tests per command.
- Model-based PBT with `fc.commands` for status + locks (P1, P2, P6).
- Replay PBT: random valid logs, fold vs foldFrom (P3, P4).
- QWK PBT (P5).
