/**
 * One Session per connection: the view stack, the key handler, the animation clock and the effects
 * (sound, open-URL, close). It talks to the transport only through `write` and `effect`, so the same
 * class runs in the browser (xterm.js), over telnet and in the replay player.
 */
import { stripUnsafe } from "./ansi.js";
import {
  askList,
  boardsList,
  gameList,
  denyScreen,
  render,
  threadList,
  treeCursor,
  treeRows,
} from "./screens.js";
import type { Action, Source } from "./source.js";
import { boardNames, newView, openAsks, type View } from "./state.js";
import { BELL_REPEAT_MS, type SoundName } from "./theme.js";

/** How long a one-line notice stays before it clears itself. */
export const FLASH_MS = 3000;

export type Effect =
  | { kind: "sound"; name: SoundName }
  | { kind: "open"; url: string }
  | { kind: "close" };

export interface SessionOptions {
  source: Source;
  write: (s: string) => void;
  effect?: (e: Effect) => void;
  cols?: number;
  rows?: number;
  reducedMotion?: boolean;
  now?: () => number;
  /** Where published games and decks are served, relative to the page. */
  publishedBase?: string;
}

const KEYS: [string, string][] = [
  ["\x1b[A", "up"],
  ["\x1bOA", "up"],
  ["\x1b[B", "down"],
  ["\x1bOB", "down"],
  ["\x1b[C", "right"],
  ["\x1bOC", "right"],
  ["\x1b[D", "left"],
  ["\x1bOD", "left"],
  ["\x1b[5~", "pgup"],
  ["\x1b[6~", "pgdn"],
  ["\x1b[H", "home"],
  ["\x1b[1~", "home"],
  ["\x1b", "esc"],
  ["\r", "enter"],
  ["\x7f", "backspace"],
  ["\b", "backspace"],
];

/** Split raw terminal input into named keys and single characters. */
export function parseKeys(data: string): string[] {
  const out: string[] = [];
  for (let i = 0; i < data.length;) {
    const k = KEYS.filter(([seq]) => data.startsWith(seq, i)).sort(
      (a, b) => b[0].length - a[0].length,
    )[0];
    if (k) {
      out.push(k[1]);
      i += k[0].length;
      if (k[1] === "enter" && (data[i] === "\n" || data[i] === "\0")) i++;
      continue;
    }
    const ch = String.fromCodePoint(data.codePointAt(i) ?? 0);
    i += ch.length;
    if (ch === "\n") out.push("enter");
    else if (ch >= " ") out.push(ch);
  }
  return out;
}

/** Thread-id tail: lowercase letters, digits and single dashes, at most 40 characters. */
const slugOf = (s: string): string =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/, "");

type Nav = Pick<View, "screen" | "board" | "thread" | "sel" | "scroll">;

export class Session {
  readonly view: View;
  private readonly stack: Nav[] = [];
  private last = "";
  private lastTick: number;
  private lastBell = 0;
  private flashSeen: { text: string; at: number } | undefined;
  private readonly off: () => void;
  private readonly now: () => number;

  constructor(private readonly o: SessionOptions) {
    this.now = o.now ?? Date.now;
    this.view = newView({
      cols: o.cols ?? 100,
      rows: o.rows ?? 30,
      reducedMotion: o.reducedMotion ?? false,
      now: this.now(),
    });
    this.lastTick = this.view.now;
    this.view.fx["login"] = this.view.now;
    this.off = o.source.subscribe((c) => {
      this.sync();
      const v = this.view;
      for (const e of c.added) {
        v.fx[`post:${e.seq}`] = v.now;
        if (e.type === "ASK") {
          this.lastBell = v.now;
          this.sound("bell");
        } else if (e.type === "STATUS" && e.body.to === "running")
          v.fx[`ghost:${e.thread_id}`] = v.now;
        else if (e.type === "STATUS" && e.body.to === "done") {
          v.fx[`done:${e.thread_id}`] = v.now;
          this.sound("thud");
        }
      }
      if (c.lessonsAdded > 0) this.sound("wind");
      this.paint();
    });
    this.sound("modem");
  }

  dispose(): void {
    this.off();
  }

  /** The transport ticks only while this is true. Reduced motion never animates a live feed. */
  needsTick(): boolean {
    return (
      !this.view.reducedMotion ||
      (this.o.source.replay?.info().playing ?? false)
    );
  }

