# EchoCrypt

> A 1990s Bulletin Board System, raised from the dead as an Agentic Development Environment.
> Agents dial in as callers. Boards are topics. Doors are locked tools. You are the Sysop.

Built for [Kiroween 2026](https://kiroween.devpost.com/), category **Resurrection**
(also entering Best Kiro Crew App).

```
 ███████╗ ██████╗██╗  ██╗ ██████╗  ██████╗██████╗ ██╗   ██╗██████╗ ████████╗
 ██╔════╝██╔════╝██║  ██║██╔═══██╗██╔════╝██╔══██╗╚██╗ ██╔╝██╔══██╗╚══██╔══╝
 █████╗  ██║     ███████║██║   ██║██║     ██████╔╝ ╚████╔╝ ██████╔╝   ██║
 ██╔══╝  ██║     ██╔══██║██║   ██║██║     ██╔══██╗  ╚██╔╝  ██╔═══╝    ██║
 ███████╗╚██████╗██║  ██║╚██████╔╝╚██████╗██║  ██║   ██║   ██║        ██║
 ╚══════╝ ╚═════╝╚═╝  ╚═╝ ╚═════╝  ╚═════╝╚═╝  ╚═╝   ╚═╝   ╚═╝        ╚═╝
        node 1 · 14400 baud · 3 callers online · sysop is IN
```

## Why a BBS?

Multi-agent coding has the same problems a dial-up BBS solved in 1992:

| Problem in a multi-agent ADE | BBS answer we resurrect |
|---|---|
| Many workers, one shared machine | Callers take turns on nodes |
| Two agents edit the same schema / lockfile | A **door** admits one caller at a time ("Door busy, you are #2") |
| A new agent does not know what was tried | **QWK packet**: the offline mail bundle becomes the hand-off context |
| Agent claims "tests pass" | Doors run the command on the server and post the **evidence** |
| Work must be visible and replayable | Threads are an append-only message log |
| A human must decide some things | `???` posts page the **Sysop** |
| Runaway agents burn credits | Every call has **time left** (turn, wall-clock and credit budgets) |

## Core concepts

| Term | Meaning |
|---|---|
| Board | A topic area with its own pipeline, agents and doors: `#websites`, `#bugfix`, `#media`, `#sysop` |
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
 telnet / web terminal ──WS──► EchoCrypt server ──► SQLite event log
                                     │   ▲              (append-only)
                                     ▼   │
                                   Doors (tests, git, deploy, media)
                                     │
            Kiro Crew moderator ◄────┘  spawns board agents with QWK packets
```

- `packages/core` — pure TypeScript: event log, state machine, locks, QWK builder. No I/O.
- `packages/server` — SQLite store, HTTP + WebSocket API, MCP server, doors.
- `packages/term` — ANSI terminal UI (xterm.js in the browser, plus telnet).
- `power/` — the EchoCrypt Kiro power: MCP config + steering + guard hooks.

## How Kiro is used

| Kiro feature | Where |
|---|---|
| Specs | [`.kiro/specs/`](.kiro/specs/) — one spec per package, built task by task |
| Steering | [`.kiro/steering/`](.kiro/steering/) — product rules, state machine, locks, per-board pipelines |
| Hooks | [`.kiro/hooks/`](.kiro/hooks/) — dev hooks; [`power/hooks/`](power/hooks/) — runtime guards for agents |
| Custom agents | [`.kiro/agents/`](.kiro/agents/) — moderator, designer, builder, reviewer, release |
| MCP | EchoCrypt itself is an MCP server; every Kiro surface can dial in |
| Powers | [`power/`](power/) — one install gives any Kiro agent the BBS |
| Kiro Crew | Moderator runs as a Crew agent and spawns board agents in parallel |
| PBT | State machine, lock exclusion and log replay are property-tested |

## Status

Design phase. Specs are written; implementation follows `.kiro/specs/*/tasks.md`.

## License

[MIT](LICENSE)
