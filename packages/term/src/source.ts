/**
 * Tasks 10, 20, 21: where screens get their State. `LiveSource` follows the server's WS feed;
 * `ReplaySource` plays a run bundle back through the same core `fold`. Screens cannot tell them apart.
 */
import {
  decide,
  EventSchema,
  fold,
  foldFrom,
  VOICE,
  type Event,
  type Projections,
} from "@graveyard/core";
import { z } from "zod";
import {
  BundleSchema,
  emptyState,
  type Bundle,
  type Lesson,
  type ReplayInfo,
  type State,
} from "./state.js";

export type Action =
  | { type: "answer"; thread: string; ask: string; text: string }
  | { type: "approve"; thread: string; ask: string }
  | { type: "forceDone"; thread: string }
  | { type: "createTask"; thread: string; text: string };

export interface RefusalError {
  code: string;
  message: string;
  hint: string;
  voice: string;
}
export type ActResult = { ok: true } | { ok: false; error: RefusalError };

export interface Change {
  /** Events that arrived after the session began (they ring bells and fade in). */
  added: Event[];
  /** Lessons that arrived after the session began. */
  lessonsAdded: number;
  /** The state jumped (seek); nothing is "new". */
  reset: boolean;
}

export interface ReplayControl {
  info(): ReplayInfo;
  toggle(): void;
  setSpeed(n: number): void;
  step(delta: number): void;
  restart(): void;
}

export interface Source {
  state(): State;
  subscribe(fn: (c: Change) => void): () => void;
  act(a: Action): Promise<ActResult>;
  /** Advance time by `dtMs` of wall clock (replay only; live ignores it). */
  advance(dtMs: number): void;
  replay?: ReplayControl;
  start(): void;
  stop(): void;
}

abstract class Base {
  protected fns = new Set<(c: Change) => void>();
  subscribe(fn: (c: Change) => void): () => void {
    this.fns.add(fn);
    return () => this.fns.delete(fn);
  }
  protected emit(c: Partial<Change>): void {
    for (const f of this.fns)
      f({ added: [], lessonsAdded: 0, reset: false, ...c });
  }
}

// ---- replay ---------------------------------------------------------------

const READ_ONLY: RefusalError = {
  code: "ROLE_DENIED",
  message: "this is a read-only replay; nothing can be answered here",
  hint: "Run a live BBS (`graveyard serve`) to answer.",
  voice: VOICE.ROLE_DENIED,
};

const REFUSAL_NOTE =
  /ACCESS DENIED|ILLEGAL_TRANSITION|NO_EVIDENCE|SELF_REVIEW|ROLE_DENIED/;

export class ReplaySource extends Base implements Source, ReplayControl {
  private pos = 0;
  private clock = 0; // replay ms since the first event
  private speed = 1;
  private playing = true;
  private p: Projections = fold([]);
  private readonly t0: number;
  readonly events: readonly Event[];
  private readonly markers: ReplayInfo["markers"];
  readonly replay: ReplayControl = this;

  constructor(readonly bundle: Bundle) {
    super();
    this.events = bundle.events;
    this.t0 = this.events[0]?.at ?? 0;
    this.markers = this.events.flatMap((e, at): ReplayInfo["markers"] => {
      if (e.type === "ASK") return [{ at, kind: "ask" as const }];
      if (e.type === "STATUS" && e.body.to === "done")
        return [{ at, kind: "done" as const }];
      return e.type === "NOTE" && REFUSAL_NOTE.test(e.body.text)
        ? [{ at, kind: "refusal" as const }]
        : [];
    });
  }

  /** Validates the bundle at the trust boundary. */
  static parse(json: unknown): ReplaySource {
    return new ReplaySource(BundleSchema.parse(json));
  }

  state(): State {
    return {
      ...emptyState(),
      events: this.events.slice(0, this.pos) as Event[],
      p: this.p,
      now: this.t0 + this.clock,
      runId: this.bundle.runId,
      ...(this.bundle.outputs.landingUrl
        ? { landingUrl: this.bundle.outputs.landingUrl }
        : {}),
    };
  }

