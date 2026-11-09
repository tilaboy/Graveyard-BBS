# Design — 03 Moderator on Kiro Crew

```
EchoCrypt server ──events──► moderator (Kiro Crew session, monitor loop)
      ▲                           │  spawn_run(task = QWK packet, crew = builder)
      │ MCP (bbs_* tools)         ▼
      └──────────── board agents (Kiro Crew subagents, own token + worktree)
```

- **Cursor**: the moderator stores the last processed `seq` with `bbs_post` of a `SYSTEM
  cursor` note, so a restarted moderator resumes from the log, not from memory.
- **Spawn env**: each child gets `ECHOCRYPT_TOKEN` and `ECHOCRYPT_TASK` via the task text and a
  one-time `bbs_register_child` call; the server binds the token to the task.
- **Runner adapter**: `Runner` interface with `KiroCrewRunner` (moderator spawns) and
  `KiroCliRunner` (`kiro-cli chat --no-interactive --agent <role>`) so EchoCrypt also works
  without Kiro Crew.
- **Determinism split**: the server decides what is legal; the moderator decides what is wise.
