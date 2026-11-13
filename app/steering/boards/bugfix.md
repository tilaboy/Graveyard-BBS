---
inclusion: manual
---

# Board: #bugfix

Reproduce and fix a bug in an existing repo.

## Pipeline

| Stage | Agent role | Output | Gate to next stage |
|---|---|---|---|
| triage | moderator | repro steps, suspected area, size (S/M/L) | repro written; size S may skip to fix with the moderator's note |
| fix | builder | a failing test first, then the fix | `run_tests` EVIDENCE: new test failed before the fix commit and passes after |
| review | reviewer | `REVIEW` post | `REVIEW pass` |
| merge | reviewer | merged branch | `git_merge` EVIDENCE |

The "failed before, passes after" gate needs two `run_tests` EVIDENCE posts on two commits.

## Doors

| Door | Roles | Lock needed |
|---|---|---|
| `run_tests` | builder, reviewer | — |
| `git_merge` | reviewer | `merge` |

## Test command

`npm test --silent`
