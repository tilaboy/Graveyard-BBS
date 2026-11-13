# How Kiro was used to build Graveyard BBS

A running log, newest last. Every claim quotes a real artifact (commit, log line, test output).
For the submission write-up, see the summary at the end (filled in during week 4).

## 2026-11-09 — Idea, scope and spec skeleton (Kiro Crew)

- Kiro Crew chat with the user turned the rough idea ("resurrect BBS as an ADE") into the
  concept, the board/thread/door model and the demo story.
- Steering written first: `product.md`, `tech.md`, `structure.md`, `status-machine.md`,
  `locks-and-doors.md`, `qwk-packets.md`, `posts-are-data.md`, `testing.md`, plus one file
  per board. Rules are stated once, in steering, and enforced in code.
- Specs `01`–`04` (requirements → design → tasks) and dev hooks in `.kiro/hooks/dev.json`.
- Custom agents in `.kiro/agents/`: moderator, designer, builder, reviewer, release.

## 2026-11-13 — Demo spec, theme, rename

- Spec `00-demo` added: the demo is treated as the product's first user test; its
  requirements created new tasks in specs 02, 03 and 04 (publish door, run export, replay).
- `.kiro/steering/theme.md`: one Halloween rule set ("spooky wrapper, plain facts") loaded by
  every agent.

## 2026-11-13 — Spec 01 core built by a Kiro Crew worker

- Kiro Crew team lead dispatched one worker session bound to a work-ledger item, seeded with
  the spec paths, file ownership, branch `feat/core` and one invariant to prove.
- Result: 12 tasks ticked, 84 tests, `tsc`/eslint/prettier clean. Lead re-ran the tests
  before accepting (84/84 pass) and fast-forwarded `main` to `b069570`.

### Property-based testing

PBTs (fast-check, model-based `fc.commands`): R1.4 1500 runs, R1.9 1500, P2 1000, P6 1000,
P3 500, P4 500, P5 300.

**Mutation proof** — the worker added a forbidden row to `TRANSITIONS` and confirmed the PBTs
catch it, then reverted:

- `running → done` allowed → R1.4 fails. Seed `-1501229395`, counterexample
  `[ownerClaim(t1,schema), drive(t1,d1,b1), evidence(t1,b1)]` →
  "t1 reached done from running: expected running to be awaiting-review".
- `sysop → done` allowed → R1.9 fails. Seed `-1141369605`, counterexample
  `[drive(t2,r1,r1), ownerClaim(t1,schema)]` → "t2 done without REVIEW pass by a non-owner".

**A real bug PBT found:** moving a task back to `pending` left its entries in lock queues
(a lock leak). Unit tests had not covered it; fixed with a regression test.

## 2026-11-13 — Hooks proven in real Kiro CLI runs

A Kiro Crew worker drove `kiro-cli chat --v3 --no-interactive` with tiny prompts built to trip
each hook. Evidence is in `docs/hooks-evidence.md`: CLI output, `kiro.log` `hooks.*` lines and
the session's `ContextualHookInvoked` records.

| Hook | Fired? | Evidence (verbatim) |
|---|---|---|
| `single-transition-table` (PreToolUse) | yes, blocked | `Blocked: the status transition table lives only in packages/core/src/status.ts.` |
| `tests-green-before-stop` (Stop) | yes, kept the agent working | `Core tests are failing. Fix the code (never weaken tests) before stopping.` |
| `spec-progress-on-spawn` (SessionStart) | yes, after fix | `# Graveyard BBS open spec tasks` / `## 00-demo (6 done, 22 open)` |
| `typecheck-after-write` (PostToolUse) | runs, but its output never reaches the agent in 3.3 | `ContextualHookInvoked … "typecheck-after-write" … "completed"` |
| `graveyard-guard-status` (PreToolUse MCP) | yes, blocked | `☠  ACCESS DENIED · ILLEGAL_TRANSITION  pending → done` |
| `graveyard-guard-writes` (PreToolUse) | yes, blocked | `☠  ACCESS DENIED · NO_ACK  arcade-bat-dodge: ACK qwk-arcade-bat-dodge-5 before writing` |
| `graveyard-packet-on-spawn` (SessionStart) | yes | `[Session Start Hook Output]` / `## goal` |
| `graveyard-milestone-on-stop` (Stop) | yes | MILESTONE `"turn ended, no file changes"` posted to the BBS |

What running them for real taught us (none of it shows up when you run a script by hand):

1. `--no-interactive` picks the v2 engine, which ignores `.kiro/hooks/*.json`. `--v3` is needed.
2. Kiro CLI 3.3 rejects `AgentSpawn` in standalone hook files (`Hook trigger is not a
   recognized name`); `SessionStart` works.
3. The field is `timeout` (seconds), not `timeout_ms`; the 120 s test gate was being cut at 60 s.
4. `npx -y graveyard` would have downloaded an unrelated npm package named `graveyard`.
   All calls now use `npx --no-install`, so the hook fails closed without a local install.

