/** Task 10: `graveyard replay <bundle> --speed N` re-renders a recorded log in this terminal. */
import { readFileSync } from "node:fs";
import { Session } from "./session.js";
import { ReplaySource } from "./source.js";

export async function runReplayTerminal(
  file: string,
  speed: number,
): Promise<void> {
  const source = ReplaySource.parse(JSON.parse(readFileSync(file, "utf8")));
  source.setSpeed(speed);
  const out = process.stdout;
  let done: () => void = () => undefined;
  const finished = new Promise<void>((res) => (done = res));
  const session = new Session({
    source,
    cols: out.columns || 100,
    rows: out.rows || 30,
    write: (s) => out.write(s),
    effect: (e) => {
      if (e.kind === "sound" && e.name === "bell") out.write("\x07");
      if (e.kind === "close") done();
    },
  });
  process.stdin.setRawMode?.(true);
  process.stdin.on("data", (d) =>
    d.toString() === "\x03" ? done() : session.key(d.toString()),
  );
  const timer = setInterval(() => session.needsTick() && session.tick(), 100);
  session.paint();
  await finished;
  clearInterval(timer);
  process.stdin.setRawMode?.(false);
  process.stdin.pause();
  out.write("\x1b[?25h\r\n");
}