  private seek(pos: number, reset: boolean): void {
    const to = Math.max(0, Math.min(this.events.length, pos));
    const forward = to > this.pos && !reset;
    const added = forward ? this.events.slice(this.pos, to) : [];
    this.p = forward ? foldFrom(this.p, added) : fold(this.events.slice(0, to));
    const jumped = reset || (!forward && to !== this.pos);
    this.pos = to;
    this.emit({ added, reset: jumped });
  }

  advance(dtMs: number): void {
    if (!this.playing) return;
    this.clock += dtMs * this.speed;
    let to = this.pos;
    while (
      to < this.events.length &&
      (this.events[to]?.at ?? 0) - this.t0 <= this.clock
    )
      to++;
    if (to > this.pos) this.seek(to, false);
    if (this.pos >= this.events.length) this.playing = false;
  }

  info(): ReplayInfo {
    return {
      speed: this.speed,
      playing: this.playing,
      pos: this.pos,
      total: this.events.length,
      markers: this.markers,
    };
  }
  toggle(): void {
    if (this.pos >= this.events.length) this.restart();
    else this.playing = !this.playing;
  }
  setSpeed(n: number): void {
    this.speed = n;
  }
  step(delta: number): void {
    const to = Math.max(0, Math.min(this.events.length, this.pos + delta));
    this.clock = to > 0 ? (this.events[to - 1]?.at ?? this.t0) - this.t0 : 0;
    this.seek(to, delta < 0);
  }
  restart(): void {
    this.clock = 0;
    this.seek(0, true);
    this.playing = true;
  }

  /** The one thing a replay can really do is refuse: core decides, no server needed. */
  async act(a: Action): Promise<ActResult> {
    if (a.type !== "forceDone") return { ok: false, error: READ_ONLY };
    const r = decide(
      this.p,
      {
        type: "set_status",
        actor: { handle: "sysop-replay", role: "sysop" },
        thread_id: a.thread,
        to: "done",
        gate_ok: false,
      },
      { now: this.t0 + this.clock, newId: () => "replay" },
    );
    return r.ok ? { ok: true } : { ok: false, error: r.error };
  }

  start(): void {}
  stop(): void {}
}

// ---- live -----------------------------------------------------------------

const Refusal = z.object({
  ok: z.literal(false),
  error: z.object({
    code: z.string(),
    message: z.string(),
    hint: z.string(),
    voice: z.string(),
  }),
});
const LessonsReply = z.object({
  ok: z.literal(true),
  value: z.array(
    z.object({
      text: z.string(),
      tags: z.array(z.string()),
      project: z.string(),
      board: z.string(),
      thread: z.string(),
    }),
  ),
});

export interface LiveOptions {
  baseUrl: string;
  token: string;
  fetch?: typeof fetch;
  WebSocket?: typeof WebSocket;
  now?: () => number;
  lessonPollMs?: number;
}

export class LiveSource extends Base implements Source {
  private events: Event[] = [];
  private p: Projections = fold([]);
  private lessons: Lesson[] = [];
  private ws?: WebSocket;
  private poll?: ReturnType<typeof setInterval>;
  private buf: Event[] = [];
  private stopped = false;
  private readonly f: typeof fetch;
  private readonly WS: typeof WebSocket;
  private readonly now: () => number;

  constructor(private readonly o: LiveOptions) {
    super();
    // A native fetch throws "Illegal invocation" when called as a method of this object.
    this.f = o.fetch ?? ((...a) => globalThis.fetch(...a));
    this.WS = o.WebSocket ?? WebSocket;
    this.now = o.now ?? Date.now;
  }

  state(): State {
    return {
      events: this.events,
      p: this.p,
      lessons: this.lessons,
      now: this.now(),
    };
  }

  advance(): void {}

  private headers() {
    return {
      authorization: `Bearer ${this.o.token}`,
      "content-type": "application/json",
    };
  }

  /** History first (not "new"), then the feed from the last seq on. */
  start(): void {
    void this.load().then(() => this.connect());
    this.poll = setInterval(
      () => void this.loadLessons(true),
      this.o.lessonPollMs ?? 15_000,
    );
    this.poll.unref?.();
  }

