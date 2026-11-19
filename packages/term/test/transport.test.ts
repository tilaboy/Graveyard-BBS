import { mkdtempSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { connect } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildSite } from "../src/build.js";
import { startTelnet, TelnetParser } from "../src/telnet.js";
import { bundleOf, plain, ReplaySource, threeThreads } from "./helpers.js";

describe("task 8 telnet", () => {
  it("strips IAC negotiation and reads the NAWS window size", () => {
    const p = new TelnetParser();
    const r = p.feed(
      Buffer.from([255, 251, 1, 97, 255, 250, 31, 0, 100, 0, 30, 255, 240, 98]),
    );
    expect(r.text).toBe("ab");
    expect(r.size).toEqual([100, 30]);
  });
  it("keeps multibyte characters split across packets", () => {
    const p = new TelnetParser();
    const b = Buffer.from("👻");
    expect(p.feed(b.subarray(0, 2)).text + p.feed(b.subarray(2)).text).toBe(
      "👻",
    );
  });
  it("serves the login and menu screens on a loopback socket", async () => {
    const src = ReplaySource.parse(
      JSON.parse(JSON.stringify(bundleOf(threeThreads()))),
    );
    src.advance(60_000);
    const srv = await startTelnet({ source: src, port: 0 });
    const sock = connect(srv.port, "127.0.0.1");
    let got = "";
    sock.on("data", (d) => (got += d.toString()));
    await new Promise((r) => setTimeout(r, 100));
    expect(plain(got)).toContain("Press any key");
    sock.write("x");
    await new Promise((r) => setTimeout(r, 100));
    expect(plain(got)).toContain("boards tree");
    expect(plain(got)).toContain("REPLAY ×1");
    sock.destroy();
    await srv.close();
  });
});

describe("task 22 judge site build", () => {
  it("writes a static folder: page, client, css, runs index and the bundle", async () => {
    const dir = mkdtempSync(join(tmpdir(), "gy-site-"));
    const bundle = join(dir, "r1.bundle.json");
    writeFileSync(bundle, JSON.stringify(bundleOf(threeThreads(), "r1")));
    const out = join(dir, "site");
    const r = await buildSite({ bundles: [dir], out });
    expect(r.runs).toEqual(["r1"]);
    for (const f of [
      "index.html",
      "client.js",
      "xterm.css",
      "runs/r1.bundle.json",
      "runs/index.json",
    ])
      expect(existsSync(join(out, f)), f).toBe(true);
    expect(readFileSync(join(out, "index.html"), "utf8")).toContain(
      'data-mode="replay"',
    );
    expect(
      JSON.parse(readFileSync(join(out, "runs/index.json"), "utf8")),
    ).toEqual([{ runId: "r1", file: "runs/r1.bundle.json" }]);
    // No server calls, no third-party hosts in the shipped page.
    expect(readFileSync(join(out, "index.html"), "utf8")).not.toMatch(
      /https?:\/\//,
    );
  }, 30_000);
  it("refuses a malformed bundle", async () => {
    const dir = mkdtempSync(join(tmpdir(), "gy-site-"));
    writeFileSync(
      join(dir, "bad.bundle.json"),
      '{"runId":"x","events":[{"a":1}]}',
    );
    await expect(
      buildSite({ bundles: [dir], out: join(dir, "o") }),
    ).rejects.toThrow();
  });
});
