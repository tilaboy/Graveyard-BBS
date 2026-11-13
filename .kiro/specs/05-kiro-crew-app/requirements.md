# Requirements — 05 Kiro Crew app (`app/`)

Graveyard BBS as an installable Kiro Crew app (spec 00 R4). Field names come from the Kiro Crew
App Kit: [manifest-reference](https://github.com/kirodotdev/KiroCrew/blob/main/docs/app-kit/manifest-reference.md),
[getting-started](https://github.com/kirodotdev/KiroCrew/blob/main/docs/app-kit/getting-started.md),
[api-reference](https://github.com/kirodotdev/KiroCrew/blob/main/docs/app-kit/api-reference.md)
(backend env, proxy signature), and the local `docs/apps.md` (trust model).

## R1 Manifest

- R1.1 `app/app.json` SHALL declare the required fields `name` (`graveyard-bbs`), `version`,
  `displayName`, `description`, plus `author`, `license`, `iconPath`, `tags`, `highlights`.
- R1.2 `app/app.json` SHALL pass the Kiro Crew manifest validator (`AppManifest.validate(app_root)`)
  with no errors.
- R1.3 Every path the manifest references (`agents`, `iconPath`, `ui.entry`, `backend.entryPoint`,
  `mcpServers` launcher) SHALL exist inside `app/`.
- R1.4 `permissions` SHALL list only what is used: `api` for the launch route and `cron: true`
  (required by `crons`); no `network`, `spawn`, or `memory`.

## R2 Page

- R2.1 WHEN the app is enabled, the dashboard SHALL show one page `Graveyard BBS` at route
  `/apps/graveyard-bbs` (`ui.pages[]`, `ui.entry`).
- R2.2 The page SHALL ask the backend for the web terminal address and embed it (the same
  `packages/term` web client, live mode).
- R2.3 IF the backend cannot start the BBS, THEN the page SHALL show the backend's error text
  instead of an empty frame.

## R3 Backend

- R3.1 The app SHALL declare `backend` (`entryPoint`, `healthCheck: /health`, `routes`) whose
  process starts `graveyard serve --telnet-port 0` from the BBS checkout and stops it on exit.
- R3.2 `/health` SHALL answer an unsigned loopback GET with 200.
- R3.3 Every other route SHALL answer 401 unless `X-KiroCrew-Proxy-V2` verifies against
  `KIROCREW_PROXY_SECRET` (replay-proof v2), because `launch` returns a Sysop token.
- R3.4 `GET /api/apps/graveyard-bbs/launch` SHALL return `{ url, error }`; `url` is the
  `Web terminal:` address the server printed.

## R4 Agents

- R4.1 `agents` SHALL list the five board agents (moderator, designer, builder, reviewer, release).
- R4.2 `app/agents/*.json` and `app/steering/**` SHALL be generated from `.kiro/agents` and
  `.kiro/steering` by `npm run sync-app`; `npm run check-app` SHALL fail on drift.
- R4.3 Generated agents SHALL reference steering and launchers only through `{APP_ROOT}`.

## R5 MCP server

- R5.1 `mcpServers.graveyard` SHALL start the `graveyard mcp` stdio server through the app's own
  Python launcher (`bin/gy.py`), the one stdio shape the platform anchors to the app root.
- R5.2 The server env SHALL pass `GRAVEYARD_URL` and `GRAVEYARD_TOKEN`.

## R6 Moderator loop

- R6.1 `crons` SHALL hold one job `moderator-step`, `every: 30`, `agent: graveyard-moderator`.
- R6.2 The job SHALL ship `enabled: false` (paused): it costs a model turn per wake, so the owner
  resumes it from the Schedule page.

## R7 BBS checkout

- R7.1 The launcher SHALL find the BBS checkout in `GRAVEYARD_HOME`, else in the file
  `~/.graveyard-bbs-home`.
- R7.2 IF neither names a directory holding `packages/server/bin/graveyard.mjs`, THEN it SHALL
  exit with a message that says how to set it.

## R8 Standalone and trust

- R8.1 `npx --no-install graveyard serve` SHALL keep working with no app installed (nothing in `packages/**`
  depends on `app/`).
- R8.2 The README SHALL say the app is third-party code: enabling needs the owner's trust grant.
