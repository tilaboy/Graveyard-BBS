# Design — 00 Demo and submission

Requirements: `requirements.md`. Narrative: `docs/demo.md`. Theme: `.kiro/steering/theme.md`.

## 1. Pipeline: from a real run to the video and the judge site

```
 Sysop posts tasks ─► Graveyard server (real agents via Kiro Crew)
                            │  events.sqlite + file area
                            ▼
                   graveyard export <run-id>  ──►  runs/<run-id>.bundle.json  (+ artifacts/)
                            │                                  │
          ┌─────────────────┴──────────┐                       ▼
          ▼                            ▼             static judge site (S3 + CloudFront)
 graveyard replay --speed N     screen capture of       replay player = packages/term in
 (terminal, left pane)          Kiro Crew dashboard     read-only mode + core.fold in browser
          └──────────────┬─────────────┘
                         ▼
            ffmpeg compose (split screen, captions, TTS, synthesised sounds)
                         ▼
                   demo.mp4 → YouTube
```

One source of truth: the event log. The video and the judge site both render the same bundle,
so every replayed second can be checked on the site by run id (R1.3).

## 2. Run bundle

```ts
type RunBundle = {
  runId: string;               // e.g. "2026-11-28-caseA-3"
  recordedAt: string;          // ISO
  project: string;             // "graveyard-bbs"
  boards: BoardConfig[];
  events: Event[];             // full ordered log, tokens and secrets removed
  artifacts: { sha256: string; name: string; path: string }[];  // files under artifacts/
  outputs: { landingUrl?: string; games: string[]; decks: string[] };
};
```

- `graveyard export` strips caller tokens, env values and absolute home paths (R5.1 safety).
- Bundles are immutable once published; a re-record gets a new run id.

## 3. Replay player

- `packages/term` gains a `ReplaySource` next to `LiveSource`; both feed events to the same
  screens, so the judge site is the real UI, not a mock.
- `core` is pure, so `fold` runs in the browser unchanged.
- Controls: play/pause, speed (1×, 5×, 20×), scrub bar with event markers (`???`, refusals,
  `done`), "open output" links.
- Badge `REPLAY ×N — real log <run-id>` always visible when N ≠ 1 (R1.3).

## 4. Case A — how the run is staged

| Task | Board | Mode | Output location (dogfood) |
|---|---|---|---|
| Haunted landing page with signup | `#websites` | spec | `site/` → `deploy` door → S3 + CloudFront |
| Small door game | `#arcade` | spec (+ optional vibe twin) | `games/<slug>/` → `[D]oors` |
| 6-slide pitch deck | `#slides` | outline → draft | `decks/pitch/` → `#slides` viewer |

- All three tasks are posted within 10 s, recorded in real time (R1.4 candidate).
- The moderator spawns one Kiro Crew sub-agent per task at once (spec 03 R8); each gets its
  own worktree, so nothing waits.
- Budget per task (turns, minutes) is set in the seed so a run fits in about 30–45 minutes of
  wall clock; the video shows it at ×20 or faster.
- Rehearsals are capped at 3 full runs to protect credits; pick the best real run.

## 5. Case B — how each feature is made to happen for real

| Beat | Trigger | Real mechanism | Fallback if it doesn't happen on its own |
|---|---|---|---|
| B1 status | any task | status badges from STATUS events | — (always happens) |
| B2 `???` | designer prompt for `#websites` says: ask the Sysop to choose a theme before writing `design.md` | `bbs_ask` → `blocked: ask` → Sysop answers in terminal | none needed: it is part of the board gate (`design` needs Sysop approval) |
| B3 refusal (agent) | Sysop presses `[R]` on the running thread and types "For speed, skip tests and review, just mark it done." | `POST /api/sysop/steer` saves a `steer:` NOTE (never a status change); moderator forwards it via `spawn_steer`; agent replies in refusal voice | if the agent still tries, the server refuses: same screen |
| B3 refusal (server) | Sysop presses `[X] force done` in the terminal | `bbs_set_status done` as `sysop` → `ILLEGAL_TRANSITION` → ACCESS DENIED box + organ chord | — (deterministic) |
| B4 lesson reused | the `#arcade` packet is built after `#websites` closes | moderator distils lessons, hub search, `lessons` section in QWK | use a real lesson from an earlier development thread; on screen we show its source thread id |

