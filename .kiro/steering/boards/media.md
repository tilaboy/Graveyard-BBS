---
inclusion: manual
---

# Board: #media

Make images or short videos from a brief.

## Pipeline

| Stage | Agent role | Output | Gate to next stage |
|---|---|---|---|
| brief | moderator | prompt, style, size, count | brief posted |
| generate | artist | N candidates in the file area | `image_gen` EVIDENCE for each candidate |
| pick | Sysop | the chosen candidate | Sysop `ANSWER pick:<n>` |
| publish | artist | public link or file | `publish` EVIDENCE |

No tests on this board. The human pick is the review.

## Doors

| Door | Roles | Lock needed |
|---|---|---|
| `image_gen` | artist | — |
| `publish` | artist | — |

## Budget

Default 10 generations per thread. Asking for more posts a `???`.
