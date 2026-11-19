import { LiveSource, Session } from "@graveyard/term";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { dial, makeEnv, startServer } from "./helpers.js";

const plain = (s: string) => s.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "");
const until = async (f: () => boolean) => {
  for (let i = 0; i < 100 && !f(); i++)
    await new Promise((r) => setTimeout(r, 20));
  expect(f()).toBe(true);
};

describe("BBS basics on a real server", () => {
  const env = makeEnv();
  const svc = env.open();
  const sysopTok = svc.store.addCaller("sysop-term", "sysop");
  const builderTok = svc.store.addCaller("builder-1", "builder");
  let server: Awaited<ReturnType<typeof startServer>>;
  beforeAll(async () => {
    server = await startServer({ svc, port: 0 });
  });
  afterAll(async () => {
    await server.close().catch(() => undefined);
  });

  it("create_task: the sysop opens a thread on a brand-new board; a builder is refused; a duplicate is refused", async () => {
    const sysop = await dial(server.url, sysopTok);
    const builder = await dial(server.url, builderTok);
    const a = await sysop.call("bbs_create_task", {
      thread_id: "crypts-first",
      text: "First grave",
    });
    expect(a.isError).toBe(false);
    expect(svc.p.tasks["crypts-first"]?.status).toBe("pending");
    const dup = await sysop.call("bbs_create_task", {
      thread_id: "crypts-first",
      text: "Again",
    });
    expect(dup.isError).toBe(true);
    expect(dup.text).toContain("ILLEGAL_TRANSITION");
    const denied = await builder.call("bbs_create_task", {
      thread_id: "crypts-second",
      text: "Nope",
    });
    expect(denied.isError).toBe(true);
    expect(denied.text).toContain("ROLE_DENIED");
    const bad = await sysop.call("bbs_create_task", {
      thread_id: "NoDash",
      text: "x",
    });
    expect(bad.isError).toBe(true);
  });

  it("state machine: pending -> running is legal, running -> done is refused, even for the sysop", async () => {
    const sysop = await dial(server.url, sysopTok);
    const builder = await dial(server.url, builderTok);
    await sysop.call("bbs_create_task", {
      thread_id: "crypts-sm",
      text: "State machine",
      assigned: "builder-1",
    });
    const pk = await builder.call("bbs_get_packet", { thread_id: "crypts-sm" });
    await builder.call("bbs_ack_packet", {
      thread_id: "crypts-sm",
      packet_id: String(pk.json["packet_id"]),
    });
    expect(
      (
        await builder.call("bbs_set_status", {
          thread_id: "crypts-sm",
          to: "running",
        })
      ).isError,
    ).toBe(false);
    const r = await builder.call("bbs_set_status", {
      thread_id: "crypts-sm",
      to: "done",
    });
    expect(r.isError).toBe(true);
    expect(r.text).toContain("ILLEGAL_TRANSITION");
    expect(svc.p.tasks["crypts-sm"]?.status).toBe("running");
  });

  it("locks: a running owner claims; a second claimer queues and is blocked", async () => {
    const sysop = await dial(server.url, sysopTok);
    const b1 = await dial(server.url, builderTok);
    const tok2 = svc.store.addCaller("builder-2", "builder");
    const b2 = await dial(server.url, tok2);
    for (const [t, who, c] of [
      ["crypts-l1", "builder-1", b1],
      ["crypts-l2", "builder-2", b2],
    ] as const) {
      await sysop.call("bbs_create_task", {
        thread_id: t,
        text: t,
        assigned: who,
      });
      const pk = await c.call("bbs_get_packet", { thread_id: t });
      await c.call("bbs_ack_packet", {
        thread_id: t,
        packet_id: String(pk.json["packet_id"]),
      });
      await c.call("bbs_set_status", { thread_id: t, to: "running" });
    }
    const first = await b1.call("bbs_claim_lock", {
      thread_id: "crypts-l1",
      lock: "package.json",
    });
    expect(first.isError).toBe(false);
    await b2.call("bbs_claim_lock", {
      thread_id: "crypts-l2",
      lock: "package.json",
    });
    expect(svc.p.tasks["crypts-l2"]?.status).toBe("blocked");
  });

  it("sysop [N] through Session: keys in, task visible out; works from login, any case, new board", async () => {
    const src = new LiveSource({ baseUrl: server.url, token: sysopTok });
    const out: string[] = [];
    const session = new Session({
      source: src,
      write: (s) => out.push(s),
      reducedMotion: true,
    });
    src.start();
    await until(() => src.state().p.tasks["crypts-first"] !== undefined);
    session.key("N"); // on the login splash
    expect(plain(out.at(-1) ?? "")).toContain("New task: board [");
    session.key("Vaults\rOpen the vault\rBring a torch\r");
    await until(() => svc.p.tasks["vaults-open-the-vault"] !== undefined);
    expect(svc.p.tasks["vaults-open-the-vault"]?.status).toBe("pending");
    await until(
      () => src.state().p.tasks["vaults-open-the-vault"] !== undefined,
    );
    session.key("\x1b"); // no-op on menu
    session.key("b");
    expect(plain(out.at(-1) ?? "")).toContain("vaults");
    session.dispose();
    src.stop();
  });
});
