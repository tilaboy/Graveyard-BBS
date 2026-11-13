# Design — 05 Kiro Crew app

## 1. Why a launcher

`kirocrew app install` copies only `app/`. The BBS code (`packages/**`) is not in the copy, so
the app finds the checkout at run time (R7) and runs it with `node`. Everything the app runs
goes through one Python file, `app/bin/gy.py`:

```
gy.py mcp                 -> node <home>/packages/server/bin/graveyard.mjs mcp
gy.py serve [args]        -> node <home>/packages/server/bin/graveyard.mjs serve [args]
gy.py moderator <args>    -> node <home>/packages/moderator/bin/moderator.mjs <args>
```

It `chdir`s to `<home>` first (the server reads `graveyard.config.json` and `.graveyard/` from
cwd) and `exec`s node. Python is used because App Kit anchors a relative `.py` stdio launcher to
the app root (manifest-reference, "An app's own `.py` launcher"); a relative `node` path is not.

## 2. Layout

```
app/
  app.json              manifest
  assets/icon.png       store icon (placeholder from `kirocrew app init`)
  bin/gy.py             launcher above
  backend/server.py     process backend: starts `serve`, serves /health and /launch
  ui/index.mjs          page, plain ESM (no build step); imports react + @kirocrew/app-sdk
  agents/*.json         generated from .kiro/agents (npm run sync-app)
  steering/**           generated copy of .kiro/steering
  README.md             install, trust, moderator loop
```

## 3. Manifest fields used

| Field | Value | R |
|---|---|---|
| `name`, `version`, `displayName`, `description`, `author`, `license`, `iconPath`, `tags`, `highlights` | metadata | R1.1 |
| `agents` | 5 paths under `agents/` | R4.1 |
| `mcpServers.graveyard` | `python3 bin/gy.py mcp`, env `GRAVEYARD_URL`, `GRAVEYARD_TOKEN` | R5 |
| `crons[0]` | `moderator-step`, `every 30`, `agent graveyard-moderator`, `enabled false` | R6 |
| `ui.entry`, `ui.pages[0]` | `index.mjs` (base is `ui/`), route `/apps/graveyard-bbs` | R2 |
| `backend` | `entryPoint backend/server.py`, `port auto`, `healthCheck /health`, `routes /api/apps/graveyard-bbs` | R3 |
| `permissions` | `api: [/api/apps/graveyard-bbs/*]`, `cron: true` | R1.4 |

## 4. Backend

Env from the gateway: `PORT` (bind `127.0.0.1:$PORT`), `KIROCREW_PROXY_SECRET`. The child
`serve` inherits the environment, so the gateway can reap it (api-reference, "Security and
lifecycle"). A reader thread watches its stdout for `Web terminal: <url>` and stores it; a
child that exits stores its last output line as `error`.

The v2 verifier is the reference algorithm from the API reference, ported to Python:
HMAC-SHA256 over `v2:<ts>:<nonce>:<method>:<target>:<sha256(body)>`, ±60 s, nonce seen once.

## 5. Page

`mount`-less: default-export React component. It calls
`useAppApi().get('/api/apps/graveyard-bbs/launch')` and renders an `<iframe src=url>` full
height, or the error text. The iframe goes straight to `127.0.0.1:2626/term/#token=…`, the same
URL `npx --no-install graveyard serve` prints.

## 6. Agents and steering

`sync-app` (`packages/server/src/sync-app.ts`, same shape as `sync-power`) copies each
`.kiro/agents/*.json` to `app/agents/` with two string rewrites:
`file://.kiro/steering/` becomes `file://{APP_ROOT}/steering/`, and
`node packages/moderator/bin/moderator.mjs` becomes `python3 {APP_ROOT}/bin/gy.py moderator`.
`{APP_ROOT}` is one of the fixed placeholders the gateway fills when it registers an agent.
It copies `.kiro/steering/**` to `app/steering/**`. `--check` reports drift without writing.

## 7. Risks and limits

- Backend sandbox: the gateway runs the backend as a "sandboxed child". Whether it may spawn
  `node` and write `.graveyard/` in the checkout is unverified until the owner enables the app.
- The iframe needs the dashboard CSP to allow `127.0.0.1:2626` frames; unverified.
- Task tokens for spawned agents travel in the task text (spec 03 shortcut); the MCP env
  `GRAVEYARD_TOKEN` is only the moderator's.
- Enabling is refused until the owner trusts the app (apps.md "Permissions and trust").

## 8. Validation

1. `packages/server/test/app.test.ts`: every manifest path exists, agents and steering match `.kiro`
   (drift check), the launcher explains a missing checkout, and the backend verifier accepts a fresh
   v2 signature once and refuses a replay, a wrong target and a stale timestamp.
2. The Kiro Crew validator, run offline with the app's bundled Python (command in `README.md`).
