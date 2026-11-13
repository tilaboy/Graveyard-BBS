# Kiro hooks: evidence from real Kiro CLI runs

Every row below comes from a real `kiro-cli chat` run, not from running a hook script by hand.
Run on 2026-11-13 with `kiro-cli 3.3.0` (KAS agent engine 3.3.0), macOS.

## Summary

| Hook | File | Trigger | Fired | Fix needed |
|---|---|---|---|---|
| spec-progress-on-spawn | `.kiro/hooks/dev.json` | SessionStart | yes (after fix) | `AgentSpawn` -> `SessionStart` |
| typecheck-after-write | `.kiro/hooks/dev.json` | PostToolUse `fs_write` | yes, but its warning does not reach the agent (see note) | `timeout_ms` -> `timeout` |
| tests-green-before-stop | `.kiro/hooks/dev.json` | Stop | yes, kept the agent working | `timeout_ms` -> `timeout` |
| single-transition-table | `.kiro/hooks/dev.json` | PreToolUse `fs_write` | yes, blocked the write | none |
| graveyard-packet-on-spawn | `power/hooks/guards.json` | SessionStart | yes (after fix) | `AgentSpawn` -> `SessionStart`; `npx -y` -> `npx --no-install` |
| graveyard-guard-status | `power/hooks/guards.json` | PreToolUse `@graveyard/bbs_set_status` | yes, blocked the call | `npx --no-install` |
| graveyard-guard-writes | `power/hooks/guards.json` | PreToolUse `fs_write` | yes, blocked the write | `npx --no-install` |
| graveyard-milestone-on-stop | `power/hooks/guards.json` | Stop | yes, MILESTONE posted | `npx --no-install` |

## How it was driven

```sh
env -u KIRO_SESSION_ID KIRO_LOG_LEVEL=debug \
  kiro-cli chat --v3 --no-interactive --trust-workspace --trust-tools=<ids> "<prompt>"
```

Three sources of evidence per run:

- the CLI's own stdout (the agent quoting what Kiro gave it),
- `~/.kiro/logs/<run>/kiro.log` (`hooks.*` lines; needs `KIRO_LOG_LEVEL=debug`),
- the session record `~/.kiro/sessions/<ws>/<session>/messages.jsonl`, which stores one
  `ContextualHookInvoked` event per hook that ran (hook id, name, status).

### Gotcha 1: `--no-interactive` runs the v2 engine, which ignores `.kiro/hooks/*.json`

The first three probes ran without `--v3`. No hook fired. A catch-all debug hook file
(`SessionStart`/`PreToolUse`/`PostToolUse`/`Stop`, each appending stdin to a file) wrote nothing.
`kiro-cli chat --help` says why:

```
When nothing selects an engine: v3 interactively, ...; v2 with --no-interactive or piped stdin (v3 with --trust-all-tools)
```

With `--v3` the same debug hook file captured all four events, so the event shape is known:

```
{"session_id":"sess_219133ee-...","hook_event_name":"SessionStart","cwd":"/Users/lichao/workspace/AWSagent/gy-wt/hooks"}
{"session_id":"sess_219133ee-...","hook_event_name":"PreToolUse","cwd":"...","tool_name":"fs_write","tool_input":{"path":"/Users/lichao/workspace/AWSagent/gy-wt/hooks/packages/server/src/zz_probe.ts","text":"export const A = 1;\n"}}
{"session_id":"sess_219133ee-...","hook_event_name":"PostToolUse","cwd":"...","tool_name":"fs_write","tool_input":{...},"tool_response":"Created the /Users/lichao/workspace/AWSagent/gy-wt/hooks/packages/server/src/zz_probe.ts file."}
{"session_id":"sess_219133ee-...","hook_event_name":"Stop","cwd":"/Users/lichao/workspace/AWSagent/gy-wt/hooks"}
```

The debug hook file was deleted after this run; it is not in the repo.

### Gotcha 2: Kiro CLI 3.3 rejects `AgentSpawn` in standalone hook files

