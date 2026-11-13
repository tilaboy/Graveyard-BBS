import { expect } from "vitest";
import type { Event } from "../src/index.js";
import { roleOf, type World } from "./sim.js";

/**
 * R1.4 + R1.7 + R1.9 on the raw log: every `done` was preceded by awaiting-review, by a
 * REVIEW pass of a reviewer who is not the owner, posted after the last submission, and
 * `done` itself was set by a reviewer (never the Sysop).
 */
export function expectNoUnreviewedDone(events: readonly Event[]): void {
  const status = new Map<string, string>();
  const owner = new Map<string, string | undefined>();
  const submittedAt = new Map<string, number>();
  const passes = new Map<string, { seq: number; by: string }[]>();
  for (const e of events) {
    if (e.type === "TASK") {
      status.set(e.thread_id, "pending");
      owner.set(e.thread_id, e.body.assigned);
    }
    if (e.type === "REVIEW") {
      expect(roleOf(e.caller), `REVIEW by ${e.caller}`).toBe("reviewer");
      if (e.body.verdict === "pass")
        passes.set(e.thread_id, [
          ...(passes.get(e.thread_id) ?? []),
          { seq: e.seq, by: e.caller },
        ]);
    }
    if (e.type !== "STATUS") continue;
    const t = e.thread_id;
    if (e.body.to === "awaiting-review") submittedAt.set(t, e.seq);
    if (e.body.to === "done") {
      expect(
        status.get(t),
        `R1.4 ${t} reached done from ${status.get(t)}`,
      ).toBe("awaiting-review");
      expect(roleOf(e.caller), `R1.7 done set by ${e.caller}`).toBe("reviewer");
      const ok = (passes.get(t) ?? []).some(
        (x) =>
          x.seq > (submittedAt.get(t) ?? Infinity) && x.by !== owner.get(t),
      );
      expect(ok, `R1.9 ${t} done without REVIEW pass by a non-owner`).toBe(
        true,
      );
    }
    status.set(t, e.body.to);
  }
}

/** R2.5 / R2.6 on the raw log, plus R2.7 on the projections. */
export function expectLocksSound(w: World): void {
  const holder = new Map<string, string>();
  const last = new Map<string, number>();
  for (const e of w.events) {
    if (e.type === "GRANT") {
      expect(
        holder.has(e.body.lock),
        `R2.5 ${e.body.lock} granted while held`,
      ).toBe(false);
      expect(e.body.token, `R2.6 ${e.body.lock}`).toBeGreaterThan(
        last.get(e.body.lock) ?? 0,
      );
      holder.set(e.body.lock, e.thread_id);
      last.set(e.body.lock, e.body.token);
    }
    if (e.type === "RELEASE" && holder.get(e.body.lock) === e.thread_id)
      holder.delete(e.body.lock);
  }
  for (const l of Object.values(w.p.locks)) {
    expect(l.holder?.thread).toBe(holder.get(l.name));
    expect(l.queue.some((q) => q.thread === l.holder?.thread)).toBe(false);
    l.queue.forEach((q) => {
      const t = w.p.tasks[q.thread];
      expect(t?.status).toBe("blocked"); // R2.7
      expect(t?.reason).toBe(`lock:${l.name}`);
    });
  }
}
