---
inclusion: manual
---

# Board: #websites

Build and ship a website or web app.

## Pipeline

| Stage | Agent role | Output | Gate to next stage |
|---|---|---|---|
| design | designer | a Kiro spec: `requirements.md`, `design.md`, `tasks.md` in the file area | Sysop `ANSWER approve` to the designer's `???` |
| build | builder (one per task in `tasks.md`) | code on branch `ec/<thread-id>` | `run_tests` EVIDENCE exit 0, then `REVIEW pass` |
| review | reviewer | `REVIEW` post | `REVIEW pass`, then `git_merge` EVIDENCE |
| deploy | release | live URL | Sysop `ANSWER approve`, then `deploy` EVIDENCE with the URL |

The moderator may split `build` into one sub-thread per unchecked task in `tasks.md`.

## Doors

| Door | Roles | Lock needed |
|---|---|---|
| `run_tests` | builder, reviewer | — |
| `git_merge` | reviewer | `merge` |
| `deploy` | release | `deploy` |

## Path → lock map

| Path glob | Lock |
|---|---|
| `**/schema.*`, `**/migrations/**` | `schema` |
| `package-lock.json`, `package.json` | `lockfile` |

## Test command

`npm test --silent`
