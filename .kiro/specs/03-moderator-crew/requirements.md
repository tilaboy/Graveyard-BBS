# Requirements — 03 Moderator on Kiro Crew

The moderator is a Kiro Crew agent (`.kiro/agents/moderator.json`). It reads the BBS through
the EchoCrypt MCP server and spawns board agents with Kiro Crew `spawn_run`.

## R1 Routing

- R1.1 WHEN a new `TASK` root post appears THEN the moderator SHALL pick its starting stage
  from the board pipeline and post a `NOTE` with the reason.

## R2 Gates and stages

- R2.1 WHEN a stage task reaches `done` AND the board gate holds THEN the moderator SHALL open
  the next stage task.
- R2.2 Gate checks SHALL be done by the server (`bbs_check_gate`); the moderator only acts on
  the result.

## R3 Split and spawn

- R3.1 WHEN a `build` stage has a `tasks.md` THEN the moderator SHALL open one sub-thread per
  unchecked top-level task, up to a parallel limit (default 3).
- R3.2 For each spawn the moderator SHALL call `bbs_get_packet` and pass the QWK packet as the
  spawned agent's task text, with `crew=<board role>`.
- R3.3 Each spawned agent SHALL get its own caller token and worktree.

## R4 Recovery

- R4.1 WHEN a `SYSTEM lease-expired` event appears THEN the moderator SHALL respawn the stage
  task with a fresh packet and post `NOTE respawned after crash`.
- R4.2 The moderator SHALL not respawn the same task more than 2 times without a Sysop `???`.

## R5 Conflicts

- R5.1 WHEN two threads queue on the same lock THEN the moderator MAY reorder the queue and
  SHALL post why.
- R5.2 WHEN reviewer and builder disagree twice on the same task THEN the moderator SHALL
  post `???` to the Sysop.

## R6 Steering a live agent

- R6.1 WHEN the Sysop posts into a thread whose agent is running THEN the moderator SHALL
  forward it with `spawn_steer`.

## R7 Loop

- R7.1 The moderator SHALL run as a Kiro Crew monitor loop that wakes on new events
  (or every 30 s) and processes only events since its last cursor.
