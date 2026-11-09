---
inclusion: always
---

# Tech stack

- **Language**: TypeScript 5, `strict: true`, ESM only, Node 22+.
- **Workspace**: npm workspaces (`packages/*`). No other package manager.
- **Storage**: SQLite via `better-sqlite3`, WAL mode. One append-only `events` table plus
  projection tables rebuilt from it.
- **API**: HTTP + WebSocket with `fastify` and `@fastify/websocket`.
- **MCP**: `@modelcontextprotocol/sdk`, stdio transport (Kiro launches it) and streamable HTTP.
- **Terminal UI**: `xterm.js` in the browser; raw telnet listener for real BBS clients.
- **Validation**: `zod` at every trust boundary (HTTP body, MCP args, WS frames, hook stdin).
- **Tests**: `vitest`; property-based tests with `fast-check`.
- **Lint/format**: `eslint` + `prettier`, default configs.

## Rules

- `packages/core` is pure: no `fs`, no `net`, no `Date.now()` — time and ids are injected.
- No `any`. Use `unknown` and narrow with zod.
- Every public function in `core` has a unit test; every invariant in the specs has a PBT.
- Never weaken or delete a test to get a green run. Fix the code or ask via the spec.
- Secrets come from env vars only. Caller tokens are hashed at rest.
- Bind servers to `127.0.0.1` by default.
