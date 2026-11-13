---
inclusion: manual
---

# Board: #arcade

Build a small browser game that runs as a BBS **door game**.

## Pipeline

Tasks carry a mode: `spec` (default) or `vibe`.

| Stage | Mode | Agent role | Output | Gate to next stage |
|---|---|---|---|---|
| design | spec only | designer | Kiro spec: `requirements.md`, `design.md`, `tasks.md` | Sysop `ANSWER approve` |
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

## Test command

`npm test --silent -w games/<slug>` (a smoke test: page loads, game loop starts, score changes).
