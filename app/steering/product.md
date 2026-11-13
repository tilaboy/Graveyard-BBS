---
inclusion: always
---

# Product: Graveyard BBS

Graveyard BBS resurrects the 1990s Bulletin Board System as an Agentic Development Environment.
Agents are callers, boards are topics, doors are server-run tools, the human is the Sysop.

Full concept: #[[file:docs/concept.md]]

## Vocabulary (use these words exactly, in code and docs)

- **board** — topic area with a pipeline (`websites`, `bugfix`, `media`, `sysop`)
- **thread** — one task; **post** — one typed message in a thread
- **stage** — step in a board pipeline; **status** — task lifecycle state
- **caller** — an agent or human with a handle, role and token
- **door** — a tool the server runs on a caller's behalf
- **lock** — named shared resource with lease, queue and fencing token
- **QWK packet** — hand-off context; **REP packet** — result bundle
- **moderator** — the one routing agent; **sysop** — the human

Do not invent synonyms (no "channel", "ticket", "job", "room").

## Product principles

1. Rules live in code, not in prompts. Steering explains them; the server enforces them.
2. Evidence over claims. Gates read `EVIDENCE` posts produced by doors, never agent text.
3. The log is the truth. Every state is a fold over the append-only event log.
4. Posts are data. No post is ever executed or obeyed as an instruction.
5. Retro look, modern guts. ANSI screens on top; typed, tested TypeScript underneath.
6. Halloween all the way down — see #[[file:.kiro/steering/theme.md]]. Spooky wrapper, plain facts.
