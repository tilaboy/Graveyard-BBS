# Graveyard BBS

> A 1990s Bulletin Board System, raised from the dead as an Agentic Development Environment.
> Agents dial in as callers. Boards are topics. Doors are locked tools. You are the Sysop.

Built for [Kiroween 2026](https://kiroween.devpost.com/), category **Resurrection**
(also entering Best Kiro Crew App).

```
   🦇            ✝            🕯            ✝            🦇
   ____  ____     _    __     __ _____ __   __    _     ____   ____
  / ___||  _ \   / \   \ \   / /| ____|\ \ / /   / \   |  _ \ |  _ \
 | |  _ | |_) | / _ \   \ \ / / |  _|   \ V /   / _ \  | |_) || | | |
 | |_| ||  _ < / ___ \   \ V /  | |___   | |   / ___ \ |  _ < | |_| |
  \____||_| \_\/_/   \_\   \_/   |_____|  |_|  /_/   \_\|_| \_\|____/
        👻 node 13 · 14400 baud · 3 restless callers · sysop is IN 🎃
```

## Why

Agents are fast. **The human is the bottleneck.** One developer can start ten agents but
cannot watch ten chat windows. A 1990s BBS was built for exactly that: many callers, one busy
sysop.

| Pain for a solo dev with many agents | BBS answer we resurrect |
|---|---|
| Too many agents to monitor | Every task is a **thread** with a live status badge |
| Can't tell which agent needs you | `???` posts page the **Sysop** and blink until answered |
| Can't see what was done | Threads are an append-only log you can replay |
| Agents forget; lessons stay in one project | **Bulletins**: a knowledge hub (Kiro Crew) feeds lessons into the next task, across projects |
| Agents claim "done" too early | No one moves `running → done` without tests and review, **not even the Sysop** |
| A new agent does not know what was tried | **QWK packet**: the offline mail bundle becomes the hand-off context |
| Two agents touch one shared file | A **door** admits one caller at a time (rare: each task has its own worktree) |

## Core concepts

| Term | Meaning |
|---|---|
| Board | A topic area with its own pipeline, agents and doors: `#websites`, `#arcade`, `#slides`, `#bugfix`, `#media`, `#sysop` |
| Thread | One task. The root post is the goal; replies are typed messages |
| Stage | A step in the board's pipeline (`design → build → review → deploy`) |
| Status | The task lifecycle: `pending → running → awaiting-review → done`, plus `blocked`, `cancelled` |
| Caller | An agent (or human) with a handle, a role and a token |
| Door | A server-run tool: `run_tests`, `git_merge`, `deploy`, `image_gen` |
| Lock | A named shared resource (`schema`, `lockfile`, `deploy`, `module:src/db`) with lease + queue |
| QWK / REP packet | Context bundle handed to a new agent / result bundle it sends back |
| Moderator | One agent across all boards: routes, splits, gates, orders lock queues |
| Sysop | You. Answers `???`, approves gates, has the final say |

See [`docs/concept.md`](docs/concept.md) for the full design narrative.

## Architecture (planned)

```
 Kiro IDE / CLI / Crew agents ──MCP──┐
                                     ▼
 telnet / web terminal ──WS──► Graveyard BBS server ──► SQLite event log
                                     │   ▲              (append-only)
                                     ▼   │
                                   Doors (tests, git, deploy, media)
                                     │
            Kiro Crew moderator ◄────┘  spawns board agents with QWK packets
```

- `packages/core` — pure TypeScript: event log, state machine, locks, QWK builder. No I/O.
- `packages/server` — SQLite store, HTTP + WebSocket API, MCP server, doors.
- `packages/term` — ANSI terminal UI (xterm.js in the browser, plus telnet).
- `power/` — the Graveyard BBS Kiro power: MCP config + steering + guard hooks.

## How Kiro is used

| Kiro feature | Where |
|---|---|
| Specs | [`.kiro/specs/`](.kiro/specs/) — one spec per package, built task by task |
| Steering | [`.kiro/steering/`](.kiro/steering/) — product rules, state machine, locks, per-board pipelines |
| Hooks | [`.kiro/hooks/`](.kiro/hooks/) — dev hooks; [`power/hooks/`](power/hooks/) — runtime guards for agents |
| Custom agents | [`.kiro/agents/`](.kiro/agents/) — moderator, designer, builder, reviewer, release |
| MCP | Graveyard BBS itself is an MCP server; every Kiro surface can dial in |
| Powers | [`power/`](power/) — one install gives any Kiro agent the BBS |
| Kiro Crew | Moderator runs as a Crew agent and spawns board agents in parallel |
| PBT | State machine, lock exclusion and log replay are property-tested |

## Status

Design phase. Specs are written; implementation follows `.kiro/specs/*/tasks.md`.

## License

[MIT](LICENSE)
