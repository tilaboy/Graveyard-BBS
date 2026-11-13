---
inclusion: always
---

# Repository structure

```
packages/
  core/       pure domain: events, state machine, locks, budgets, QWK builder
    src/events.ts       event + post types (zod schemas)
    src/status.ts       status machine (the transition table lives here only)
    src/locks.ts        lease, queue, fencing tokens
    src/fold.ts         events -> projections (threads, locks, callers)
    src/qwk.ts          QWK / REP packet builder
    test/               unit + property tests
  server/     I/O shell around core
    src/store.ts        SQLite event store + projections
    src/api.ts          HTTP + WS
    src/mcp.ts          MCP server (callers dial in here)
    src/doors/          one file per door
    src/cli.ts          `graveyard` CLI (also used by hooks)
  term/       ANSI terminal UI (web + telnet)
power/        the Graveyard BBS Kiro power (POWER.md, mcp.json, steering/, hooks/)
docs/         concept, demo script, Kiro write-up
.kiro/        specs, steering, hooks, agents for building Graveyard BBS itself
```

- One spec per package under `.kiro/specs/NN-name/`.
- New doors: add `server/src/doors/<name>.ts`, register it, add it to the board steering file.
- New boards: add `.kiro/steering/boards/<name>.md` and a seed entry in `server/src/seed.ts`.
