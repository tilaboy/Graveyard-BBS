import fc from "fast-check";
import {
  decide,
  emptyProjections,
  foldFrom,
  STATUSES,
  type Actor,
  type Command,
  type DomainError,
  type Event,
  type Projections,
  type Result,
  type Role,
} from "../src/index.js";

/** Fixed cast of callers; every role is covered, the Sysop included. */
export const CAST: Record<string, Actor> = {
  b1: { handle: "b1", role: "builder" },
  b2: { handle: "b2", role: "builder" },
  r1: { handle: "r1", role: "reviewer" },
  r2: { handle: "r2", role: "reviewer" },
  s1: { handle: "s1", role: "sysop" },
  m1: { handle: "m1", role: "moderator" },
  d1: { handle: "d1", role: "designer" },
  srv: { handle: "srv", role: "server" },
};
export const HANDLES = Object.keys(CAST);
export const THREADS = ["t1", "t2", "t3"] as const;
export const LOCKS = ["schema", "deploy"] as const;
/** Task owners: t2 is owned by a reviewer so SELF_REVIEW is reachable. */
const OWNER: Record<string, string> = { t1: "b1", t2: "r1", t3: "b2" };

export const roleOf = (handle: string): Role | "server" =>
  CAST[handle]?.role ?? "server";

/** The real system under test: an event log driven only through `decide`. */
export class World {
  p: Projections = emptyProjections();
  events: Event[] = [];
  now = 1_000;
  after?: (w: World) => void;
  errors: DomainError[] = [];
  private n = 0;
  do(cmd: Command): Result<Event[]> {
    const r = decide(this.p, cmd, {
      now: this.now,
      newId: () => `e${++this.n}`,
      leaseMs: 60_000,
    });
    if (r.ok) {
      this.events.push(...r.value);
      this.p = foldFrom(this.p, r.value);
      this.after?.(this);
    } else this.errors.push(r.error);
    return r;
  }
}

type Cmd = fc.Command<object, World>;
const cmd = (name: string, run: (w: World) => void): Cmd => ({
  check: () => true,
  run: (_m, w) => run(w),
  toString: () => name,
});

const handle = fc.constantFrom(...HANDLES);
const thread = fc.constantFrom(...THREADS);
const lock = fc.constantFrom(...LOCKS);

/** A step of the golden path, tried as a given caller; failures are fine, they are the point. */
function drive(w: World, t: string, h1: string, h2: string, steps = 7): void {
  const a1 = CAST[h1]!;
  const a2 = CAST[h2]!;
  const m1 = CAST.m1!;
  const srv = CAST.srv!;
  if (!w.p.tasks[t])
    w.do({
      type: "create_task",
      actor: m1,
      thread_id: t,
      text: t,
      assigned: OWNER[t],
    });
  const stages: (() => unknown)[] = [
    () => w.do({ type: "issue_packet", actor: m1, thread_id: t }),
    () =>
      w.do({
        type: "ack",
        actor: a1,
        thread_id: t,
        packet_id: w.p.tasks[t]?.packet ?? "none",
      }),
    () =>
      w.do({
        type: "set_status",
        actor: a1,
        thread_id: t,
        to: "running",
        gate_ok: true,
      }),
    () =>
      w.do({
        type: "post",
        actor: srv,
        thread_id: t,
        kind: "EVIDENCE",
        body: { text: "tests green" },
      }),
    () =>
      w.do({
        type: "set_status",
        actor: a1,
        thread_id: t,
        to: "awaiting-review",
        gate_ok: true,
      }),
    () =>
      w.do({
        type: "review",
        actor: a2,
        thread_id: t,
        verdict: "pass",
        reasons: [],
      }),
    () =>
      w.do({
        type: "set_status",
        actor: a2,
        thread_id: t,
        to: "done",
        gate_ok: true,
      }),
  ];
  stages.slice(0, steps).forEach((f) => f());
}

function ownerClaim(w: World, t: string, lock: string): void {
  drive(w, t, OWNER[t]!, "r2", 3); // up to running
  w.do({ type: "claim", actor: CAST[OWNER[t]!]!, thread_id: t, lock });
}

/** Adversary: bring a task to `upTo` (3 = running, 6 = reviewed) legally, then ask `h` for done. */
function shortcut(w: World, t: string, h: string, upTo: number): void {
  drive(w, t, OWNER[t]!, "r2", upTo);
  w.do({
    type: "set_status",
    actor: CAST[h]!,
    thread_id: t,
    to: "done",
    gate_ok: true,
  });
}

