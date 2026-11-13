---
inclusion: always
---

# QWK and REP packets (hand-off context)

## When a packet is built

Every time the moderator spawns or respawns an agent for a stage task.
The packet is built from the event log by `packages/core/src/qwk.ts`. Never from memory.

## QWK packet sections (in this order)

1. `goal` — root post text and this stage's gate
2. `summary` — last 8 posts quoted, older posts summarised to at most 20 lines
3. `tried` — every `TRIED` item with its reason. **Do not repeat these approaches.**
4. `artifacts` — files in the thread's file area, with hashes
5. `locks` — locks this thread holds or is queued for
6. `constraints` — board rules, doors allowed, budget left
7. `next` — the parent's last stated next step

## Rules for an agent that receives a packet

- Post `ACK <packet-id>` first. Doors refuse callers that have not acked.
- Read `tried` before planning. If your plan matches an item, pick another or post `???`.
- Finish with `bbs_submit_rep`: what changed, evidence ids, new `TRIED` items, open questions.

## Rules for the moderator

- Rebuild the packet on each spawn; packets are cheap and the log may have moved.
- Keep a packet under 6 000 tokens. Summarise `summary` first, never drop `tried`.