  /** Call every ~100 ms while `needsTick()`. */
  tick(): void {
    const now = this.now();
    this.o.source.advance(now - this.lastTick);
    this.lastTick = now;
    this.sync();
    // A one-line notice ("Created … (pending).") fades on its own after FLASH_MS.
    const f = this.view.flash;
    if (!f) this.flashSeen = undefined;
    else if (this.flashSeen?.text !== f) this.flashSeen = { text: f, at: now };
    else if (now - this.flashSeen.at >= FLASH_MS) {
      delete this.view.flash;
      this.flashSeen = undefined;
    }
    const asks = openAsks(this.o.source.state()).length;
    if (asks === 0) this.lastBell = 0;
    else if (this.lastBell && now - this.lastBell >= BELL_REPEAT_MS) {
      this.lastBell = now;
      this.sound("bell");
    }
    this.paint();
  }

  resize(cols: number, rows: number): void {
    Object.assign(this.view, { cols, rows });
    this.paint(true);
  }

  /** Current frame (also what `paint` writes). */
  frame(): string {
    this.sync();
    return render(this.o.source.state(), this.view);
  }

  paint(force = false): void {
    const f = this.frame();
    if (!force && f === this.last) return;
    this.o.write(this.last === "" ? `\x1b[2J${f}` : f);
    this.last = f;
  }

  key(data: string): void {
    this.sync();
    for (const k of parseKeys(data)) this.handle(k);
    this.paint();
  }

  // ---- internals ----------------------------------------------------------

  private sync(): void {
    this.view.now = this.now();
    const r = this.o.source.replay;
    if (r) this.view.replay = r.info();
    else delete this.view.replay;
  }

  private sound(name: SoundName): void {
    if (!this.view.muted) this.o.effect?.({ kind: "sound", name });
  }

  private go(screen: View["screen"], patch: Partial<Nav> = {}): void {
    const { screen: s, board, thread, sel, scroll } = this.view;
    this.stack.push({
      screen: s,
      ...(board ? { board } : {}),
      ...(thread ? { thread } : {}),
      sel,
      scroll,
    });
    Object.assign(this.view, { sel: 0, scroll: 0, ...patch, screen });
  }

  private back(): void {
    const n = this.stack.pop();
    if (n) {
      delete this.view.board;
      delete this.view.thread;
      Object.assign(this.view, n);
    }
  }

  private count(): number {
    const s = this.o.source.state();
    const v = this.view;
    switch (v.screen) {
      case "boards":
        return boardsList(s).length;
      case "threads":
        return threadList(s, v).length;
      case "sysop":
        return askList(s).length;
      case "doors":
        return gameList(s).length;
      case "bulletins":
        return s.lessons.length;
      default:
        return 0;
    }
  }

  private move(delta: number): void {
    const n = this.count();
    this.view.sel =
      n === 0 ? 0 : Math.max(0, Math.min(n - 1, this.view.sel + delta));
  }

  private handle(k: string): void {
    const v = this.view;
    if (v.denied) {
      delete v.denied;
      return;
    }
    if (v.input) return this.typing(k);
    delete v.flash;
    if (k === "m" || k === "M") {
      v.muted = !v.muted;
      if (!v.muted && v.screen === "login") this.sound("modem");
      return;
    }
    const rc = this.o.source.replay;
    if (rc) {
      if (k === " ") return rc.toggle();
      if (k === "1" || k === "5") return rc.setSpeed(Number(k));
      if (k === "2") return rc.setSpeed(20);
      // On the tree, ←/→ fold and open; replay steps on every other screen.
      if (k === "left" && v.screen !== "tree") return rc.step(-1);
      if (k === "right" && v.screen !== "tree") return rc.step(1);
      if (k === "home") return rc.restart();
    }
    if (v.screen === "login") {
      this.go("tree");
      if (openAsks(this.o.source.state()).length > 0) {
        this.lastBell = v.now;
        this.sound("bell");
      }
      if (k === "n" || k === "N") this.startNewTask();
      return;
    }
    if (k === "esc" && v.screen === "tree") return this.go("menu");
    if (k === "esc" && v.screen !== "bye") return this.back();
    if ((k === "t" || k === "T") && v.screen !== "bye") return this.home();
    if (v.screen === "tree" && this.treeKey(k)) return;
    if (k === "up")
      return v.screen === "thread" ? void (v.scroll += 1) : this.move(-1);
    if (k === "down")
      return v.screen === "thread"
        ? void (v.scroll = Math.max(0, v.scroll - 1))
        : this.move(1);
    const key = k.toLowerCase();
    if (key === "r" && this.startReply()) return;
    if (key === "n" && !this.denies()) return this.startNewTask();
    this.screenKey(key);
  }