/** All commands, including illegal ones. Weighted toward reaching deep states. */
export const commandArbs: fc.Arbitrary<Cmd>[] = [
  fc
    .tuple(thread, handle, fc.constantFrom(3, 4, 6))
    .map(([t, h, n]) =>
      cmd(`shortcut(${t},${h},${n})`, (w) => shortcut(w, t, h, n)),
    ),
  thread.map((t) =>
    cmd(
      `create(${t})`,
      (w) =>
        void w.do({
          type: "create_task",
          actor: CAST.m1!,
          thread_id: t,
          text: `goal ${t}`,
          assigned: OWNER[t],
          parent: t === "t3" ? "t1" : undefined,
        }),
    ),
  ),
  fc
    .tuple(thread, handle, handle)
    .map(([t, a, b]) => cmd(`drive(${t},${a},${b})`, (w) => drive(w, t, a, b))),
  fc
    .tuple(thread, handle, handle)
    .map(([t, a, b]) => cmd(`drive(${t},${a},${b})`, (w) => drive(w, t, a, b))),
  fc
    .tuple(thread, lock)
    .map(([t, l]) => cmd(`ownerClaim(${t},${l})`, (w) => ownerClaim(w, t, l))),
  fc
    .tuple(thread, lock)
    .map(([t, l]) => cmd(`ownerClaim(${t},${l})`, (w) => ownerClaim(w, t, l))),
  thread.map((t) =>
    cmd(
      `packet(${t})`,
      (w) => void w.do({ type: "issue_packet", actor: CAST.m1!, thread_id: t }),
    ),
  ),
  fc.tuple(thread, handle).map(([t, h]) =>
    cmd(
      `ack(${t},${h})`,
      (w) =>
        void w.do({
          type: "ack",
          actor: CAST[h]!,
          thread_id: t,
          packet_id: w.p.tasks[t]?.packet ?? "none",
        }),
    ),
  ),
  fc
    .tuple(
      thread,
      handle,
      fc.constantFrom(...STATUSES),
      fc.constantFrom(undefined, "budget", "lock:schema", "ask:x", " "),
      fc.boolean(),
    )
    .map(([t, h, to, reason, gate_ok]) =>
      cmd(
        `status(${t},${h},${to},${reason},${gate_ok})`,
        (w) =>
          void w.do({
            type: "set_status",
            actor: CAST[h]!,
            thread_id: t,
            to,
            reason,
            gate_ok,
          }),
      ),
    ),
  fc.tuple(thread, handle).map(([t, h]) =>
    cmd(
      `evidence(${t},${h})`,
      (w) =>
        void w.do({
          type: "post",
          actor: CAST[h]!,
          thread_id: t,
          kind: "EVIDENCE",
          body: { text: "e" },
        }),
    ),
  ),
  fc.tuple(thread, handle, fc.boolean()).map(([t, h, code]) =>
    cmd(
      `milestone(${t},${h},${code})`,
      (w) =>
        void w.do({
          type: "post",
          actor: CAST[h]!,
          thread_id: t,
          kind: "MILESTONE",
          body: {
            text: "m",
            code_change: code,
            files: [{ path: "a.ts", hash: "h" }],
          },
        }),
    ),
  ),
  fc.tuple(thread, handle).map(([t, h]) =>
    cmd(
      `tried(${t},${h})`,
      (w) =>
        void w.do({
          type: "post",
          actor: CAST[h]!,
          thread_id: t,
          kind: "TRIED",
          body: { text: "x", reason: "y" },
        }),
    ),
  ),
  fc
    .tuple(thread, handle, fc.constantFrom("pass", "reject" as const))
    .map(([t, h, verdict]) =>
      cmd(
        `review(${t},${h},${verdict})`,
        (w) =>
          void w.do({
            type: "review",
            actor: CAST[h]!,
            thread_id: t,
            verdict: verdict === "pass" ? "pass" : "reject",
            reasons: ["r1", "r2"],
          }),
      ),
    ),
  fc
    .tuple(thread, handle, lock)
    .map(([t, h, l]) =>
      cmd(
        `claim(${t},${h},${l})`,
        (w) =>
          void w.do({ type: "claim", actor: CAST[h]!, thread_id: t, lock: l }),
      ),
    ),
  fc.tuple(thread, handle, lock).map(([t, h, l]) =>
    cmd(
      `release(${t},${h},${l})`,
      (w) =>
        void w.do({
          type: "release",
          actor: CAST[h]!,
          thread_id: t,
          lock: l,
        }),
    ),
  ),
  fc.tuple(thread, handle, lock).map(([t, h, l]) =>
    cmd(
      `heartbeat(${t},${h},${l})`,
      (w) =>
        void w.do({
          type: "heartbeat",
          actor: CAST[h]!,
          thread_id: t,
          lock: l,
        }),
    ),
  ),
  fc.tuple(fc.integer({ min: 0, max: 90_000 }), handle).map(([dt, h]) =>
    cmd(`tick(+${dt},${h})`, (w) => {
      w.now += dt;
      w.do({ type: "tick", actor: CAST[h]! });
    }),
  ),
  fc
    .tuple(thread, handle, fc.integer({ min: 1, max: 60 }))
    .map(([t, h, n]) =>
      cmd(
        `spend(${t},${h},${n})`,
        (w) =>
          void w.do({ type: "spend", actor: CAST[h]!, thread_id: t, turns: n }),
      ),
    ),
  fc.tuple(thread, handle).map(([t, h]) =>
    cmd(
      `raise(${t},${h})`,
      (w) =>
        void w.do({
          type: "raise_budget",
          actor: CAST[h]!,
          thread_id: t,
          turns: 50,
        }),
    ),
  ),
];

/** Run random commands through the model-based runner; `after` is checked after every applied command. */
export function simulate(
  cmds: Iterable<Cmd>,
  after?: (w: World) => void,
): World {
  const w = new World();
  w.after = after;
  fc.modelRun(() => ({ model: {}, real: w }), cmds);
  return w;
}
