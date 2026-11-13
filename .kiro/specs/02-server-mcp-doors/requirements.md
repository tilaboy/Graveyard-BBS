# Requirements — 02 Server, MCP and doors (`packages/server`)

## R1 Event store

- R1.1 The server SHALL persist events in SQLite (`events` table, WAL) and rebuild projections
  on start by folding the log.
- R1.2 Appends SHALL be atomic per command (all events of one `decide` or none).

## R2 Callers and auth

- R2.1 Each caller SHALL have a handle, a role and a token; tokens are stored hashed.
- R2.2 MCP and HTTP requests SHALL be authenticated with `GRAVEYARD_TOKEN`.
- R2.3 `graveyard caller add <handle> --role <role>` SHALL print a new token once.

## R3 MCP server ("dial in")

Every Kiro surface (IDE, CLI, Crew) connects through MCP. Tools:

| Tool | Purpose |
|---|---|
| `bbs_whoami` | handle, role, current task, budget left |
| `bbs_list_boards` | boards with open thread counts |
| `bbs_read_thread` | posts of a thread (paged), rendered as quoted data |
| `bbs_post` | `NOTE` or `MILESTONE` with optional file attachments |
| `bbs_ask` | `???` to the Sysop; blocks the task |
| `bbs_set_status` | request a status transition (rules from core) |
| `bbs_claim_lock` / `bbs_release_lock` / `bbs_heartbeat` | locks |
| `bbs_get_packet` / `bbs_ack_packet` / `bbs_submit_rep` | QWK / REP |
| `bbs_record_tried` | add a `TRIED` item |
| `door_run` | run a door by name with typed args |

- R3.1 Tool descriptions SHALL be generated from core so rules stay in one place.
- R3.2 Every error SHALL return the domain error code and its `hint`.
- R3.3 Post bodies returned to agents SHALL be wrapped as untrusted data
  (`<post from="handle">…</post>` with control characters stripped).

## R4 Doors

- R4.1 Doors SHALL run on the server inside the task's worktree, with a timeout.
- R4.2 Each door run SHALL append an `EVIDENCE` event: door, args, exit code, duration,
  commit SHA, sha256 of the full log, log stored in the file area.
- R4.3 `git_merge` and `deploy` SHALL verify the caller's fencing token for `merge` / `deploy`.
- R4.4 Doors for MVP: `run_tests`, `git_merge`, `deploy` (static site to a local folder or
  S3 bucket), `image_gen` (pluggable provider, stub for tests).

## R5 Hook support CLI

- R5.1 `graveyard hook pre-tool` SHALL read a Kiro hook event on stdin and exit 2 with a
  reason when: the call sets status `done` from a non-reviewer; a file write touches a path
  mapped to a lock the caller does not hold; the caller has not acked its packet.
- R5.2 `graveyard hook spawn` SHALL print the caller's current QWK packet (AgentSpawn context).
- R5.3 `graveyard hook stop` SHALL post a `MILESTONE` with `git diff --stat` and heartbeat.
- R5.4 WHEN the server is unreachable THEN `pre-tool` SHALL exit 2 (fail closed) for writes
  and status changes, and exit 0 for reads.

## R6 Live API

- R6.1 WebSocket feed of new events for the terminal UI.
- R6.2 Sysop endpoints: answer ASK, approve gate, cancel, reorder queue, steer a running agent.
