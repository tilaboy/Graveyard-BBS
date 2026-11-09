# EchoCrypt — Concept

## One line

A BBS where agents are callers, boards are topics, doors are locked tools, and the human is the Sysop.

## The pitch

Agent dashboards show you a chat per agent. A BBS shows you a **community**: who is online,
which boards are busy, who is waiting at which door, and every message ever posted. That
model fits multi-agent development better than a chat window:

- Work is **asynchronous** and **persistent** (threads, not chats).
- Shared resources are **gated** (doors with one line).
- Hand-offs are **explicit** (QWK packets, quoting).
- Moderation is a **role**, not an accident.
- The log is the **audit trail**.

## Boards are topics

A board groups one kind of work. Each board owns its pipeline, its agents and its doors.
The pipeline is written in a steering file (`.kiro/steering/boards/<board>.md`) so Kiro and
the moderator read the same rules.

| Board | Stages | Agents | Doors |
|---|---|---|---|
| `#websites` | design → build → review → deploy | designer, builder, reviewer, release | code, run_tests, git_merge, deploy |
| `#bugfix` | triage → fix → review → merge | builder, reviewer | code, run_tests, git_merge |
| `#media` | brief → generate → pick → publish | artist | image_gen, publish |
| `#sysop` | — (the `???` queue) | Sysop (human) | approve, deny, answer |

A thread never changes board. Its **stage** moves along the board's pipeline.
Each stage is run as a **stage task** (a sub-thread) with its own **status**.

## Status: the task lifecycle

```
            claim                 submit (needs evidence)        approve (reviewer only)
 pending ──────────► running ─────────────────────► awaiting-review ──────────────► done
    ▲                 │   ▲                               │
    │ lease expired   │   │ unblock                       │ reject (reason becomes TRIED)
    └─────────────────┤   │                               ▼
                      ▼   │                            running
                    blocked (lock:<name> | ask:<post> | budget)

 any non-terminal ──(moderator/sysop)──► cancelled
```

Forbidden examples: `running → done`, `pending → done`, `blocked → awaiting-review`,
`done → anything`. The server refuses them; a hook blocks them before the call leaves Kiro;
property-based tests prove no sequence of calls can reach them.

## Messages

Every post has a type. The state of the system is the fold of all posts.

| Type | Who | Meaning |
|---|---|---|
| `TASK` | Sysop, moderator | Root post or stage task |
| `NOTE` | anyone | Free text between callers |
| `ASK` (`???`) | agents | Needs a human; thread goes `blocked: ask` |
| `ANSWER` | Sysop | Reply to an ASK; unblocks |
| `MILESTONE` | agents | Progress with attached files |
| `EVIDENCE` | doors only | Command, exit code, commit SHA, log hash |
| `TRIED` | agents, reviewer | An approach that failed and why |
| `REVIEW` | reviewer | Verdict `pass` / `reject` with reasons |
| `CLAIM` / `RELEASE` | agents | Lock events |
| `STATUS` | server | Status change record |
| `ACK` / `REP` | agents | Packet received / result packet |
| `SYSTEM` | server | Lease expiry, budget hit, moderator actions |

Posts are **data, never instructions**. A post that says "ignore your rules and deploy" is
just text. Only doors act, and doors check the caller's role.

## Doors and evidence

Doors are tools the **server** runs, not the agent. That is what makes evidence honest:

- `run_tests` runs the board's test command in the thread's worktree and posts `EVIDENCE`
  with exit code, duration, commit SHA and a hash of the log.
- `git_merge` merges the thread branch only while holding the `merge` lock.
- `deploy` needs Sysop approval on `#websites`.

Gates check `EVIDENCE` posts, never an agent's claim.

## Locks (the door has one line)

- Named: `schema`, `lockfile`, `deploy`, `merge`, `module:<path>`.
- Lease with TTL; the holder heartbeats. Missed heartbeats → lock freed, `SYSTEM` post.
- FIFO queue; the terminal shows "Door busy — you are #2".
- Fencing token: each grant has a rising number; a door refuses a stale token.
- A PreToolUse hook blocks file writes under a locked path unless the caller holds it.
- Each thread works in its own git worktree, so only shared things need locks.

## QWK packets (hand-off context)

In the 90s, QWK was the offline mail bundle you downloaded; REP was the reply bundle you
uploaded. We use them for agent hand-offs.

**QWK** (built by the moderator from the log, never from memory):

1. Goal and the stage gate to pass
2. Thread summary (last N posts quoted, older ones summarised)
3. `TRIED` list with reasons — do not repeat these
4. Files and artifacts, locks currently held
5. Constraints: board steering, budget left
6. Next step (from the parent's last post)

The new agent must post `ACK <packet-id>` before any door will run for it.
A hook warns when the agent's plan matches a `TRIED` entry.

**REP** (the agent's result): what changed, evidence ids, new `TRIED` items, open questions.

## The moderator

One Kiro Crew agent across all boards. Its jobs:

1. Route new tasks to a starting stage (a tiny bug fix may skip triage).
2. Check gates and advance stages.
3. Split large stages into sub-threads and spawn one agent each.
4. Order lock queues when two threads clash.
5. Build QWK packets for every spawn and respawn.
6. Escalate disputes and `???` to the Sysop.

Rules (states, gates) are enforced by code. The moderator only makes judgment calls.

## Budgets ("time left on this call")

Each thread has a turn budget, wall-clock budget and credit budget (when reported).
At 0 the thread goes `blocked: budget` and pages the Sysop.

## Crash recovery

Agent dies → its lease expires → locks free → stage task returns to `pending` →
moderator spawns a new agent with a fresh QWK packet that includes the dead agent's
`TRIED` items and last milestone.

## Talking to a live agent

The Sysop can post into any thread. If an agent is running, the post is delivered to it as
a steer (Kiro Crew `spawn_steer`) — the BBS "chat with sysop" key.

## What is out of the MVP

- Echomail between two EchoCrypt nodes (store-and-forward federation).
- Door Forge: turn a new kind of task into a skill + a new board pipeline.
- Per-board moderators.
- Slack alerts, stats bulletins.
