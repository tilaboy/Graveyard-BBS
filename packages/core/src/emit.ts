import type { Event, Role } from "./events.js";
import { foldFrom, type Projections } from "./fold.js";

/** Time and ids are injected; core never reads a clock. */
export interface Ctx {
  now: number;
  newId: () => string;
  /** Lock lease in ms. Default 60 s (locks-and-doors.md). */
  leaseMs?: number;
}
export const DEFAULT_LEASE_MS = 60_000;

/** `server` is the system identity (tick, lock hand-over, budgets). */
export interface Actor {
  handle: string;
  role: Role | "server";
}

type DistOmit<T, K extends PropertyKey> = T extends unknown
  ? Omit<T, K>
  : never;
export type NewEvent = DistOmit<Event, "id" | "seq" | "at">;

/** Builds events one by one and keeps `p` current, so later steps see earlier ones. */
export class Emitter {
  p: Projections;
  events: Event[] = [];
  constructor(
    p0: Projections,
    readonly ctx: Ctx,
  ) {
    this.p = p0;
  }
  push(e: NewEvent): void {
    const full = {
      ...e,
      id: this.ctx.newId(),
      seq: this.p.seq + 1,
      at: this.ctx.now,
    } as Event;
    this.events.push(full);
    this.p = foldFrom(this.p, [full]);
  }
}