  private async load(): Promise<void> {
    try {
      const res = await this.f(`${this.o.baseUrl}/api/events?after=0`, {
        headers: this.headers(),
      });
      this.apply(z.array(EventSchema).parse(await res.json()), false);
    } catch {
      // The feed below replays from the last seq we hold; nothing is lost.
    }
    await this.loadLessons(false);
  }

  private async loadLessons(fresh: boolean): Promise<void> {
    try {
      const res = await this.f(`${this.o.baseUrl}/api/tools/bbs_list_lessons`, {
        method: "POST",
        headers: this.headers(),
        body: "{}",
      });
      const r = LessonsReply.safeParse(await res.json());
      if (!r.success) return;
      const added = Math.max(0, r.data.value.length - this.lessons.length);
      this.lessons = r.data.value;
      if (fresh && added > 0) this.emit({ lessonsAdded: added });
    } catch {
      // The next poll retries.
    }
  }

  private connect(): void {
    if (this.stopped) return;
    const last = this.events.at(-1)?.seq ?? 0;
    const url = `${this.o.baseUrl.replace(/^http/, "ws")}/ws?after=${last}&token=${encodeURIComponent(this.o.token)}`;
    const ws = new this.WS(url);
    this.ws = ws;
    ws.addEventListener("message", (m: MessageEvent) => {
      const r = EventSchema.safeParse(safeJson(String(m.data)));
      if (!r.success) return;
      this.buf.push(r.data);
      if (this.buf.length === 1) setTimeout(() => this.flush(), 0);
    });
    ws.addEventListener("close", () => {
      if (!this.stopped) setTimeout(() => this.connect(), 1000).unref?.();
    });
  }

  /** Apply what the socket delivered. Public so tests need no timers. */
  flush(): void {
    this.apply(this.buf.splice(0), true);
  }

  private apply(batch: Event[], fresh: boolean): void {
    const have = this.events.at(-1)?.seq ?? 0;
    const news = batch.filter((e) => e.seq > have);
    if (news.length === 0) return;
    this.events = [...this.events, ...news];
    this.p = foldFrom(this.p, news);
    this.emit(fresh ? { added: news } : { reset: true });
  }

  async act(a: Action): Promise<ActResult> {
    const [path, body] =
      a.type === "answer"
        ? ["sysop/answer", { thread_id: a.thread, ask_id: a.ask, text: a.text }]
        : a.type === "approve"
          ? ["sysop/approve", { thread_id: a.thread, ask_id: a.ask }]
          : a.type === "createTask"
            ? ["tools/bbs_create_task", { thread_id: a.thread, text: a.text }]
            : ["sysop/force-done", { thread_id: a.thread }];
    let res: Response;
    try {
      res = await this.f(`${this.o.baseUrl}/api/${path}`, {
        method: "POST",
        headers: this.headers(),
        body: JSON.stringify(body),
      });
    } catch (e) {
      return fault("NETWORK", `server unreachable: ${String(e)}`);
    }
    const j = safeJson(await res.text().catch(() => ""));
    const r = Refusal.safeParse(j);
    if (r.success) return { ok: false, error: r.data.error };
    // Only an explicit {ok:true} on a 2xx counts. Anything else is a failure, never a silent success.
    if (res.ok && z.object({ ok: z.literal(true) }).safeParse(j).success) {
      await this.catchUp();
      return { ok: true };
    }
    return fault(
      "BAD_REPLY",
      `server answered HTTP ${res.status} without ok:true`,
    );
  }

  /** Pull events we have not seen, so the screen updates even if the socket lags. */
  private async catchUp(): Promise<void> {
    try {
      const last = this.events.at(-1)?.seq ?? 0;
      const res = await this.f(`${this.o.baseUrl}/api/events?after=${last}`, {
        headers: this.headers(),
      });
      this.apply(z.array(EventSchema).parse(await res.json()), true);
    } catch {
      // The socket feed still delivers it.
    }
  }

  stop(): void {
    this.stopped = true;
    clearInterval(this.poll);
    this.ws?.close();
  }
}

const fault = (code: string, message: string): ActResult => ({
  ok: false,
  error: {
    code,
    message,
    hint: "Nothing was saved. Check the server and try again.",
    voice: "The spirits are silent.",
  },
});

function safeJson(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return undefined;
  }
}
