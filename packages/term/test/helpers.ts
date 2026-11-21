import {
  decide,
  foldFrom,
  emptyProjections,
  type Actor,
  type Command,
  type Event,
  type Projections,
} from "@graveyard/core";
import {
  LiveSource,
  ReplaySource,
  type ActResult,
  type Action,
  type FileContent,
  type Source,
} from "../src/source.js";
import { Session, type Effect } from "../src/session.js";
import {
  emptyState,
  newView,
  type Bundle,
  type State,
  type View,
} from "../src/state.js";
import { render } from "../src/screens.js";

export const T0 = Date.UTC(2026, 10, 13, 20, 0, 0);
export const actors = {
  mod: { handle: "moderator-1", role: "moderator" },
  b1: { handle: "builder-1", role: "builder" },
  b2: { handle: "builder-2", role: "builder" },
  rev: { handle: "reviewer-1", role: "reviewer" },
  sysop: { handle: "sysop-term", role: "sysop" },
  srv: { handle: "server", role: "server" },
} as const satisfies Record<string, Actor>;

/** A tiny world: commands go through core's `decide`, exactly as the server does. */
export class World {
  p: Projections = emptyProjections();
  events: Event[] = [];
  now = T0;
  private n = 0;

  do(cmd: Command): ReturnType<typeof decide> {
    this.now += 1000;
    const r = decide(this.p, cmd, {
      now: this.now,
      newId: () => `e${++this.n}`,
    });
    if (r.ok) {
      this.events.push(...r.value);
      this.p = foldFrom(this.p, r.value);
    }
    return r;
  }
  must(cmd: Command): Event[] {
    const r = this.do(cmd);
    if (!r.ok)
      throw new Error(`${cmd.type}: ${r.error.code} ${r.error.message}`);
    return r.value;
  }
  start(thread: string, owner: Actor, text: string): void {
    this.must({
      type: "create_task",
      actor: actors.mod,
      thread_id: thread,
      text,
      assigned: owner.handle,
    });
    this.must({ type: "issue_packet", actor: actors.mod, thread_id: thread });
    this.must({
      type: "ack",
      actor: owner,
      thread_id: thread,
      packet_id: this.p.tasks[thread]!.packet!,
    });
    this.must({
      type: "set_status",
      actor: owner,
      thread_id: thread,
      to: "running",
      gate_ok: false,
    });
  }
  evidence(thread: string, door: string, exit = 0, extra: object = {}): void {
    this.must({
      type: "post",
      actor: actors.srv,
      thread_id: thread,
      kind: "EVIDENCE",
      body: {
        text: JSON.stringify({
          door,
          args: {},
          exit_code: exit,
          duration_ms: 42,
          commit: "abcdef1234",
          log_sha256: "x",
          extra,
        }),
      },
    });
  }
}

/** Three threads in three different statuses: blocked on an ASK, done (reviewed), running. */
export function threeThreads(): World {
  const w = new World();
  w.start("websites-landing", actors.b1, "Haunted landing page");
  w.must({
    type: "post",
    actor: actors.b1,
    thread_id: "websites-landing",
    kind: "MILESTONE",
    body: {
      text: "🔥 The signup form has taken shape in the dark. Files: form.html, api.ts.",
    },
  });
  const ask = w.must({
    type: "post",
    actor: actors.b1,
    thread_id: "websites-landing",
    kind: "ASK",
    body: { text: "❓🦇 Dark theme or blood-red? (answer A or B)" },
  })[0]!;
  w.must({
    type: "set_status",
    actor: actors.b1,
    thread_id: "websites-landing",
    to: "blocked",
    reason: `ask:${ask.id}`,
    gate_ok: false,
  });

  w.start("arcade-snake", actors.b2, "Small door game");
  w.evidence("arcade-snake", "run_tests");
  w.evidence("arcade-snake", "publish", 0, { kind: "game", slug: "snake" });
  w.must({
    type: "set_status",
    actor: actors.b2,
    thread_id: "arcade-snake",
    to: "awaiting-review",
    gate_ok: false,
  });
  w.must({
    type: "review",
    actor: actors.rev,
    thread_id: "arcade-snake",
    verdict: "pass",
    reasons: ["ok"],
  });
  w.must({
    type: "set_status",
    actor: actors.rev,
    thread_id: "arcade-snake",
    to: "done",
    gate_ok: true,
  });

  w.start("slides-pitch", actors.b1, "Pitch deck");
  w.evidence("slides-pitch", "publish", 0, { kind: "deck", slug: "pitch" });
  w.must({
    type: "post",
    actor: actors.b1,
    thread_id: "slides-pitch",
    kind: "MILESTONE",
    body: { text: "Six slides drafted." },
  });
  return w;
}

export const bundleOf = (w: World, runId = "2026-11-13-test-1"): Bundle => ({
  runId,
  recordedAt: new Date(T0).toISOString(),
  project: "graveyard-bbs",
  events: w.events,
  outputs: { games: ["snake"], decks: ["pitch"] },
});

export const stateOf = (w: World): State => ({
  ...emptyState(),
  events: w.events,
  p: w.p,
  now: w.now,
});

export const viewOf = (o: Partial<View> = {}): View =>
  newView({ now: w0(), ...o });
const w0 = () => T0;

/** Remove SGR so assertions read the plain facts. */
export const plain = (s: string): string =>
  s.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "");

export const frame = (s: State, o: Partial<View> = {}): string =>
  plain(render(s, viewOf({ screen: "menu", ...o })));

/** A Session over a replay of `w`, with captured output and effects. */
export function replaySession(w: World, o: { reducedMotion?: boolean } = {}) {
  const src = new ReplaySource(bundleOf(w) as never);
  const out: string[] = [];
  const effects: Effect[] = [];
  let now = T0;
  const session = new Session({
    source: src,
    write: (s) => out.push(s),
    effect: (e) => effects.push(e),
    now: () => now,
    ...o,
  });
  return {
    src,
    session,
    out,
    effects,
    advance: (ms: number) => {
      now += ms;
      session.tick();
    },
    last: () => plain(out.at(-1) ?? ""),
  };
}

export { LiveSource, ReplaySource, type Source };

/** A Source over fixed state that records Sysop actions. */
export function fakeSource(
  state: State,
  reply: ActResult = { ok: true },
  files: Record<string, FileContent> = {},
) {
  const acts: Action[] = [];
  const reads: { thread: string; path: string }[] = [];
  const src: Source = {
    state: () => state,
    subscribe: () => () => undefined,
    act: async (a) => (acts.push(a), reply),
    readFile: async (thread, path) => {
      reads.push({ thread, path });
      const f = files[path];
      return f
        ? { ok: true, value: f }
        : {
            ok: false,
            error: { code: "NOT_FOUND", message: path, hint: "h", voice: "v" },
          };
    },
    advance: () => undefined,
    start: () => undefined,
    stop: () => undefined,
  };
  return { src, acts, reads };
}

export const settle = () => new Promise((r) => setTimeout(r, 0));
