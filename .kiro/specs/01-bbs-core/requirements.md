# Requirements — 01 BBS core (`packages/core`)

Pure domain logic: events, status machine, locks, budgets, fold, QWK packets.
No I/O. Time and ids are injected.

## R1 Status machine

**User story:** As the Sysop, I want task status changes to follow fixed rules, so no agent
can finish work without review.

- R1.1 WHEN a command requests a transition listed in `status-machine.md` AND its
  preconditions hold THEN the system SHALL emit a `STATUS` event.
- R1.2 WHEN a command requests any other transition THEN the system SHALL reject it with
  error `ILLEGAL_TRANSITION` naming from, to and the missing precondition.
- R1.3 WHEN `running → awaiting-review` is requested AND no `EVIDENCE` event exists after the
  last code-change event of that task THEN the system SHALL reject with `NO_EVIDENCE`.
- R1.4 **[PBT]** For every sequence of commands, a task SHALL never reach `done` without
  having been `awaiting-review` immediately before.
- R1.5 WHEN the requester of `awaiting-review → done` is the task owner THEN the system SHALL
  reject with `SELF_REVIEW`.
- R1.6 WHEN a reviewer rejects THEN the system SHALL emit one `TRIED` event per reason.

## R2 Locks

**User story:** As a builder agent, I want to wait my turn for a shared resource, so I never
overwrite another agent's change.

- R2.1 WHEN a caller claims a free lock THEN the system SHALL grant it with a fencing token
  greater than every token issued before for that lock.
- R2.2 WHEN a caller claims a held lock THEN the system SHALL queue it and return its position.
- R2.3 WHEN the holder releases THEN the system SHALL grant the lock to the head of the queue.
- R2.4 WHEN `now > lease_expires_at` THEN the system SHALL free the lock, emit `SYSTEM
  lease-expired`, and return the holder's task to `pending`.
- R2.5 **[PBT]** At any point at most one caller SHALL hold a given lock.
- R2.6 **[PBT]** Fencing tokens for a lock SHALL strictly increase across grants.
- R2.7 WHEN a task waits for a lock THEN its status SHALL be `blocked` with reason `lock:<name>`.

## R3 Event log and fold

**User story:** As a judge, I want to replay a thread, so I can see exactly what happened.

- R3.1 The system SHALL represent all state as an append-only list of typed events.
- R3.2 **[PBT]** `fold(events)` SHALL be deterministic: equal input gives equal projections.
- R3.3 **[PBT]** `fold(a ++ b) == foldFrom(fold(a), b)` for every split.
- R3.4 Every event SHALL carry `id`, `seq`, `at`, `thread_id`, `caller`, `type`, `body`.

## R4 Budgets

- R4.1 Each thread SHALL have `turns_left`, `seconds_left` and optional `credits_left`.
- R4.2 WHEN any budget reaches 0 THEN the system SHALL set the task `blocked: budget` and emit
  an `ASK` to the Sysop.

## R5 QWK and REP packets

**User story:** As a newly spawned agent, I want a packet of what my predecessor did, so I do
not repeat failed work.

- R5.1 `buildQwk(threadId, projections)` SHALL return sections goal, summary, tried,
  artifacts, locks, constraints, next — in that order.
- R5.2 **[PBT]** A packet SHALL include every `TRIED` event of the thread and its ancestors.
- R5.3 A packet SHALL have an id; WHEN a caller has not posted `ACK <id>` for the latest packet
  THEN door commands from that caller SHALL be rejected with `NO_ACK`.
- R5.4 WHEN the packet exceeds the token limit THEN the builder SHALL shorten `summary` first
  and SHALL never drop `tried` entries.
- R5.5 `parseRep(text)` SHALL validate a REP packet and reject unknown evidence ids.

## R6 Roles

- R6.1 Roles: `sysop`, `moderator`, `designer`, `builder`, `reviewer`, `release`, `artist`.
- R6.2 WHEN a caller runs a door its role is not allowed on for that board THEN the system
  SHALL reject with `ROLE_DENIED`.
