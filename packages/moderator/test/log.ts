import { resolve } from "node:path";
import { EventSchema, type Event, type Status } from "@graveyard/core";
import { loadPipelines } from "../src/pipeline.js";
import type { Action, Opts } from "../src/planner.js";

export const BOARDS = resolve(
  import.meta.dirname,
  "../../../.kiro/steering/boards",
);
export const opts = (extra: Partial<Opts> = {}): Opts => ({
  pipelines: loadPipelines(BOARDS),
  project: "graveyard-bbs",
  ...extra,
});

/** A recorded event stream, built the way the server would write it. */
export class Log {
  events: Event[] = [];
  private known = new Set<string>();
  private add(type: string, thread: string, caller: string, body: unknown) {
    // The moderator opens stage threads as child TASKs before anything happens in them.
    if (type !== "TASK" && !this.known.has(thread)) {
      this.known.add(thread);
      this.add("TASK", thread, "moderator", {
        text: `stage ${thread}`,
        parent: thread.split("-").slice(0, 2).join("-"),
      });
    }
    this.known.add(thread);
    const seq = this.events.length + 1;
    this.events.push(
      EventSchema.parse({
        id: `e${seq}`,
        seq,
        at: 1_000 + seq,
        thread_id: thread,
        caller,
        type,
        body,
      }),
    );
    return this;
  }
  task(thread: string, text: string, caller = "sysop") {
    return this.add("TASK", thread, caller, { text });
  }
  status(thread: string, from: Status, to: Status, caller = "server") {
    return this.add("STATUS", thread, caller, { from, to });
  }
  post(
    type: "NOTE" | "ASK" | "ANSWER",
    thread: string,
    caller: string,
    text: string,
  ) {
    return this.add(
      type,
      thread,
      caller,
      type === "ANSWER" ? { text, ask_id: "a" } : { text },
    );
  }
  tried(thread: string, text: string, reason: string, caller = "reviewer-1") {
    return this.add("TRIED", thread, caller, { text, reason });
  }
  reject(thread: string, reasons: string[]) {
    this.add("REVIEW", thread, "reviewer-1", { verdict: "reject", reasons });
    for (const r of reasons) this.tried(thread, r, "review rejected");
    return this.status(thread, "awaiting-review", "running", "reviewer-1");
  }
  expired(thread: string) {
    return this.add("SYSTEM", thread, "server", {
      kind: "lease-expired",
      lock: "schema",
    });
  }
}

export const spawns = (a: Action[]) =>
  a.filter((x): x is Extract<Action, { type: "spawn" }> => x.type === "spawn");
export const of = <T extends Action["type"]>(a: Action[], t: T) =>
  a.filter((x): x is Extract<Action, { type: T }> => x.type === t);
