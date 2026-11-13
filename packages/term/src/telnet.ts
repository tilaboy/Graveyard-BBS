/** Task 8 (R2.2): the same Session over a raw telnet socket. Bound to loopback by the caller. */
import { createServer, type Socket } from "node:net";
import { StringDecoder } from "node:string_decoder";
import { Session } from "./session.js";
import type { Source } from "./source.js";

const IAC = 255;
const SB = 250;
const SE = 240;
const WILL = 251;
const DO = 253;
const OPT_ECHO = 1;
const OPT_SGA = 3;
const OPT_NAWS = 31;

/** Strips telnet commands from the byte stream; reports window size from NAWS. */
export class TelnetParser {
  private st: "text" | "iac" | "verb" | "sb" | "sbiac" = "text";
  private sb: number[] = [];
  private dec = new StringDecoder("utf8");

  feed(b: Buffer): { text: string; size?: [number, number] } {
    const keep: number[] = [];
    let size: [number, number] | undefined;
    for (const c of b) {
      switch (this.st) {
        case "text":
          if (c === IAC) this.st = "iac";
          else keep.push(c);
          break;
        case "iac":
          if (c === IAC) {
            keep.push(c); // escaped 0xFF
            this.st = "text";
          } else if (c === SB) {
            this.sb = [];
            this.st = "sb";
          } else this.st = c >= WILL ? "verb" : "text";
          break;
        case "verb":
          this.st = "text";
          break;
        case "sb":
          if (c === IAC) this.st = "sbiac";
          else this.sb.push(c);
          break;
        case "sbiac":
          if (c === SE) {
            const [opt, w1, w0, h1, h0] = this.sb;
            if (opt === OPT_NAWS && this.sb.length === 5)
              size = [
                ((w1 ?? 0) << 8) | (w0 ?? 0),
                ((h1 ?? 0) << 8) | (h0 ?? 0),
              ];
            this.st = "text";
          } else this.st = "sb";
          break;
      }
    }
    return {
      text: this.dec.write(Buffer.from(keep)),
      ...(size ? { size } : {}),
    };
  }
}

export interface TelnetOptions {
  source: Source;
  host?: string;
  port?: number;
  reducedMotion?: boolean;
}

export async function startTelnet(o: TelnetOptions) {
  const sockets = new Set<Socket>();
  const server = createServer((sock) => {
    sockets.add(sock);
    sock.on("close", () => sockets.delete(sock));
    sock.on("error", () => sock.destroy());
    // We echo and send one character at a time, like a BBS door.
    sock.write(
      Buffer.from([IAC, WILL, OPT_ECHO, IAC, WILL, OPT_SGA, IAC, DO, OPT_NAWS]),
    );
    const parser = new TelnetParser();
    const session = new Session({
      source: o.source,
      cols: 80,
      rows: 25,
      reducedMotion: o.reducedMotion ?? false,
      write: (s) => sock.write(s),
      effect: (e) => {
        if (e.kind === "sound" && e.name === "bell") sock.write("\x07");
        if (e.kind === "close") setTimeout(() => sock.end(), 300);
      },
    });
    const timer = setInterval(() => session.needsTick() && session.tick(), 100);
    sock.on("close", () => {
      clearInterval(timer);
      session.dispose();
    });
    sock.on("data", (b) => {
      const { text, size } = parser.feed(b);
      if (size && size[0] > 0 && size[1] > 0) session.resize(size[0], size[1]);
      if (text) session.key(text);
    });
    session.paint();
  });
  await new Promise<void>((res, rej) => {
    server.once("error", rej);
    server.listen(o.port ?? 2323, o.host ?? "127.0.0.1", res);
  });
  const addr = server.address();
  return {
    port: typeof addr === "object" && addr ? addr.port : 0,
    close: () =>
      new Promise<void>((res) => {
        sockets.forEach((s) => s.destroy());
        server.close(() => res());
      }),
  };
}
