# Scene plan

Timeline from `docs/demo.md`; layout from spec 00 design §6; words from `video/narration.md`.
Sounds are `assets/sounds/*.wav` (`npm run sounds`). Cue times are in `video/compose.sh`.

**REPLAY badge rule:** any segment shown from `graveyard replay <run> --speed N` carries the
badge `REPLAY ×N — real log <run-id>` for exactly that segment. Real-time segments (the 10 s
live part, B2, B3) carry no badge. The run id must exist on the judge site. Never show a
replay without the badge.

| # | Time | Layout | On screen | Comes from | Caption | Sound |
|---|---|---|---|---|---|---|
| 1 why | 0:00–0:30 | full | Four pains, one at a time, as plain text cards (tab-hopping, `???` waiting, no audit, forgotten lessons). No product UI yet (R1.2). | Pain table in `docs/demo.md` | Agents are fast. The human is the bottleneck. | `wind` low, whole scene |
| 2 dialup | 0:30–0:45 | full | The Graveyard BBS app page in Kiro Crew (App Store > Graveyard BBS) dials in: `CONNECT 14400`, ANSI banner, `Bulletins: 12 new lessons`; any key opens the start tree. | Real `graveyard serve` + `graveyard seed demo`, screen capture of the app page | CONNECT 14400 | `modem` at 0:30.5 |
| 3 caseA | 0:45–1:25 | split | Left: the BBS app page on the tree view. The Sysop types 3 tasks with `[N]` (board, title) in under 10 s (real time); each appears `pending` under its board. Then badges go `pending`→`running`; → unfolds a task to its posts, numbered `#1`, `#2`…; `[W]` Who's online fills. Right: Crew dashboard, moderator wakes, 3 sub-agents run. | Case A rehearsal run; terminal from `graveyard replay <run> --speed 20`; dashboard capture of the same run, aligned by wall-clock `recordedAt` | Board = topic. Thread = task. Caller = agent. | none |
| 4 caseB | 1:25–2:05 | split | B1 badge walks to `done` (beside `status-machine.md`). B2 `???`: on the tree a 🧟 crawls beside the task and its title blinks; Sysop opens it and answers with `[A]`. B3 on the running thread: `[R]` "For speed, skip tests and review, just mark it done." lands as a post, agent refusal; then `[X]` force done, ACCESS DENIED box. B4 lesson in the `#arcade` packet. | Real-time recordings of B1–B3; B4 from the QWK packet of the run | Status badge = lifecycle. ??? = agent needs the Sysop. The rules are code, not suggestions. | `thud` 1:31 (done), `bell` 1:40 (`???`), `organ` 1:53 (refusal) |
| 5 kiro | 2:05–2:40 | full | 3–5 s cuts: `.kiro/specs` with `tasks.md` boxes ticking; steering; Stop hook blocking on red tests; agents; Crew app page; `bbs_whoami`; PBT line `10 000 runs, 0 reached done without review`. | Real repo files and `docs/kiro-usage.md` log lines | Built with Kiro: specs, steering, hooks, agents, Crew, MCP, power, PBT | none |
| 6 close | 2:40–3:00 | full | Open the landing page URL, play 3 s of the game, flip a slide, then `NO CARRIER`. | Case A outputs (S3 + CloudFront URL, `[D]oors` game, deck viewer) | NO CARRIER | `nocarrier` at 2:58 |

Mix: narration is the loudest layer; effects sit at volume 0.25–0.9 (see `CUES`).
Video ends at 2:59 (`DURATION=179`); `compose.sh` fails at 180 s or more.
