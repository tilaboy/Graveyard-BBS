/** Tasks 7, 21: browser entry. Live mode follows the server; replay mode plays a recorded run. */
import { Terminal } from "@xterm/xterm";
import { Unicode11Addon } from "@xterm/addon-unicode11";
import { createAudio } from "./audio.js";
import { fitSize, MIN_COLS, MIN_ROWS } from "./fit.js";
import { pathSpans } from "./format.js";
import { Session } from "./session.js";
import { LiveSource, ReplaySource, type Source } from "./source.js";

const mode = document.body.dataset["mode"] === "replay" ? "replay" : "live";
const params = new URLSearchParams(location.hash.slice(1));

const box = document.getElementById("term")!;
const term = new Terminal({
  cols: MIN_COLS,
  rows: MIN_ROWS,
  // Every frame repaints the whole screen, so there is nothing to scroll back to.
  scrollback: 0,
  allowProposedApi: true,
  cursorBlink: false,
  fontFamily:
    "'Perfect DOS VGA 437', 'Px437 IBM VGA 8x16', 'Courier New', monospace, 'Apple Color Emoji', 'Segoe UI Emoji', 'Noto Color Emoji'",
  fontSize: 16,
  theme: { background: "#000000" },
});
term.loadAddon(new Unicode11Addon());
term.unicode.activeVersion = "11";
term.open(box);
term.focus();
// A click anywhere on the page returns keyboard focus to the terminal.
document.addEventListener("click", () => term.focus());

let session: Session | undefined;

/** Fill the page: cell size from the drawn screen, space from the #term box. */
function fit(): void {
  const screen = term.element?.querySelector(".xterm-screen");
  if (!screen) return;
  const r = screen.getBoundingClientRect();
  const cs = getComputedStyle(box);
  const px = (p: string) => parseFloat(p) || 0;
  const { cols, rows } = fitSize(
    {
      width: box.clientWidth - px(cs.paddingLeft) - px(cs.paddingRight),
      height: box.clientHeight - px(cs.paddingTop) - px(cs.paddingBottom),
    },
    { width: r.width / term.cols, height: r.height / term.rows },
  );
  if (cols === term.cols && rows === term.rows) return;
  term.resize(cols, rows);
  session?.resize(cols, rows);
}
fit();
let queued = 0;
const refit = () => {
  cancelAnimationFrame(queued);
  queued = requestAnimationFrame(fit);
};
// The box follows the window (and the app page's iframe); a late web font changes the cell size.
new ResizeObserver(refit).observe(box);
void document.fonts?.ready.then(refit);

async function pickSource(): Promise<
  { source: Source; base: string } | string
> {
  if (mode === "live") {
    const token = params.get("token");
    if (!token)
      return "No token. Open the URL printed by `graveyard serve` (it ends in #token=...).";
    return {
      source: new LiveSource({ baseUrl: location.origin, token }),
      base: "/published",
    };
  }
  const index = (await (await fetch("runs/index.json")).json()) as {
    runId: string;
    file: string;
  }[];
  const nav = document.getElementById("runs")!;
  for (const r of index) {
    const a = document.createElement("a");
    a.href = `#run=${r.runId}`;
    a.textContent = r.runId;
    a.addEventListener("click", () => setTimeout(() => location.reload(), 0));
    nav.append(a);
  }
  const run = index.find((r) => r.runId === params.get("run")) ?? index[0];
  if (!run) return "No recorded runs on this site.";
  const source = ReplaySource.parse(await (await fetch(run.file)).json());
  return { source, base: "published" };
}

void (async () => {
  const picked = await pickSource();
  if (typeof picked === "string") return term.write(`\r\n  ${picked}\r\n`);
  const audio = createAudio();
  const live = new Session({
    source: picked.source,
    cols: term.cols,
    rows: term.rows,
    publishedBase: picked.base,
    reducedMotion: matchMedia("(prefers-reduced-motion: reduce)").matches,
    write: (s) => term.write(s),
    effect: (e) => {
      if (e.kind === "sound") audio.play(e.name);
      else if (e.kind === "open")
        window.open(
          new URL(
            e.url.replace(/^\//, ""),
            mode === "live" ? `${location.origin}/` : location.href,
          ).href,
          "_blank",
          "noopener",
        );
    },
  });
  session = live;
  picked.source.start();
  term.onData((d) => live.key(d));
  // File paths on screen are links: hover underlines, click opens the in-terminal file viewer.
  term.registerLinkProvider({
    provideLinks(y, done) {
      const line = live.linkable()
        ? term.buffer.active.getLine(y - 1)
        : undefined;
      if (!line) return done(undefined);
      // Text and the cell (1-based) where each UTF-16 unit starts; wide emoji take two cells.
      let text = "";
      const col: number[] = [];
      for (let x = 0; x < line.length; x++) {
        const ch = line.getCell(x)?.getChars() ?? "";
        if (!ch && line.getCell(x)?.getWidth() === 0) continue;
        const c = ch || " ";
        for (let i = 0; i < c.length; i++) col.push(x + 1);
        text += c;
      }
      const links = pathSpans(text).map((p) => ({
        text: p.path,
        range: {
          start: { x: col[p.start] ?? 1, y },
          end: { x: col[p.end - 1] ?? 1, y },
        },
        activate: () => live.openLink(p.path),
      }));
      done(links.length ? links : undefined);
    },
  });
  setInterval(() => live.needsTick() && live.tick(), 100);
  live.paint();
})();
