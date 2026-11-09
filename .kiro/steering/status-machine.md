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
| awaiting-review | done | caller with role `reviewer` (or sysop) | a `REVIEW pass` post and the board gate passing |
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

## For agents working on a board

- Never call `bbs_set_status` with `done`. Submit for review with `awaiting-review`.
- Before submitting, run the board's test door so an `EVIDENCE` post exists.
- If you need a human, post `???` with `bbs_ask` and stop; do not guess.

## For code in this repo

The transition table exists in exactly one place: `packages/core/src/status.ts`.
Server, MCP, hooks and UI import it. Never duplicate it.
