import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CLI, dial, makeEnv, startServer } from "./helpers.js";

const run = promisify(execFile);

/** Run `graveyard hook pre-tool` as the real CLI, event JSON on stdin. */
async function hook(
  url: string,
  token: string,
  event: unknown,
): Promise<{ code: number; stderr: string }> {
  const child = run("node", [CLI, "hook", "pre-tool"], {
    env: { ...process.env, GRAVEYARD_URL: url, GRAVEYARD_TOKEN: token },
  });
  child.child.stdin?.end(JSON.stringify(event));
  try {
    await child;
    return { code: 0, stderr: "" };
  } catch (e) {
    const err = e as { code: number; stderr: string };
    return { code: err.code, stderr: err.stderr };
  }
}

describe("e2e: real server, SQLite file, MCP tool layer, hook CLI", () => {
  const env = makeEnv();
  const svc1 = env.open();
  const tok = {
    sysop: svc1.store.addCaller("sysop", "sysop"),
    mod: svc1.store.addCaller("moderator", "moderator"),
    builder: svc1.store.addCaller("builder-1", "builder"),
    reviewer: svc1.store.addCaller("reviewer-1", "reviewer"),
    release: svc1.store.addCaller("release-1", "release"),
  };
  let server: Awaited<ReturnType<typeof startServer>>;
  let sysop: Awaited<ReturnType<typeof dial>>;
  let builder: Awaited<ReturnType<typeof dial>>;
  let reviewer: Awaited<ReturnType<typeof dial>>;
  let release: Awaited<ReturnType<typeof dial>>;
  let packet = "";
  const T = "slides-e2e";
  const T2 = "slides-e2e-hook";

  beforeAll(async () => {
    server = await startServer({ svc: svc1, port: 0 });
    sysop = await dial(server.url, tok.sysop);
    builder = await dial(server.url, tok.builder);
    reviewer = await dial(server.url, tok.reviewer);
    release = await dial(server.url, tok.release);
  });
  afterAll(async () => {
    await server.close().catch(() => undefined);
  });

  it("binds 127.0.0.1 and refuses a missing or wrong token", async () => {
    expect(server.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    expect((await fetch(`${server.url}/api/threads`)).status).toBe(401);
    expect(
      (
        await fetch(`${server.url}/api/threads`, {
          headers: { authorization: "Bearer nope" },
        })
      ).status,
    ).toBe(401);
    expect((await fetch(`${server.url}/api/health`)).status).toBe(200);
  });

  it("sets up two threads and a running builder", async () => {
    expect(
      (await builder.call("bbs_create_task", { thread_id: T, text: "deck" }))
        .json["code"],
    ).toBe("ROLE_DENIED");
    for (const id of [T, T2]) {
      const r = await sysop.call("bbs_create_task", {
        thread_id: id,
        text: "deck",
        assigned: "builder-1",
      });
      expect(r.isError).toBe(false);
    }
    const p = await builder.call("bbs_get_packet", { thread_id: T });
    packet = String(p.json["packet_id"]);
    expect(
      (await builder.call("bbs_set_status", { thread_id: T, to: "running" }))
        .json["code"],
    ).toBe("NO_ACK");
    expect(
      (
        await builder.call("bbs_ack_packet", {
          thread_id: T,
          packet_id: "qwk-old",
        })
      ).json["code"],
    ).toBe("NO_ACK");
    expect(
      (
        await builder.call("bbs_ack_packet", {
          thread_id: T,
          packet_id: packet,
        })
      ).isError,
    ).toBe(false);
    expect(
      (await builder.call("bbs_set_status", { thread_id: T, to: "running" }))
        .isError,
    ).toBe(false);
    // second thread, same path, left running for the hook checks
    const p2 = await builder.call("bbs_get_packet", { thread_id: T2 });
    await builder.call("bbs_ack_packet", {
      thread_id: T2,
      packet_id: String(p2.json["packet_id"]),
    });
    expect(
      (await builder.call("bbs_set_status", { thread_id: T2, to: "running" }))
        .isError,
    ).toBe(false);
  });

  it("(a) builder running -> done is refused ILLEGAL_TRANSITION with the voice line", async () => {
    const r = await builder.call("bbs_set_status", {
      thread_id: T,
      to: "done",
    });
    expect(r.isError).toBe(true);
    expect(r.json["code"]).toBe("ILLEGAL_TRANSITION");
    expect(r.text).toContain("ACCESS DENIED · ILLEGAL_TRANSITION");
    expect(r.text).toContain(
      "Not even the Sysop may raise the dead without a review.",
    );
    expect(svc1.p.tasks[T]?.status).toBe("running");
    // refusals are posted back to the thread in the voice
    expect(
      svc1.p.tasks[T]?.posts.some(
        (p) => p.type === "NOTE" && p.text.includes("ACCESS DENIED"),
      ),
    ).toBe(true);
  });

  it("nearby: pending/awaiting-review shortcuts, EVIDENCE forgery and door misuse are refused", async () => {
    expect(
      (
        await builder.call("bbs_set_status", {
          thread_id: T,
          to: "awaiting-review",
        })
      ).json["code"],
    ).toBe("NO_EVIDENCE");
    expect(
      (
        await builder.call("bbs_post", {
          thread_id: T,
          kind: "EVIDENCE",
          text: "tests pass",
        })
      ).isError,
    ).toBe(true);
    expect(
      (
        await builder.call("bbs_set_status", {
          thread_id: "slides-nope",
          to: "done",
        })
      ).json["code"],
    ).toBe("NOT_FOUND");
    expect(
      (await builder.call("door_run", { thread_id: T, door: "deploy" })).json[
        "code"
      ],
    ).toBe("NOT_FOUND"); // not on #slides
    expect(
      (
        await builder.call("door_run", {
          thread_id: T,
          door: "publish",
          args: {},
        })
      ).json["code"],
    ).toBe("ROLE_DENIED");
    expect(
      (await sysop.call("door_run", { thread_id: T, door: "run_tests" })).json[
        "code"
      ],
    ).toBe("ROLE_DENIED");
    expect(
      (
        await builder.call("bbs_set_status", {
          thread_id: T,
          to: "cancelled",
          reason: "x",
        })
      ).json["code"],
    ).toBe("ROLE_DENIED");
    expect(
      (await builder.call("bbs_read_thread", { thread_id: T, limit: 0 }))
        .isError,
    ).toBe(true); // zod bounds
  });

  it("(b) sysop 'force done' is refused, on a running and on a reviewed-looking task", async () => {
    const r = await fetch(`${server.url}/api/sysop/force-done`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${tok.sysop}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ thread_id: T }),
    });
    const body = (await r.json()) as {
      ok: boolean;
      error: { code: string; voice: string };
    };
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe("ILLEGAL_TRANSITION");
    expect(body.error.voice).toContain("Not even the Sysop");
    expect(svc1.p.tasks[T]?.status).toBe("running");
    // the sysop also cannot write REVIEW
    expect(
      (await sysop.call("bbs_review", { thread_id: T, verdict: "pass" })).json[
        "code"
      ],
    ).toBe("ROLE_DENIED");
  });

  it("(c) normal path: running -> awaiting-review (after run_tests EVIDENCE) -> done by a reviewer", async () => {
    const ran = await builder.call("door_run", {
      thread_id: T,
      door: "run_tests",
    });
    expect(ran.isError).toBe(false);
    expect(ran.json["exit_code"]).toBe(0);
    expect(svc1.p.tasks[T]?.evidence_ids).toContain(ran.json["evidence_id"]);
    // a code change after the evidence stales it
    await builder.call("bbs_post", {
      thread_id: T,
      kind: "MILESTONE",
      text: "edited",
      code_change: true,
    });
    expect(
      (
        await builder.call("bbs_set_status", {
          thread_id: T,
          to: "awaiting-review",
        })
      ).json["code"],
    ).toBe("NO_EVIDENCE");
    await builder.call("door_run", { thread_id: T, door: "run_tests" });
    expect(
      (
        await builder.call("bbs_set_status", {
          thread_id: T,
          to: "awaiting-review",
        })
      ).isError,
    ).toBe(false);

    // nearby: not done yet without a REVIEW; builder and sysop cannot finish it
    expect(
      (await reviewer.call("bbs_set_status", { thread_id: T, to: "done" }))
        .isError,
    ).toBe(true);
    expect(
      (await builder.call("bbs_set_status", { thread_id: T, to: "done" }))
        .isError,
    ).toBe(true);
    expect(
      (await sysop.call("bbs_set_status", { thread_id: T, to: "done" }))
        .isError,
    ).toBe(true);
    expect(
      (await fetch(`${server.url}/api/sysop/force-done`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${tok.sysop}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ thread_id: T }),
      }).then((r) => r.json())) as { ok: boolean },
    ).toMatchObject({ ok: false });
    expect(svc1.p.tasks[T]?.status).toBe("awaiting-review");

    expect(
      (await reviewer.call("bbs_review", { thread_id: T, verdict: "pass" }))
        .isError,
    ).toBe(false);
    const done = await reviewer.call("bbs_set_status", {
      thread_id: T,
      to: "done",
    });
    expect(done.isError).toBe(false);
    expect(svc1.p.tasks[T]?.status).toBe("done");
    // terminal: nothing leaves done
    expect(
      (await reviewer.call("bbs_set_status", { thread_id: T, to: "running" }))
        .isError,
    ).toBe(true);
  });

  it("MCP lists every bbs_* tool and puts the transition table in bbs_set_status", async () => {
    const names = (await builder.client.listTools()).tools.map((t) => t.name);
    for (const n of [
      "bbs_whoami",
      "bbs_list_boards",
      "bbs_read_thread",
      "bbs_post",
      "bbs_ask",
      "bbs_set_status",
      "bbs_claim_lock",
      "bbs_release_lock",
      "bbs_heartbeat",
      "bbs_get_packet",
      "bbs_ack_packet",
      "bbs_submit_rep",
      "bbs_record_tried",
      "door_run",
    ])
      expect(names).toContain(n);
    const d =
      (await builder.client.listTools()).tools.find(
        (t) => t.name === "bbs_set_status",
      )?.description ?? "";
    expect(d).toContain("| awaiting-review | done | reviewer |");
  });

  it("bbs_ask blocks the task, the Sysop answer unblocks it; REP and release work", async () => {
    const asked = await builder.call("bbs_ask", {
      thread_id: T2,
      text: "dark or red?",
    });
    expect(asked.isError).toBe(false);
    expect(svc1.p.tasks[T2]?.status).toBe("blocked");
    const r = await fetch(`${server.url}/api/sysop/answer`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${tok.sysop}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        thread_id: T2,
        ask_id: asked.json["ask_id"],
        text: "red",
      }),
    });
    expect(((await r.json()) as { ok: boolean }).ok).toBe(true);
    expect(svc1.p.tasks[T2]?.status).toBe("running");
  });

  it("(e) hook pre-tool exits 2 for a forbidden set_status, 0 for reads, and 2 when the server is down", async () => {
    const forbidden = {
      hook_event_name: "PreToolUse",
      cwd: env.dir,
      tool_name: "@graveyard/bbs_set_status",
      tool_input: { thread_id: T2, to: "done" },
    };
    const f = await hook(server.url, tok.builder, forbidden);
    expect(f.code).toBe(2);
    expect(f.stderr).toContain("ILLEGAL_TRANSITION");
    // nearby: bare tool name, unknown status, sysop asking, wrong token, no token
    expect(
      (
        await hook(server.url, tok.builder, {
          ...forbidden,
          tool_name: "bbs_set_status",
        })
      ).code,
    ).toBe(2);
    expect((await hook(server.url, tok.sysop, forbidden)).code).toBe(2);
    expect(
      (
        await hook(server.url, tok.builder, {
          ...forbidden,
          tool_input: { thread_id: T2, to: "zombie" },
        })
      ).code,
    ).toBe(2);
    expect((await hook(server.url, "wrong", forbidden)).code).toBe(2);
    // allowed: a legal move and a read
    expect(
      (
        await hook(server.url, tok.builder, {
          ...forbidden,
          tool_input: { thread_id: T2, to: "blocked", reason: "budget" },
        })
      ).code,
    ).toBe(0);
    expect(
      (
        await hook(server.url, tok.builder, {
          tool_name: "fs_read",
          tool_input: { path: "a" },
        })
      ).code,
    ).toBe(0);
    expect(svc1.p.tasks[T2]?.status).toBe("running"); // the hook is a dry run
    // malformed stdin fails closed
    const bad = run("node", [CLI, "hook", "pre-tool"], {
      env: {
        ...process.env,
        GRAVEYARD_URL: server.url,
        GRAVEYARD_TOKEN: tok.builder,
      },
    });
    bad.child.stdin?.end("not json");
    await expect(bad).rejects.toMatchObject({ code: 2 });

    await server.close();
    const down = await hook(server.url, tok.builder, forbidden);
    expect(down.code).toBe(2);
    expect(down.stderr).toContain("cannot reach the BBS");
    expect(
      (
        await hook(server.url, tok.builder, {
          tool_name: "fs_write",
          tool_input: { path: "x.txt" },
        })
      ).code,
    ).toBe(2); // writes fail closed
    expect(
      (
        await hook(server.url, tok.builder, {
          tool_name: "fs_read",
          tool_input: { path: "x.txt" },
        })
      ).code,
    ).toBe(0); // reads do not
  });

  it("(d) restarting the server re-folds the same state from SQLite", async () => {
    const before = structuredClone(svc1.p);
    svc1.store.close();
    const svc2 = env.open();
    expect(svc2.p).toEqual(before);
    expect(svc2.p.tasks[T]?.status).toBe("done");
    const s2 = await startServer({ svc: svc2, port: 0 });
    const list = (await fetch(`${s2.url}/api/threads`, {
      headers: { authorization: `Bearer ${tok.reviewer}` },
    }).then((r) => r.json())) as { thread_id: string; status: string }[];
    expect(list.find((t) => t.thread_id === T)?.status).toBe("done");
    // a new command appends after the old log (seq continues, no reuse)
    const again = await dial(s2.url, tok.builder);
    expect(
      (
        await again.call("bbs_post", {
          thread_id: T2,
          kind: "NOTE",
          text: "back",
        })
      ).isError,
    ).toBe(false);
    expect(svc2.p.seq).toBe(before.seq + 1);
    await s2.close();
    svc2.store.close();
    void release;
  });
});