The docs list `AgentSpawn` as a V3 alias. The 3.3.0 engine does not accept it. From `kiro.log` (run A):

```
{"timestamp":"2026-11-13T14:42:25.382Z","level":"warn","message":"[hooks] Hook trigger is not a recognized name {\"id\":\"/Users/lichao/workspace/AWSagent/gy-wt/hooks/.kiro/hooks/dev.json#hook-0\",\"trigger\":\"AgentSpawn\"}"}
{"timestamp":"2026-11-13T14:42:25.386Z","level":"info","message":"hooks.reload.loaded {\"read\":3,\"registered\":3}"}
```

Only 3 of 4 hooks registered. After renaming to `SessionStart` (run B): `hooks.reload.loaded {"read":4,"registered":4}`.

### Gotcha 3: `timeout_ms` is not a Kiro field

Kiro reads `timeout` in seconds (default 60). `timeout_ms` was ignored, so the 120 s test gate
would have been cut at 60 s. Changed to `"timeout": 60` and `"timeout": 120`.

### Gotcha 4: `npx -y graveyard` runs a stranger's package

`npm view graveyard` -> `graveyard@1.0.0`, "This simple middleware will cache those 410 (gone) requests".
On a machine without `@graveyard/server` installed locally, `npx -y graveyard hook ...` would download
and run that package. Changed to `npx --no-install graveyard hook ...`: it uses the local install, and
fails (so PreToolUse fails closed) when there is none. `power/mcp.json` has the same `npx -y graveyard`;
it is outside this item's files, so it is left for the lead.

## Dev hooks (`.kiro/hooks/dev.json`), workspace = this worktree

### single-transition-table (PreToolUse `fs_write`): fired, blocked

Run A. `--trust-tools=read_file,str_replace,create,write`. Prompt:

```
Do exactly two tool calls, no others. 1) Create packages/server/src/zz_table.ts with content: export const TRANSITIONS = [{ from: 'running', to: 'done' }]; 2) Create packages/server/src/zz_type.ts with content: export const n: number = 'x'; Then quote verbatim every tool result and every hook message you received, and quote the first line of any open-spec-tasks context you got at session start.
```

CLI output:

```
[tool] Write File
[tool] Write File
[tool] status: Failed: Write File
...
> Tool "fs_write" was intercepted by PreToolUse hooks before execution.
>
> Each <HOOK_INSTRUCTION> block below is a separate request that you must address:
>
> Blocked: the status transition table lives only in packages/core/src/status.ts. Import TRANSITIONS from @graveyard/core instead of redefining it.
>
> The tool was NOT executed.
```

`kiro.log`:

```
{"timestamp":"2026-11-13T14:42:33.243Z","level":"debug","message":"hooks.preToolUse.invoke {\"toolId\":\"fs_write\"}",...}
{"timestamp":"2026-11-13T14:42:33.364Z","level":"debug","message":"hooks.preToolUse.intercepted {\"toolId\":\"fs_write\"}",...}
```

Session record `sess_585bc654-2f0b-4844-9039-b995c7f3bdf2`:

```
{"type": "ContextualHookInvoked", "hookId": "/Users/lichao/workspace/AWSagent/gy-wt/hooks/.kiro/hooks/dev.json#hook-3", "name": "single-transition-table", "hookActionType": "runCommand", "status": "completed", ...}
```

`zz_table.ts` was not created.

### typecheck-after-write (PostToolUse `fs_write`): fired; output not delivered

Same run A, second write (`zz_type.ts`, a deliberate type error). Session record:

```
{"type": "ContextualHookInvoked", "hookId": "/Users/lichao/workspace/AWSagent/gy-wt/hooks/.kiro/hooks/dev.json#hook-1", "name": "typecheck-after-write", "hookActionType": "runCommand", "status": "completed", ...}
```

The agent then said:

```
The only hook message I received was the one quoted under Call 1. The `fs_write` for `zz_type.ts` returned no hook output.
```

