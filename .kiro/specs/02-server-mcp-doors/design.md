# Design — 02 Server, MCP and doors

```
            ┌──────────── packages/server ─────────────┐
 MCP stdio ─┤ mcp.ts ─┐                                │
 HTTP/WS  ──┤ api.ts ─┼─► commands.ts ─► core.decide ──┼─► store.ts (SQLite)
 CLI/hooks ─┤ cli.ts ─┘        ▲                       │        │
            │                  └── doors/*.ts ◄────────┼── worktrees/
            └──────────────────────────────────────────┘
```

- One `commands.ts` entry point; every surface goes through it, so rules are enforced once.
- `mcp.ts` uses `@modelcontextprotocol/sdk`. For stdio, Kiro spawns `graveyard mcp`, which
  proxies to the running server over HTTP with the caller's token. So many agents share one
  server and one log.
- Doors implement `{ name, roles, lock?, argsSchema, run(ctx) → { exitCode, log, sha, extra } }`.
- Worktrees: `git worktree add .graveyard/wt/<task-id> -b gy/<task-id>` on task start.
- Ticker: `setInterval(1000)` sends `tick(now)` to core for lease and budget expiry.

## Tables

```sql
CREATE TABLE events (seq INTEGER PRIMARY KEY, id TEXT UNIQUE, at INTEGER, thread_id TEXT,
                     caller TEXT, type TEXT, body TEXT);
CREATE TABLE callers (handle TEXT PRIMARY KEY, role TEXT, token_hash TEXT);
CREATE TABLE files (sha256 TEXT PRIMARY KEY, thread_id TEXT, name TEXT, path TEXT);
```

Projections live in memory (fold on start). Fine for hackathon scale.

## Config

`graveyard.config.json`: repo path, boards (from `.kiro/steering/boards/*.md` front tables
parsed into JSON at build time), port, lease seconds, default budgets.
