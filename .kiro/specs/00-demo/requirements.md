# Requirements — 00 Demo and submission

The demo is the product's first user test: whatever it needs, the product must really do.
This spec drives what the other specs must deliver by the deadline. Plan: `docs/demo.md`.

## Decisions (from the Sysop)

| Topic | Decision |
|---|---|
| Category | Resurrection; bonus: Best Kiro Crew App, Best Demo, Blog, Social Blitz |
| Audience | **Solo developer running many agents** |
| Core pain | **The human is the bottleneck**: too many agents to monitor; who needs me; what was done; lessons lost between projects |
| Agents on camera | Real LLM agents |
| Demo tasks | Landing page with signup (`#websites`), small game (`#arcade`), pitch deck (`#slides`); optional spec-vs-vibe game pair |
| Deploy + public URL | AWS S3 + CloudFront |
| Narration | Text-to-speech |
| On camera | Browser terminal (xterm.js) + Kiro Crew dashboard, split screen |
| Kiro surfaces | Kiro IDE + Kiro CLI + Kiro Crew |
| Packaging | Kiro Crew app is the primary shell |
| Out of the video | Crash recovery, rogue caller, lock queue (kept in product + tests) |
| Judge access | Kiro Crew app install + public read-only replay site |

## R1 Video

- R1.1 The video SHALL be under 3:00 and public on YouTube.
- R1.2 The first 30 s SHALL state the problem (human bottleneck), the audience (solo dev with
  many agents) and why it matters, before any product screen.
- R1.3 WHEN a segment runs faster than real time THEN the screen SHALL show
  `REPLAY ×N — real log <run-id>`, and the run id SHALL exist on the public replay site.
- R1.4 The video SHALL contain at least one continuous real-time segment of 10 s or longer.
- R1.5 No third-party music, sounds or trademarks; modem audio synthesised; narration TTS.
- R1.6 Narration SHALL be at most 420 words.
- R1.7 The video SHALL include a "Built with Kiro" segment showing real specs, steering, hooks,
  custom agents, Kiro Crew, MCP/power and PBT output.

## R2 Case A — Fire many tasks

**User story:** As a solo dev, I want to fire several tasks and follow them all on one screen,
so I am not the bottleneck.

- R2.1 WHEN the Sysop posts tasks to `#websites`, `#arcade` and `#slides` THEN each SHALL appear
  as a thread with status `pending` within 1 s.
- R2.2 The moderator SHALL reply on each thread with a route and plan, and SHALL spawn one Kiro
  Crew sub-agent per task without waiting for the others.
- R2.3 Each task SHALL run in its own git worktree; unrelated tasks SHALL never block each other.
- R2.4 Agents SHALL post MILESTONE updates as they work, and the terminal SHALL show them live.
- R2.5 The Kiro Crew dashboard SHALL show the moderator and the sub-agents during the run.
- R2.6 Outputs SHALL be real: a public landing page URL with a working signup form, a game
  playable from the BBS `[D]oors` menu, and a slide deck viewable from `#slides`.
- R2.7 (Optional) WHEN two `#arcade` tasks run, one in spec mode and one in vibe mode, THEN the
  BBS SHALL show their post count, test runs and review rejects side by side.

## R3 Case B — Key features

- R3.1 **Status at a glance:** every thread SHALL show a status badge that updates live.
- R3.2 **`???`:** WHEN an agent calls `bbs_ask` THEN the post SHALL blink in the Sysop queue
  and the task SHALL be `blocked: ask` until the Sysop answers from the terminal.
- R3.3 **Refused shortcut:** WHEN any caller, including the Sysop, asks to move a task to `done`
  without an `awaiting-review` step, fresh EVIDENCE and a `REVIEW pass` from a reviewer THEN
  the server SHALL refuse with `ILLEGAL_TRANSITION`, the agent SHALL post a refusal in the
  Halloween voice, and the terminal SHALL show the ACCESS DENIED box.
- R3.4 **Lesson reused:** WHEN a lesson from one thread matches a later task THEN the later
  task's QWK packet SHALL show it under `lessons`, with its source thread and project.

## R4 Kiro Crew app

- R4.1 Graveyard BBS SHALL install with `kirocrew app install <repo>/app` and add a BBS page,
  the board agents, the `graveyard` MCP server and the moderator loop.
- R4.2 The app SHALL also run standalone (`npx graveyard serve`).

## R5 Judge access ("URL to your working app")

- R5.1 A public static site on S3 + CloudFront SHALL serve the browser terminal in read-only
  replay mode with the real event logs of the demo runs.
- R5.2 Judges SHALL be able to open boards, threads, packets, evidence and the produced
  landing page, game and deck, with no login and no LLM calls.
- R5.3 The README SHALL give a ≤ 5-step install for running it live with your own Kiro.

## R6 Kiro write-up

- R6.1 `docs/kiro-usage.md` SHALL be a running log with dated entries.
- R6.2 It SHALL cover IDE vs CLI vs Crew, custom agents, hooks, specs, steering, MCP, PBT and
  powers, and quote at least one real log line per hook and per PBT failure found.

## R7 Deadlines

- R7.1 Free credits requested before 2026-12-01 12:00 PT.
- R7.2 Submission sent by 2026-12-03 (deadline 2026-12-04 14:00 PT).
