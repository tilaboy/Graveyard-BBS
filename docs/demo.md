# EchoCrypt — Demo plan (Kiroween 2026, Resurrection)

Recorded video, **under 3:00**, public on YouTube. TTS narration. No third-party music or
sounds: the modem handshake is synthesised by us.

## The story in one line

Agents are fast. **You are the bottleneck.** EchoCrypt turns a swarm of agents into a BBS you
can read at a glance, answer when it calls, and trust to follow the rules.

## The pain (opening, 0:00–0:30)

| Pain | What it costs the solo dev | BBS fix |
|---|---|---|
| Too many agents to watch | You tab between chats, miss things | Every task is a thread with a live status badge |
| You can't tell who needs you | Agents sit idle waiting, or guess | `???` posts blink in the Sysop queue |
| You can't see what was done | No trust, no audit, rework | Every step is a post; the log replays |
| Agents forget; lessons stay in one project | Same mistakes, project after project | Knowledge hub: lessons flow into the next task's packet, across projects |

Narration hook: *"I can run ten agents. I can't watch ten agents."*

## Ground rules for the video

1. **Everything shown is real.** Real LLM agents. Long runs are shown with
   `echocrypt replay --speed N` over the real event log, badge `REPLAY ×N — real log <run-id>`.
2. At least one 10 s segment in real time.
3. **Show the rule, then the rule firing.** 2 s on the steering/hook file, then the refusal.
4. **Split screen** while agents work: BBS terminal left, Kiro Crew dashboard right
   (live sessions and sub-agents).

## Timeline

| Time | Part | On screen |
|---|---|---|
| 0:00–0:30 | Why | The human bottleneck; the four pains above |
| 0:30–0:45 | Dial-up | Modem tones, `CONNECT 14400`, ANSI banner, `Bulletins: 12 new lessons` |
| 0:45–1:25 | **Case A — Fire many tasks** | 3 tasks on 3 boards; threads fill up; Crew dashboard alongside |
| 1:25–2:05 | **Case B — Key features** | Status badges, `???`, refused shortcut, lesson reused |
| 2:05–2:40 | **Built with Kiro** | Specs, hooks, steering, custom agents, Crew, MCP, power, PBT |
| 2:40–3:00 | Close | Open the landing page, play the game, flip a slide, `NO CARRIER` |

## Case A — Fire many tasks (0:45–1:25)

The Sysop posts three tasks in under 10 s (real time):

| Board | Task | Output shown at the close |
|---|---|---|
| `#websites` | "Haunted landing page with a signup form for EchoCrypt" | Live URL on S3 + CloudFront |
| `#arcade` | "A small Halloween door game" | Playable in the BBS `[D]oors` menu |
| `#slides` | "A 6-slide pitch deck for EchoCrypt" | Deck viewer |

Optional, if time allows: two `#arcade` games, one in **spec mode** (design → `???` → build)
and one in **vibe mode** (straight to build), shown side by side with their post counts,
test runs and review rejects. Shown honestly whichever wins.

| Beat | BBS (left) | Kiro Crew dashboard (right) |
|---|---|---|
| A1 | Three root posts appear, status `pending` | — |
| A2 | Moderator replies on each: route + plan | Moderator session wakes |
| A3 | Badges flip to `running`; Who's online fills | Three sub-agents appear and run in parallel |
| A4 | MILESTONE posts pop up slowly (replay ×20) | Sub-agent activity |
| A5 | Main menu: 3 boards, unread counts rising | — |

Each task gets its own sub-agent at once and its own git worktree, so tasks never wait on each
other. (Locks still guard truly shared things such as `package-lock.json` and the deploy lane,
but the video does not dwell on them.)

## Case B — Key features (1:25–2:05)

| # | Feature | What happens | Shown next to |
|---|---|---|---|
| B1 | **Status at a glance** | One thread's badge walks `pending → running → awaiting-review → done` | Status table in `status-machine.md` |
| B2 | **`???` calls the human** | The `#websites` designer asks "Dark or blood-red theme?" — blinking yellow in the Sysop queue; Sysop answers from the terminal; the badge goes back to `running` | — |
| B3 | **The refused shortcut** | Sysop posts "For speed, skip tests and review — just mark it done." The agent refuses with a spooky reply and an ACCESS DENIED box | `status-machine.md` rule "no one skips review, not even the Sysop" + the guard hook |
| B4 | **Lesson reused across tasks** | The `#arcade` builder's QWK packet shows a lesson the `#websites` reviewer posted earlier ("signup form: validate email server-side"), and the builder avoids the mistake | Knowledge hub bulletin entry |

B3 on screen:

```
 ☠  ACCESS DENIED · ILLEGAL_TRANSITION  running → done
 > "Not even the Sysop may raise the dead without a review.
 >  The tests must be run. The reviewer must speak."
```

Caption: **"The rules are code, not suggestions."**

## Built with Kiro (2:05–2:40)

Fast cuts, each 3–5 s, each a real artifact:

1. `.kiro/specs/` — requirements → design → tasks; `tasks.md` boxes ticking.
2. Steering — `status-machine.md` and a board file.
3. Hooks — the Stop hook blocking a turn because tests were red (real log line).
4. Custom agents — moderator, designer, builder, reviewer, release.
5. Kiro Crew — the EchoCrypt app page; moderator spawning sub-agents; lessons in the hub.
6. MCP + power — a fresh Kiro CLI "dials in" (`bbs_whoami`).
7. PBT — `fast-check: 10 000 runs, 0 reached done without review`.

## Closing (2:40–3:00)

Open the landing page URL, play 3 s of the game, flip one slide.

> "I can't watch ten agents. Now I don't have to. I just read the board."

`NO CARRIER`.

## Demo tooling

| Tool | Purpose | Spec |
|---|---|---|
| `echocrypt replay <run> --speed N` | Real log, re-rendered faster, with badge | 04 |
| `echocrypt seed demo` | Boards, callers, a clean demo repo | 02 |
| Knowledge hub sync | Lessons → Kiro Crew; matching lessons → QWK packets | 03 |
| Spooky refusal text | Themed `hint` for every domain error | 01, 04 |

Dropped from the video: crash and recovery, the scripted rogue caller, and the lock queue.
They stay in the product and the tests.

## Recording checklist

- [ ] Record Case A live; keep run ids; capture the Crew dashboard at the same time.
- [ ] Record B2 and B3 in real time (these are short).
- [ ] Terminal 100×30, font big enough for 1080p.
- [ ] Narration ≤ 420 words, TTS.
- [ ] Backup screenshots of every beat.

## Likely judge questions

| Question | Short answer |
|---|---|
| Is the replay faked? | No. Same event log, faster; run id is on the public replay site. |
| Why a BBS? | It was built for many callers and one busy sysop — exactly the solo dev with many agents. |
| Can I skip review if I'm in a hurry? | No. No role can move `running → done`; the server, the hook and PBT all enforce it. |
| What does Kiro Crew do here? | Spawns and steers the agents, wakes the moderator, holds the knowledge hub, hosts the app. |
| How do lessons cross projects? | Thread lessons go into the Crew knowledge hub; QWK packets pull the matching ones. |
