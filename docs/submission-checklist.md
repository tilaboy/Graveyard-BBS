# Kiroween 2026 — submission checklist for EchoCrypt

Deadline: **Friday 2026-12-04, 14:00 PT** (= 22:00 UTC). Internal target: submit 2026-12-03.
Credits request deadline: 2026-12-01 12:00 PT.

Category: **Resurrection**. Bonus prizes: Best Kiro Crew App, Best Demo, Bonus Blog, Social Blitz.

## Hard requirements

| # | Requirement | Status | Action |
|---|---|---|---|
| 1 | Project started on/after 2026-10-30 | OK — first commit 2026-11-07 | — |
| 2 | Public GitHub repo | OK — github.com/tilaboy/EchoCrypt is public | Push local commits |
| 3 | OSI license detected in the About box | Pending — MIT `LICENSE` is local only | Push, then confirm GitHub shows "MIT" |
| 4 | `/.kiro` at repo root, not in `.gitignore` | OK locally | Keep a CI check that `.kiro/` is tracked |
| 5 | All source, assets and run instructions | Pending | README "Quick start" that works on a clean machine |
| 6 | **URL to a working app** | **Gap** | Public read-only BBS (live replay of real runs) + local install guide; judge login in the private Devpost field |
| 7 | Text description | Pending | Draft from `docs/concept.md` |
| 8 | Demo video < 3:00, YouTube public, working on its device | Planned — `docs/demo.md` | Include one real-time (not sped-up) moment |
| 9 | No third-party trademarks / music | Planned — synthesised modem audio | Check fonts and ANSI art licences |
| 10 | Kiro write-up | **Gap** | Keep `docs/kiro-usage.md` as a running log from today |

## Bonus prize requirements

| Prize | Requirement | Plan |
|---|---|---|
| Best Kiro Crew App | Repo URL of a **Kiro Crew app** + feature description | Ship EchoCrypt as a Kiro Crew app (`app.json`): BBS page, moderator/builder/reviewer agents, `echocrypt` MCP server, moderator tick cron. See App Kit docs. |
| Best Demo | none | Covered by `docs/demo.md` |
| Bonus Blog | Public post during the period, says it is for Kiroween 2026 | Dev.to build log, week 3 |
| Social Blitz | Post starting with `#KiroweenHackathon26`, favourite thing about Kiro | One post after Case C works |

## Judging criteria → where we score

| Criterion | Our evidence | Risk | Fix |
|---|---|---|---|
| Potential Impact | Real multi-agent pains: lock clashes, lost hand-off context, fake "done" | Looks like a toy | **Dogfood**: build a later EchoCrypt feature *through* EchoCrypt and show it in the video |
| Technological Implementation | Specs, steering, hooks, custom agents, MCP, power, PBT, Kiro Crew | Claims without proof | Write-up quotes real hook firings and PBT failures with log lines |
| Design | ANSI terminal, live updates, sysop flow | Feels like a proof of concept | Polished onboarding: one command → BBS with demo boards |
| Innovation | BBS concepts mapped one-to-one onto ADE problems | Seance Relay Chat (IRC + AI) | Lead with doors/locks, QWK packets, rule enforcement — none of which it has |
| Presentation | 3 cases, rule-then-rule-firing | Too dense | Voice-over ≤ 400 words, one idea per scene |

## Minimum viable submission (cut lines)

Expect to finish less than planned. Each tier must be demoable on its own.

| Tier | Contents | Demo it supports |
|---|---|---|
| T1 must | core (status machine, locks, log, QWK) + PBT, MCP server, terminal UI, `#bugfix` board, rogue caller | Cases B and C |
| T2 should | moderator on Kiro Crew, parallel builders, `#websites` with spec design stage, deploy door | Case A |
| T3 could | Kiro Crew app packaging, public replay site, power install | Bonus prizes, working-app URL |
| T4 stretch | `#media`, Door Forge, echomail | Mention as future work |

T3's public replay site is what satisfies requirement 6, so schedule a minimal version of it early, not last.

## Ambiguities to settle

| Rule | Second reading | Our answer |
|---|---|---|
| "URL to your working app" | A local developer tool has no URL | Hosted read-only BBS + install steps; ask in Discord to confirm |
| "Show the project working on the device it was built for" | Sped-up replay might look fake | Badge + run id on screen, plus one real-time segment |
| "Kiro Crew app" | Any app using Kiro Crew vs an App Store app | Package as a real Kiro Crew app to cover both |
| "uses Kiro" | Kiro must be used to *build* it vs used *inside* it | We do both; the write-up separates them |

## Schedule (weeks from 2026-11-09)

| Week | Goal |
|---|---|
| 1 (Nov 9–15) | Push; T1 core + PBT; ask the Discord about the working-app URL |
| 2 (Nov 16–22) | T1 server, MCP, terminal, `#bugfix`, rogue → record Cases B and C |
| 3 (Nov 23–29) | T2 moderator + `#websites` → record Case A; blog post |
| 4 (Nov 30–Dec 3) | T3 app packaging + public replay; video, write-up, submit |