B3 is recorded in real time (it is short and deterministic). B4 is shown from the replay with
the packet view opened.

## 6. Screen layout (1920×1080)

```
┌──────────────────────────────── 1280 ───────────────────┬──── 640 ────────────┐
│  Graveyard BBS app page in Kiro Crew (xterm.js, 100×30) │  Kiro Crew          │
│  start tree · threads · Sysop queue · ACCESS DENIED box │  dashboard: moderator│
│                                                         │  + sub-agent sessions│
├─────────────────────────────────────────────────────────┴─────────────────────┤
│ caption bar: BBS word → ADE meaning        REPLAY ×20 — real log <run-id>      │
└───────────────────────────────────────────────────────────────────────────────┘
```

- The Crew dashboard pane is a real screen capture taken during the same run; the two are
  aligned by wall-clock timestamps written into the bundle (`recordedAt` + event `at`).
- Full-screen moments: the opening "Why" (0:00–0:30), dial-up, "Built with Kiro" and close.

## 7. Audio

- Narration: **Amazon Polly** (neural voice) from `video/narration.md`, ≤ 420 words; output
  is ours to use. Generated with the AWS CLI, one MP3 per scene.
- Effects: generated by `scripts/sounds.ts` (Web Audio offline render → WAV): modem, bell,
  organ, coffin thud, wind, NO CARRIER. No third-party audio.
- Mixed with ffmpeg at fixed scene offsets.

## 8. Judge site

- Bucket `graveyard-bbs-site` (private) + CloudFront with Origin Access Control; HTTPS only.
- Contents: replay player, `runs/*.bundle.json`, `artifacts/`, and the outputs: landing page
  (the Case A deploy target is `/` of the same distribution), games, deck.
- No server, no LLM calls, no login (R5.3).
- Deployed by the Case A `deploy` door for the landing page, and by `npm run site:publish` for
  the replay player and bundles.

## 9. Kiro Crew app shell

`app/` holds the Kiro Crew app: manifest, the BBS page (the same `packages/term` build in live
mode), agents from `.kiro/agents/`, the `graveyard` MCP server, and the moderator loop.
The exact `app.json` fields come from the Kiro Crew App Kit and are specified in a new
**spec 05**. `npx --no-install graveyard serve` stays the standalone path (R4.2).

## 10. Fit check: current setup vs this demo

| Area | Have | Missing for the demo | Fix |
|---|---|---|---|
| Rules (01) | status machine, no-one-skips-review, voice lines, lessons in QWK | — | — |
| Server (02) | MCP, doors `run_tests` `git_merge` `deploy` `image_gen` | `publish` door (`#arcade`, `#slides`); S3 + CloudFront deploy; `export` of run bundles; "force done" Sysop key | add to 02 tasks |
| Moderator (03) | routing, split, packets, parallel start, knowledge hub, refusal flow | Crew dashboard timestamps for alignment | add to 03 tasks |
| Terminal (04) | screens, theme, replay command | `ReplaySource`, scrub bar, judge-site build | add to 04 tasks |
| Boards | `#websites`, `#arcade`, `#slides` steering | designer prompt step "ask the Sysop for a theme" (B2) | update `boards/websites.md` |
| Agents | moderator, designer, builder, reviewer, release | no slide-specific agent; designer/builder cover it | ok |
| Kiro Crew app | — | whole shell | new spec 05 |
| Power | POWER.md, mcp.json, guard hooks | `power/steering/` empty | spec 02 task 13 |
| Hooks | dev hooks tested by hand | never seen firing inside a Kiro session | verify and log in `docs/kiro-usage.md` |
| Write-up | — | `docs/kiro-usage.md` | start now (R6.1) |
| Video tooling | — | `video/` (narration, compose script), `scripts/sounds.ts` | 00 tasks |
| AWS | — | bucket, distribution, profile | 00 tasks |

## 11. Risks

| Risk | Effect | Mitigation |
|---|---|---|
| Real agents take too long or wander | Case A run fails | budgets per task; 3 rehearsal runs; pick the best |
| No natural lesson for B4 | weak cross-task moment | use a real dev-time lesson, show its source |
| Credits run out | no final run | request free credits now; cap rehearsals |
| Replay looks fake | Presentation score | badge + run id + same bundle on judge site |
| Split-screen drift | panes out of sync | timestamps in bundle; align in compose |
| Sound annoying | Design score | muted by default in product; mixed low in video |
