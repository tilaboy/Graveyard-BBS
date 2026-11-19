/** Tasks 7, 21: browser entry. Live mode follows the server; replay mode plays a recorded run. */
import { Terminal } from "@xterm/xterm";
import { Unicode11Addon } from "@xterm/addon-unicode11";
import { createAudio } from "./audio.js";
import { Session } from "./session.js";
import { LiveSource, ReplaySource, type Source } from "./source.js";

const mode = document.body.dataset["mode"] === "replay" ? "replay" : "live";
const params = new URLSearchParams(location.hash.slice(1));

const term = new Terminal({
  cols: 100,
  rows: 30,
  allowProposedApi: true,
  cursorBlink: false,
  fontFamily:
    "'Perfect DOS VGA 437', 'Px437 IBM VGA 8x16', 'Courier New', monospace, 'Apple Color Emoji', 'Segoe UI Emoji', 'Noto Color Emoji'",
  fontSize: 16,
  theme: { background: "#000000" },
});
term.loadAddon(new Unicode11Addon());
term.unicode.activeVersion = "11";
term.open(document.getElementById("term")!);
term.focus();
// A click anywhere on the page returns keyboard focus to the terminal.
document.addEventListener("click", () => term.focus());

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
  const session = new Session({
    source: picked.source,
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
  picked.source.start();
  term.onData((d) => session.key(d));
  setInterval(() => session.needsTick() && session.tick(), 100);
  session.paint();
})();
