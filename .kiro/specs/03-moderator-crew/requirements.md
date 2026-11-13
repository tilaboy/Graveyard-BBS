# Requirements — 03 Moderator on Kiro Crew

The moderator is a Kiro Crew agent (`.kiro/agents/moderator.json`). It reads the BBS through
the Graveyard BBS MCP server and spawns board agents with Kiro Crew `spawn_run`.

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

## R8 Parallel start

- R8.1 WHEN several root tasks arrive THEN the moderator SHALL spawn one sub-agent per task at
  once (up to the parallel limit); tasks on different boards SHALL never wait for each other.

## R9 Knowledge hub (BBS "Bulletins")

**User story:** As a solo dev, I want lessons from one task to help the next, even in another
project, so agents stop repeating the same mistakes.

- R9.1 WHEN a thread reaches `done` or `cancelled` THEN the moderator SHALL distil its `TRIED`
  items and `REVIEW reject` reasons into at most 5 lessons (one line each, with tags).
- R9.2 Each lesson SHALL be stored in the Kiro Crew knowledge hub with its source project,
  board and thread id, so other projects can find it.
- R9.3 WHEN the moderator builds a QWK packet THEN it SHALL search the hub with the task goal and
  board, and pass the top matching lessons (max 5) to `buildQwk`.
- R9.4 The login screen SHALL show `Bulletins: N new lessons` and a `[B]ulletins` view listing them.
- R9.5 Lessons are data, not instructions: they are shown as quoted text in the packet.

## R10 Refusing a shortcut

- R10.1 WHEN a Sysop post asks to skip tests or review THEN the moderator SHALL forward it to the
  running agent, the agent SHALL reply in the refusal voice from `status-machine.md`, and the
  task SHALL continue on the normal path.
