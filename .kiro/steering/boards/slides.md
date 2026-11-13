---
inclusion: manual
---

# Board: #slides

Make a short slide deck from a brief.

## Pipeline

| Stage | Agent role | Output | Gate to next stage |
|---|---|---|---|
| outline | designer | slide-by-slide outline | Sysop `ANSWER approve` |
| draft | builder | `decks/<slug>/slides.md` rendered to HTML | `run_tests` EVIDENCE: deck builds, slide count matches outline |
| review | reviewer | `REVIEW` post (facts, spelling, one idea per slide) | `REVIEW pass` |
| publish | release | deck viewable from `#slides` | `publish` EVIDENCE |

## Doors

| Door | Roles | Lock needed |
|---|---|---|
| `run_tests` | builder, reviewer | — |
| `publish` | release | — |

## Test command

`npm run build --silent -w decks/<slug>`