  /** [N] means "deny" only where an ASK is selected; everywhere else it starts a new task. */
  private denies(): boolean {
    return denyScreen(this.o.source.state(), this.view);
  }

  private screenKey(k: string): void {
    const v = this.view;
    const s = this.o.source.state();
    switch (v.screen) {
      case "tree":
      case "menu": {
        const to = {
          b: "boards",
          w: "who",
          s: "sysop",
          d: "doors",
          l: "log",
          u: "bulletins",
        } as const;
        if (k in to) this.go(to[k as keyof typeof to]);
        else if (k === "g") {
          this.go("bye");
          this.sound("nocarrier");
          this.o.effect?.({ kind: "close" });
        }
        return;
      }
      case "boards":
        if (k === "enter") {
          const b = boardsList(s)[v.sel];
          if (b) this.go("threads", { board: b });
        }
        return;
      case "threads":
        if (k === "enter") {
          const t = threadList(s, v)[v.sel];
          if (t) this.go("thread", { thread: t.thread_id });
        }
        return;
      case "sysop": {
        const a = askList(s)[v.sel];
        if (k === "enter" && a) this.go("thread", { thread: a.thread });
        else if (a) this.askKey(k, a.thread, a.id);
        return;
      }
      case "thread": {
        const t = v.thread ? s.p.tasks[v.thread] : undefined;
        if (!t) return;
        const a = askList(s)
          .filter((x) => x.thread === t.thread_id)
          .at(-1);
        if (k === "x")
          void this.run(
            { type: "forceDone", thread: t.thread_id },
            `${t.status} → done`,
          );
        else if (
          k === "v" &&
          gameList(s).some((p) => p.kind === "deck" && p.thread === t.thread_id)
        )
          this.go("deck");
        else if (a) this.askKey(k, a.thread, a.id);
        else if (k === "a" || k === "p")
          v.flash = "No open ASK on this thread.";
        return;
      }
      case "doors": {
        const p = gameList(s)[v.sel];
        if (k !== "enter" || !p) return;
        if (p.kind === "game") this.openUrl(`${p.kind}s/${p.slug}/index.html`);
        else
          this.go("deck", {
            sel: gameList(s)
              .filter((x) => x.kind === "deck")
              .findIndex((x) => x.slug === p.slug),
          });
        return;
      }
      case "bulletins": {
        const l = s.lessons[v.sel];
        if (k === "enter" && l && s.p.tasks[l.thread])
          this.go("thread", { thread: l.thread });
        return;
      }
      case "deck": {
        const d =
          gameList(s).filter((x) => x.kind === "deck")[v.sel] ??
          gameList(s).find((x) => x.kind === "deck");
        if (k === "enter" && d) this.openUrl(`decks/${d.slug}/index.html`);
        return;
      }
      default:
    }
  }

  /** Back to the start tree from anywhere; the stack starts over. */
  private home(): void {
    this.stack.length = 0;
    delete this.view.board;
    delete this.view.thread;
    Object.assign(this.view, { screen: "tree", sel: 0, scroll: 0 });
  }

  /** ↑↓ move, → open, ← fold (a post folds its task), Enter opens the full thread. True if used. */
  private treeKey(k: string): boolean {
    const v = this.view;
    const rows = treeRows(this.o.source.state(), v);
    const i = treeCursor(rows, v);
    const r = rows[i];
    if (!r) return false;
    const open = v.tree.open;
    const at = (key: string) => (v.tree.at = key);
    if (k === "up" || k === "down") {
      const j = Math.max(
        0,
        Math.min(rows.length - 1, i + (k === "up" ? -1 : 1)),
      );
      at(rows[j]?.key ?? r.key);
    } else if (k === "right") {
      if (r.kind === "board" || r.kind === "task") open[r.key] = true;
      at(r.key);
    } else if (k === "left") {
      const task = `t:${r.thread ?? ""}`;
      if (r.kind === "board") {
        open[r.key] = false;
        at(r.key);
      } else if (r.kind === "post" || (r.kind === "task" && open[task])) {
        open[task] = false;
        at(task);
      } else at(`b:${r.board}`); // a folded task or "… more": go up to the board
    } else if (k === "enter") {
      at(r.key);
      if (r.thread) this.go("thread", { thread: r.thread });
      else if (r.kind === "more") this.go("threads", { board: r.board });
      else open[r.key] = open[r.key] === false;
    } else return false;
    return true;
  }

