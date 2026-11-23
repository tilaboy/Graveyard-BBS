import { fold, type Event, type Status } from "@graveyard/core";
import { execute, type Io, type SpawnAction } from "./execute.js";
import {
  closerOf,
  isSpecStage,
  selectLessons,
  type Action,
  type Opts,
  type State,
} from "./planner.js";

/**
 * A spawn the executor turned into a spawn_run crew call. It stays here until it is confirmed
 * (`moderator agent`, or the agent ACKs the packet it was sent), so a call the moderator agent
 * skipped or that failed is sent again on the next step instead of being lost.
 */
export interface PendingSpawn {
  thread: string;
  handle: string;
  role: string;
  resume: boolean;
  /** Packet id it carried; "" when queued by `respawn` and not sent yet. */
  packet: string;
  at: number;
  /** spawn_run calls emitted so far. */
  sent: number;
}
/** Keyed by handle: a designer and a reviewer can wait on one thread. */
export type Pending = Record<string, PendingSpawn>;

/** Re-emits after the first call; one more miss posts ??? and drops the entry. */
export const MAX_REEMITS = 3;
/** Wait this long after a send before sending again (an agent ACKs within ~1-2 min). */
export const RESEND_AFTER_MS = 5 * 60_000;
export const ROLES = [
  "designer",
  "builder",
  "reviewer",
  "release",
  "artist",
] as const;
const HANDLE = new RegExp(`^(${ROLES.join("|")})-`);

/** The agents file is keyed by handle. An older file was keyed by thread: map each to its stage owner. */
export function migrateAgents(
  raw: Record<string, string>,
  stages: State["stages"],
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(raw).map(([k, id]) => [
      HANDLE.test(k) ? k : (stages[k]?.handle ?? k),
      id,
    ]),
  );
}

export function track(
  pending: Pending,
  a: SpawnAction,
  packet: string,
  at: number,
): void {
  pending[a.handle] = {
    thread: a.thread,
    handle: a.handle,
    role: a.role,
    resume: a.resume,
    packet,
    at,
    sent: 1,
  };
}

/** The handle `agent <thread> <id>` means without --handle: the one spawn pending there, else the stage owner. */
export function ownerOf(
  thread: string,
  pending: Pending,
  stages: State["stages"],
): string {
  const waiting = Object.values(pending).filter((p) => p.thread === thread);
  if (waiting.length > 1)
    throw new Error(
      `${thread} has ${waiting.length} pending spawns; pass --handle (${waiting.map((p) => p.handle).join(", ")})`,
    );
  const h = waiting[0]?.handle ?? stages[thread]?.handle;
  if (!h) throw new Error(`no stage '${thread}'; pass --handle`);
  return h;
}

/** `respawn`: the role the thread waits on (awaiting-review -> reviewer, else the stage's role). */
export function respawnTarget(
  thread: string,
  rec: State["stages"][string],
  status: Status | undefined,
  role?: string,
): { role: string; handle: string } {
  const r = role ?? (status === "awaiting-review" ? "reviewer" : rec.role);
  if (r === "reviewer" && status === "awaiting-review")
    return { role: r, handle: closerOf(thread, rec.role) };
  return { role: r, handle: r === rec.role ? rec.handle : `${r}-${thread}` };
}

/**
 * One step: drop confirmed or finished entries, send the rest again (bbs_register_child rotates
 * the token, so a leaked one goes stale), and post one ??? for a handle past MAX_REEMITS.
 * Mutates `pending`.
 */
export async function resend(
  pending: Pending,
  state: State,
  log: readonly Event[],
  io: Io,
  o: Opts,
): Promise<string[]> {
  const p = fold(log);
  const actions: Action[] = [];
  const prev: Record<string, number> = {};
  for (const e of Object.values(pending)) {
    const rec = state.stages[e.thread];
    const st = p.tasks[e.thread]?.status;
    const acked = log.some(
      (x) =>
        x.type === "ACK" &&
        x.caller === e.handle &&
        x.body.packet_id === e.packet,
    );
    if (!rec || !st || st === "done" || st === "cancelled" || acked) {
      delete pending[e.handle];
      continue;
    }
    // A live agent takes a minute or two to ACK. Re-sending sooner would rotate its token
    // under it and start a duplicate, so wait RESEND_AFTER_MS since the last send.
    if (io.now() - e.at < RESEND_AFTER_MS) continue;
    if (e.sent > MAX_REEMITS) {
      delete pending[e.handle];
      actions.push({
        type: "escalate",
        thread: e.thread,
        text: `??? ${e.handle} never started: ${e.sent} spawn_run calls brought back no agent id. Sysop, check Kiro Crew spawn limits (spawn_list), then run gy.py moderator respawn ${e.thread} --role ${e.role}.`,
      });
      continue;
    }
    prev[e.handle] = e.sent;
    const goal = `${p.tasks[rec.root]?.text ?? ""} ${p.tasks[e.thread]?.text ?? ""}`;
    actions.push({
      type: "spawn",
      thread: e.thread,
      handle: e.handle,
      role: e.role,
      resume: e.resume,
      lessons: selectLessons(
        state.lessons,
        goal,
        e.thread.split("-")[0] ?? "",
        e.thread,
      ),
      ...(isSpecStage(o.pipelines, rec, e.thread) ? { spec: true } : {}),
    });
  }
  if (!actions.length) return [];
  const r = await execute(
    actions,
    { ...io, spawned: (a, packet) => track(pending, a, packet, io.now()) },
    o.project,
  );
  // Count the attempt even when the server refused it, so a refusal also ends in ???.
  for (const [h, n] of Object.entries(prev))
    if (pending[h]) pending[h].sent = n + 1;
  return r.errors;
}
