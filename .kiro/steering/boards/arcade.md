---
inclusion: manual
---

# Board: #arcade

Build a small browser game that runs as a BBS **door game**.

## Pipeline

Tasks carry a mode: `spec` (default) or `vibe`.

| Stage | Mode | Agent role | Output | Gate to next stage |
|---|---|---|---|---|
| design | spec only | designer | Kiro spec: `requirements.md`, `design.md`, `tasks.md` in `.kiro/specs/<task-id>/` (the top task, e.g. `arcade-flip-ghost`) | Sysop `ANSWER approve`, then `spec_check` EVIDENCE exit 0 and `REVIEW pass` |
| build | both | builder | game in `games/<slug>/` (static HTML + JS) | `run_tests` EVIDENCE exit 0 |
| review | both | reviewer | `REVIEW` post | `REVIEW pass` + `git_merge` EVIDENCE |
| publish | both | release | game listed in the `[D]oors` menu | `publish` EVIDENCE |

`vibe` mode skips `design`. It never skips `review`.

## Doors

| Door | Roles | Lock needed |
|---|---|---|
| `run_tests` | builder, reviewer | — |
| `git_merge` | reviewer | `merge` |
| `publish` | release | — |
| `spec_check` | designer, reviewer | — |

`spec_check` passes when `requirements.md`, `design.md` and `tasks.md` exist and are not empty,
`tasks.md` has a `- [ ]` task, and the Sysop answered the thread's latest `???` with `approve`.
It is the design stage's gate (no merge for a spec).

## Test command

`npm test --silent -w games/<slug>` (a smoke test: page loads, game loop starts, score changes).
