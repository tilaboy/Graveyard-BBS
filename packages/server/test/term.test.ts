import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LiveSource, Session } from "@graveyard/term";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { dial, makeEnv, startServer } from "./helpers.js";

const plain = (s: string) => s.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "");
const until = async (f: () => boolean) => {
  for (let i = 0; i < 100 && !f(); i++)
    await new Promise((r) => setTimeout(r, 20));
  expect(f()).toBe(true);
};

describe("spec 04: the terminal on a real server", () => {
  const env = makeEnv();
  const svc = env.open();
  const sysopTok = svc.store.addCaller("sysop-term", "sysop");
  const builderTok = svc.store.addCaller("builder-1", "builder");
  const termDir = mkdtempSync(join(tmpdir(), "gy-termdir-"));
  writeFileSync(join(termDir, "index.html"), "<title>Graveyard BBS</title>");
  writeFileSync(join(termDir, "client.js"), "//js");
  mkdirSync(join(env.config.dataDir, "published/games/snake"), {
    recursive: true,
  });
  writeFileSync(
    join(env.config.dataDir, "published/games/snake/index.html"),
    "<h1>snake</h1>",
  );
  let server: Awaited<ReturnType<typeof startServer>>;
  let source: LiveSource;

  beforeAll(async () => {
    server = await startServer({ svc, port: 0, termDir });
  });
  afterAll(async () => {
    source?.stop();
    await server.close().catch(() => undefined);
  });

  it("serves the page, the client and published games; refuses path escapes", async () => {
    const page = await fetch(`${server.url}/term/`);
    expect(page.status).toBe(200);
    expect(page.headers.get("content-type")).toContain("text/html");
    expect(page.headers.get("content-security-policy")).toContain(
      "default-src 'self'",
    );
    expect(await page.text()).toContain("Graveyard BBS");
    expect(
      (await fetch(`${server.url}/term/client.js`)).headers.get("content-type"),
    ).toContain("javascript");
    expect(
      (await fetch(`${server.url}/term`, { redirect: "manual" })).status,
    ).toBe(302);
    expect(
      await (
        await fetch(`${server.url}/published/games/snake/index.html`)
      ).text(),
    ).toBe("<h1>snake</h1>");
    for (const bad of [
      "/term/..%2f..%2fpackage.json",
      "/term/%2e%2e/%2e%2e/x",
      "/published/..%2fgraveyard.db",
      "/term/nope.js",
    ])
      expect((await fetch(`${server.url}${bad}`)).status, bad).toBe(404);
    expect((await fetch(`${server.url}/api/threads`)).status).toBe(401); // the API still needs a token
  });

  it("LiveSource + Session: live status, ASK summons, answer, and a refused force-done", async () => {
    const sysop = await dial(server.url, sysopTok);
    const builder = await dial(server.url, builderTok);
    await sysop.call("bbs_create_task", {
      thread_id: "websites-live",
      text: "Haunted page",
      assigned: "builder-1",
    });
    const pk = await builder.call("bbs_get_packet", {
      thread_id: "websites-live",
    });
    await builder.call("bbs_ack_packet", {
      thread_id: "websites-live",
      packet_id: String(pk.json["packet_id"]),
    });
    await builder.call("bbs_set_status", {
      thread_id: "websites-live",
      to: "running",
    });

    source = new LiveSource({ baseUrl: server.url, token: sysopTok });
    const out: string[] = [];
    const session = new Session({
      source,
      write: (s) => out.push(s),
      reducedMotion: true,
    });
    source.start();
    await until(
      () => source.state().p.tasks["websites-live"]?.status === "running",
    );
    const screen = () => plain(out.at(-1) ?? "");

    session.key("x"); // leave login
    session.key("b\r"); // boards → #websites threads
    expect(screen()).toContain("running");
    session.key("\r"); // open the thread
    session.key("x"); // force done
    await until(() => screen().includes("ACCESS DENIED"));
    expect(screen()).toContain("ILLEGAL_TRANSITION  running → done");
    expect(screen()).toContain(
      "Not even the Sysop may raise the dead without a review.",
    );
    expect(svc.p.tasks["websites-live"]?.status).toBe("running");
    session.key("q"); // close the box

    // The agent asks; the feed shows the badge flip to blocked and the ASK in the Sysop queue.
    await builder.call("bbs_ask", {
      thread_id: "websites-live",
      text: "Dark theme or blood-red?",
    });
    await until(
      () => source.state().p.tasks["websites-live"]?.status === "blocked",
    );
    session.key("\x1b\x1b\x1b");
    session.key("s");
    expect(screen()).toContain("Dark theme or blood-red?");
    session.key("aBlood red\r");
    await until(
      () => source.state().p.tasks["websites-live"]?.status === "running",
    );
    expect(svc.p.tasks["websites-live"]?.answered).toHaveLength(1);
    session.dispose();
  });

  it("[N] new task: the Sysop types board, title, body; the server creates a pending thread", async () => {
    const src = new LiveSource({ baseUrl: server.url, token: sysopTok });
    const out: string[] = [];
    const session = new Session({
      source: src,
      write: (s) => out.push(s),
      reducedMotion: true,
    });
    src.start();
    session.key("xn"); // leave login, new task
    session.key("websites\rOpen the crypt\rBring candles\x13");
    await until(() => svc.p.tasks["websites-open-the-crypt"] !== undefined);
    expect(svc.p.tasks["websites-open-the-crypt"]?.status).toBe("pending");
    expect(svc.p.tasks["websites-open-the-crypt"]?.text).toBe(
      "Open the crypt — Bring candles",
    );
    await until(() =>
      plain(out.at(-1) ?? "").includes("Created websites-open"),
    );
    session.dispose();
    src.stop();
  });

  it("[N] new task by a non-Sysop is refused with ACCESS DENIED", async () => {
    const src = new LiveSource({ baseUrl: server.url, token: builderTok });
    const out: string[] = [];
    const session = new Session({
      source: src,
      write: (s) => out.push(s),
      reducedMotion: true,
    });
    session.key("xn");
    session.key("websites\rNot allowed\x13");
    await until(() => plain(out.at(-1) ?? "").includes("ACCESS DENIED"));
    expect(plain(out.at(-1) ?? "")).toContain("ROLE_DENIED");
    expect(svc.p.tasks["websites-not-allowed"]).toBeUndefined();
    session.dispose();
    src.stop();
  });
});