  private openUrl(path: string): void {
    this.o.effect?.({
      kind: "open",
      url: `${this.o.publishedBase ?? "/published"}/${path}`,
    });
    this.view.flash = `Opened ${this.o.publishedBase ?? "/published"}/${path}`;
  }

  private askKey(k: string, thread: string, ask: string): void {
    if (k === "a") this.view.input = { prompt: "Answer", buf: "", thread, ask };
    else if (k === "p")
      void this.run({ type: "approve", thread, ask }, "approve");
    else if (k === "n")
      void this.run({ type: "answer", thread, ask, text: "deny" }, "deny");
  }

  private typing(k: string): void {
    const i = this.view.input;
    if (!i) return;
    if (k === "esc") {
      delete this.view.input;
      delete this.view.newTask;
    } else if (k === "backspace") i.buf = [...i.buf].slice(0, -1).join("");
    else if (k === "enter") {
      delete this.view.input;
      if (this.view.newTask) return this.newTaskStep(i.buf.trim());
      const text = i.buf.trim();
      if (text && i.reply)
        void this.run(
          { type: "steer", thread: i.thread, text },
          "reply",
          () => {
            this.view.flash = `Posted to ${i.thread}.`;
          },
        );
      else if (text)
        void this.run(
          { type: "answer", thread: i.thread, ask: i.ask, text },
          "answer",
        );
    } else if ([...k].length === 1) i.buf += stripUnsafe(k);
  }

  /** [R] on the full thread, or a task/post row of the tree: a one-line Sysop reply (a steer post). */
  private startReply(): boolean {
    const v = this.view;
    const s = this.o.source.state();
    const thread =
      v.screen === "thread"
        ? v.thread
        : v.screen === "tree"
          ? treeRows(s, v)[treeCursor(treeRows(s, v), v)]?.thread
          : undefined;
    if (!thread || !s.p.tasks[thread]) return false;
    v.input = {
      prompt: `Reply to ${thread}:`,
      buf: "",
      thread,
      ask: "",
      reply: true,
    };
    return true;
  }

  /** [N] on the menu: board, title, body, then the existing create_task command (the server checks the role). */
  private startNewTask(): void {
    const v = this.view;
    const s = this.o.source.state();
    const here =
      v.screen === "tree"
        ? treeRows(s, v)[treeCursor(treeRows(s, v), v)]?.board
        : v.board;
    const first = here ?? boardNames(s)[0] ?? "general";
    this.view.newTask = { step: "board", board: first, title: "" };
    this.view.input = {
      prompt: `New task: board [${first}]`,
      buf: "",
      thread: "",
      ask: "",
    };
  }

  private newTaskStep(line: string): void {
    const v = this.view;
    const n = v.newTask;
    if (!n) return;
    const next = (prompt: string) =>
      (v.input = { prompt, buf: "", thread: "", ask: "" });
    if (n.step === "board") {
      const board = line.toLowerCase() || n.board;
      if (!/^[a-z0-9]+$/.test(board)) {
        delete v.newTask;
        v.flash = "Board names are letters and digits only. Task not created.";
        return;
      }
      Object.assign(n, { step: "title", board });
      next(`New task on #${board}: title`);
    } else if (n.step === "title") {
      const slug = slugOf(line);
      if (!slug) {
        delete v.newTask;
        v.flash = "A title is needed. Task not created.";
        return;
      }
      Object.assign(n, { step: "body", title: line });
      next("Body (optional, Enter to skip)");
    } else {
      delete v.newTask;
      const s = this.o.source.state();
      const base = `${n.board}-${slugOf(n.title)}`;
      let thread = base;
      for (let i = 2; s.p.tasks[thread]; i++) thread = `${base}-${i}`;
      const text = stripUnsafe(line ? `${n.title} — ${line}` : n.title).slice(
        0,
        4000,
      );
      void this.run({ type: "createTask", thread, text }, "new task", () => {
        this.view.flash = `Created ${thread} (pending).`;
      });
    }
  }

  /** Send a Sysop action. A refusal opens the ACCESS DENIED box and plays the organ chord. */
  private async run(
    a: Action,
    transition: string,
    onOk?: () => void,
  ): Promise<void> {
    const r = await this.o.source.act(a);
    this.sync();
    if (!r.ok) {
      this.view.denied = { error: r.error, transition };
      this.view.fx["denied"] = this.view.now;
      this.sound("organ");
    } else onOk?.();
    this.paint();
  }
}