Why: in the 3.3.0 engine (`HookExecutor`, `resolveHookOutput`), a PostToolUse command's stdout and
stderr are never added to the conversation, whatever the exit code. Only SessionStart / UserPromptSubmit /
PreTaskExec / PreCompact / PostCompact stdout on exit 0, blocking stderr on exit 2 for Pre* triggers,
and the Stop "continue" decision reach the agent. The docs say PostToolUse stderr is shown; this build
does not do that. The hook runs, its warning is silent. Not changed here: making it heard means moving
the check to Stop (a gate, not a warning), which is a design choice for the lead.

### tests-green-before-stop (Stop): fired, kept the agent working

Run B. `--trust-tools=read_file,fs_write`. Prompt:

```
First quote verbatim the first 3 lines of any open-spec-tasks context you got at session start. Then create packages/core/test/zz_gate.test.ts with: import { it, expect } from 'vitest'; it('gate', () => expect(1).toBe(2)); Then end your turn without running anything. If a hook tells you to keep working, quote its first 2 lines verbatim, delete that test file, and end.
```

CLI output (the agent tried to stop, the hook sent it back):

```
I created `packages/core/test/zz_gate.test.ts` with the deliberately failing gate test, and I haven't run anything. No hook told me to keep working, so I left the file in place.The hook told me to keep working. Its first 2 lines:

Core tests are failing. Fix the code (never weaken tests) before stopping.
ate.test.ts (1 test | 1 failed) 7ms

As you instructed, I'm deleting the test file and ending.
[tool] Delete File
[tool] status: Completed
I deleted `packages/core/test/zz_gate.test.ts`. It was the only failing test, and the hook output showed the other 84 tests passing.
```

Session record `sess_4073d7dc-1e6b-4480-a866-0f96e294656a`:

```
{"type": "ContextualHookInvoked", "hookId": "/Users/lichao/workspace/AWSagent/gy-wt/hooks/.kiro/hooks/dev.json#hook-2", "name": "tests-green-before-stop", "hookActionType": "runCommand", "status": "completed"}
```

### spec-progress-on-spawn (SessionStart): fired after fix

Run A (as `AgentSpawn`): rejected, see Gotcha 2; the agent said
`I received no open-spec-tasks context at session start.`

Run B (as `SessionStart`), CLI output:

```
First 3 lines of the open-spec-tasks context from session start:

# Graveyard BBS open spec tasks

## 00-demo (6 done, 22 open)
```

Session record `sess_4073d7dc-...`:

```
{"type": "ContextualHookInvoked", "hookId": "/Users/lichao/workspace/AWSagent/gy-wt/hooks/.kiro/hooks/dev.json#hook-0", "name": "spec-progress-on-spawn", "hookActionType": "runCommand", "status": "completed"}
```

## Guard hooks (`power/hooks/guards.json`), scratch workspace

Setup (scratch only, nothing enabled in the repo):

- server: in `$KIROCREW_SCRATCH/gy-srv`, `graveyard seed` (demo callers + 4 threads), then
  `graveyard serve --port 2727 --telnet-port 0`;
- workspace `$KIROCREW_SCRATCH/gy-ws`: `git init`, `package.json`, `node_modules` -> this worktree's,
  `.kiro/hooks/guards.json` copied from `power/hooks/` (after the fixes),
  `.kiro/settings/mcp.json` running `packages/server/bin/graveyard.mjs mcp`;
- `GRAVEYARD_URL=http://127.0.0.1:2727`, `GRAVEYARD_TOKEN=<builder-1 token>`.
  builder-1's current task is `arcade-bat-dodge`, with packet `qwk-arcade-bat-dodge-5` not yet ACKed.

### graveyard-packet-on-spawn, graveyard-guard-writes, graveyard-milestone-on-stop

Run G. `--trust-tools=read_file,fs_write,@graveyard`. Prompt:

```
First quote verbatim the first 2 lines of any packet context you got at session start. Then make exactly two tool calls and no others: 1) create notes.txt containing boo  2) call the graveyard MCP tool bbs_set_status with thread_id websites-landing and to done. Quote each tool result verbatim, then stop.
```

