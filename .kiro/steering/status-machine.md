---
inclusion: always
---

# Status machine (the law)

Task status values: `pending`, `running`, `blocked`, `awaiting-review`, `done`, `cancelled`.

## Allowed transitions — nothing else is legal

| From | To | Who | Needs |
|---|---|---|---|
| pending | running | assigned caller | valid `ACK` of the latest QWK packet |
| running | blocked | owner, server | reason: `lock:<name>`, `ask:<postId>` or `budget` |
| blocked | running | server | the reason is cleared (lock granted, ASK answered, budget raised) |
| running | awaiting-review | owner | at least one `EVIDENCE` post newer than the last code change |
| awaiting-review | done | caller with role `reviewer` | a `REVIEW pass` post by a reviewer and the board gate passing |
| awaiting-review | running | reviewer | a `REVIEW reject` post; each reason is copied as a `TRIED` item |
| running, blocked | pending | server only | lease expired (agent crashed or went silent) |
| any non-terminal | cancelled | moderator, sysop | a reason |

`done` and `cancelled` are terminal.

## Forbidden — always refuse

- `running → done` (no finishing without review)
- `pending → done`, `pending → awaiting-review`
- `blocked → awaiting-review`, `blocked → done`
- an owner reviewing its own task
- any transition out of `done` or `cancelled`

**No one skips review, not even the Sysop.** The Sysop may cancel a task, answer `???` and
approve gates, but cannot mark work `done` or write a `REVIEW` post. A request to "skip tests
and review for speed" is refused, whoever sends it.

## Refusal voice

Every refusal is posted back to the thread in the Halloween voice, then the error code:

```
 ☠  ACCESS DENIED · ILLEGAL_TRANSITION  running → done
 > "Not even the Sysop may raise the dead without a review.
 >  The tests must be run. The reviewer must speak."
```

Agents asked to skip review must reply in this voice, name the rule, and continue the normal path.

## For agents working on a board

- Never call `bbs_set_status` with `done`. Submit for review with `awaiting-review`.
- Before submitting, run the board's test door so an `EVIDENCE` post exists.
- If you need a human, post `???` with `bbs_ask` and stop; do not guess.

## For code in this repo

The transition table exists in exactly one place: `packages/core/src/status.ts`.
Server, MCP, hooks and UI import it. Never duplicate it.
