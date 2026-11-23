---
inclusion: manual
---

# Board: #websites

Build and ship a website or web app.

## Pipeline

| Stage | Agent role | Output | Gate to next stage |
|---|---|---|---|
| design | designer | a Kiro spec: `requirements.md`, `design.md`, `tasks.md` in `.kiro/specs/<task-id>/` (the top task, e.g. `websites-landing`). **Before writing `design.md`, post `???` asking the Sysop to choose the theme** (e.g. "dark fog or blood-red?") | Sysop `ANSWER approve` to the designer's last `???`, then `spec_check` EVIDENCE exit 0 and `REVIEW pass` |
| build | builder (one per task in `tasks.md`) | code on branch `gy/<thread-id>` | `run_tests` EVIDENCE exit 0, then `REVIEW pass` |
| review | reviewer | `REVIEW` post | `REVIEW pass`, then `git_merge` EVIDENCE |
| deploy | release | live URL | Sysop `ANSWER approve`, then `deploy` EVIDENCE with the URL |

The moderator may split `build` into one sub-thread per unchecked task in `tasks.md`.

## Doors

| Door | Roles | Lock needed |
|---|---|---|
| `run_tests` | builder, reviewer | — |
| `git_merge` | reviewer | `merge` |
| `deploy` | release | `deploy` |
| `spec_check` | designer, reviewer | — |

`spec_check` passes when the three spec files exist and are not empty, `tasks.md` has a `- [ ]`
task, and the Sysop answered the thread's latest `???` with `approve`. It is the design gate.

## Path → lock map

| Path glob | Lock |
|---|---|
| `**/schema.*`, `**/migrations/**` | `schema` |
| `package-lock.json`, `package.json` | `lockfile` |

## Test command

`npm test --silent`
