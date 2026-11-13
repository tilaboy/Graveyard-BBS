import { randomUUID } from "node:crypto";
import {
  decide,
  emptyProjections,
  fail,
  foldFrom,
  ok,
  renderAccessDenied,
  Emitter,
  type Actor,
  type Command,
  type Ctx,
  type DomainError,
  type ErrorCode,
  type Event,
  type Projections,
  type Result,
} from "@graveyard/core";
import { z } from "zod";
import { boardOf, type Board } from "./boards.js";
import type { Config } from "./config.js";
import type { Store } from "./store.js";

export const SERVER: Actor = { handle: "server", role: "server" };

/** Domain errors plus the few server-only ones. */
export type ToolError = Omit<DomainError, "code"> & {
  code: ErrorCode | "BAD_ARGS" | "UNAUTHENTICATED" | "DOOR_FAILED";
};
export const toolFail = (
  code: ToolError["code"],
  message: string,
  hint: string,
): { ok: false; error: ToolError } => ({
  ok: false,
  error: { code, message, hint, voice: "The spirits did not understand." },
});

/** What a door writes into an EVIDENCE post (plain data, never themed). */
export const EvidenceSchema = z.object({
  door: z.string(),
  args: z.unknown(),
  exit_code: z.number(),
  duration_ms: z.number(),
  commit: z.string().nullable(),
  log_sha256: z.string(),
  extra: z.record(z.string(), z.unknown()).default({}),
});
export type Evidence = z.infer<typeof EvidenceSchema>;

/** R1 + design: the single entry point. MCP, HTTP, CLI and doors all go through here, so rules are enforced once. */
export class Service {
  p: Projections;
  private readonly listeners = new Set<(e: Event) => void>();

  constructor(
    readonly store: Store,
    readonly config: Config,
    readonly boards: Record<string, Board>,
    private readonly clock: () => number = Date.now,
    private readonly newId: () => string = randomUUID,
  ) {
    // R1.1: rebuild projections by folding the log.
    this.p = foldFrom(emptyProjections(), store.events());
  }

  ctx(): Ctx {
    return {
      now: this.clock(),
      newId: this.newId,
      leaseMs: this.config.leaseSeconds * 1000,
    };
  }

  onEvent(fn: (e: Event) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private commit(events: Event[]): void {
    if (events.length === 0) return;
    this.store.append(events);
    this.p = foldFrom(this.p, events);
    for (const e of events) for (const l of this.listeners) l(e);
  }

  /** Dry run: what would this command do? Nothing is appended (hooks use this). */
  check(cmd: Command): Result<Event[]> {
    return decide(this.p, cmd, this.ctx());
  }

  exec(cmd: Command): Result<Event[]> {
    const r = decide(this.p, cmd, this.ctx());
    if (r.ok) {
      this.commit(r.value);
      return r;
    }
    // status-machine.md: every refusal is posted back to the thread in the Halloween voice.
    if ("thread_id" in cmd && this.p.tasks[cmd.thread_id]) {
      const note = decide(
        this.p,
        {
          type: "post",
          actor: SERVER,
          thread_id: cmd.thread_id,
          kind: "NOTE",
          body: { text: renderAccessDenied(r.error) },
        },
        this.ctx(),
      );
      if (note.ok) this.commit(note.value);
    }
    return r;
  }

  /** For events core has no command for (REP, queue reorder, chaos). Same atomic append path. */
  raw<T>(fn: (em: Emitter) => Result<T>): Result<T> {
    const em = new Emitter(this.p, this.ctx());
    const r = fn(em);
    if (r.ok) this.commit(em.events);
    return r;
  }

  tick(): void {
    this.exec({ type: "tick", actor: SERVER });
  }

  /** Board gate for `awaiting-review -> done`: the latest run of every door is green, and a merge board has merged. */
  gateOk(threadId: string): boolean {
    const t = this.p.tasks[threadId];
    if (!t) return false;
    const latest = new Map<string, number>();
    for (const post of t.posts) {
      if (post.type !== "EVIDENCE") continue;
      const ev = parseEvidence(post.text);
      if (ev) latest.set(ev.door, ev.exit_code);
    }
    if (latest.size === 0) return false;
    const mergeBoard = this.boards[boardOf(threadId)]?.doors["git_merge"];
    if (mergeBoard && latest.get("git_merge") !== 0) return false;
    return [...latest.values()].every((c) => c === 0);
  }

  /** The caller's current (non-terminal) task, newest first. */
  currentTask(handle: string) {
    return Object.values(this.p.tasks)
      .filter(
        (t) =>
          t.owner === handle && t.status !== "done" && t.status !== "cancelled",
      )
      .at(-1);
  }

  /** R4.2: a door result becomes an EVIDENCE post written by the server. */
  postEvidence(threadId: string, ev: Evidence): Result<Event[]> {
    return this.exec({
      type: "post",
      actor: SERVER,
      thread_id: threadId,
      kind: "EVIDENCE",
      body: { text: JSON.stringify(ev) },
    });
  }
}

export function parseEvidence(text: string): Evidence | undefined {
  try {
    const r = EvidenceSchema.safeParse(JSON.parse(text));
    return r.success ? r.data : undefined;
  } catch {
    return undefined;
  }
}

export { ok, fail };