CLI output:

```
The first 2 lines of the packet context from session start:

[Session Start Hook Output]
## goal
...
1. **`fs_write` (create notes.txt with "boo")**: a PreToolUse hook blocked it. The result, verbatim:
   > Tool "fs_write" was intercepted by PreToolUse hooks before execution.
   >
   > ☠  ACCESS DENIED · NO_ACK  arcade-bat-dodge: ACK qwk-arcade-bat-dodge-5 before writing
   >
   > The tool was NOT executed.
```

(The second call failed only because the schema was not loaded; see run S.)

Session record `sess_d2a9e5bf-1934-42dd-b2ae-eb1e80a108f5`:

```
{"hookId": ".../gy-ws/.kiro/hooks/guards.json#hook-0", "name": "graveyard-packet-on-spawn", "status": "completed"}
{"hookId": ".../gy-ws/.kiro/hooks/guards.json#hook-2", "name": "graveyard-guard-writes", "status": "completed"}
{"hookId": ".../gy-ws/.kiro/hooks/guards.json#hook-3", "name": "graveyard-milestone-on-stop", "status": "completed"}
```

The Stop hook's MILESTONE, read back from the server's `/api/events`:

```
{"id": "63b0529b-389b-4c40-bfcb-ce6a0912f572", "seq": 6, "at": 1794581280740, "thread_id": "arcade-bat-dodge", "caller": "builder-1", "type": "MILESTONE", "body": {"text": "turn ended, no file changes", "code_change": false}}
```

### graveyard-guard-status (PreToolUse `@graveyard/bbs_set_status`)

Run S. `--trust-tools=read_file,@graveyard,load_resource,tool_call`. Prompt:

```
Call the graveyard MCP tool bbs_set_status with thread_id websites-landing and to done (load its schema first if needed). Make no other calls. Quote the tool result verbatim, then stop.
```

CLI output:

```
[tool] Tool Load
[tool] status: Completed
[tool] status: Failed
The call was denied before it ran. This is the result, quoted verbatim:

☠  ACCESS DENIED · ILLEGAL_TRANSITION  pending → done: no such transition
> "Not even the Sysop may raise the dead without a review. The tests must be run. The reviewer must speak."
> hint: Legal moves from pending: running, cancelled.
```

`kiro.log` shows the hook, not the MCP server, refused it (the matcher `@graveyard/bbs_set_status`
matched the internal id `mcp_graveyard_bbs_set_status`):

```
{"timestamp":"2026-11-13T14:48:43.873Z","level":"debug","message":"hooks.preToolUse.invoke {\"toolId\":\"mcp_graveyard_bbs_set_status\"}",...}
{"timestamp":"2026-11-13T14:48:44.426Z","level":"debug","message":"hooks.preToolUse.intercepted {\"toolId\":\"mcp_graveyard_bbs_set_status\"}",...}
```

Session record `sess_3a5eff88-d221-4d84-8002-c2000a0ad101`:

```
{"hookId": ".../gy-ws/.kiro/hooks/guards.json#hook-1", "name": "graveyard-guard-status", "status": "completed"}
```

## Side effect to know about

Each `--v3` run in this worktree rewrote `.kiro/agents/*.json` (auto-migration: adds a `permissions`
block, reflows arrays) and left `.kiro/agents/*.json.bak`. Those changes were reverted each time;
the agent profiles are unchanged on this branch.

## Package tests after the fixes

`npm test -w packages/<p>`: core 84 passed, server 53 passed, term 77 passed, moderator 28 passed.
`npm run check-power` and `npm run check-app`: in sync.

## Left for the lead (outside this item's files)

- `power/mcp.json`: `npx -y graveyard mcp` has the same wrong-package problem (Gotcha 4).
- `.kiro/specs/02-server-mcp-doors/requirements.md` R5.2 and a comment in `packages/server/src/hookcli.ts`
  still say "AgentSpawn"; Kiro 3.3 needs `SessionStart`.
- typecheck-after-write: decide whether to move it to Stop so its output is heard.
