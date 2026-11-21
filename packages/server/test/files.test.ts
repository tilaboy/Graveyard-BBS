import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LiveSource } from "@graveyard/term";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { makeEnv, startServer } from "./helpers.js";

interface Reply {
  ok: boolean;
  value?: { kind: string; entries?: string[] };
  error?: { code: string };
}

describe("GET /api/files/:thread — the terminal's read-only file view", () => {
  const env = makeEnv();
  const svc = env.open();
  const tok = svc.store.addCaller("sysop-files", "sysop");
  const builder = svc.store.addCaller("builder-files", "builder");
  // The top task's worktree; the stage thread below has no worktree of its own.
  const wt = join(env.config.dataDir, "wt", "arcade-test");
  const outside = mkdtempSync(join(tmpdir(), "gy-outside-"));
  writeFileSync(join(outside, "loot.txt"), "outside");
  mkdirSync(join(wt, ".kiro/specs/arcade-test"), { recursive: true });
  mkdirSync(join(wt, "games/test"), { recursive: true });
  mkdirSync(join(wt, ".git-hooks"), { recursive: true });
  writeFileSync(join(wt, ".git"), "gitdir: /x");
  writeFileSync(
    join(wt, ".kiro/specs/arcade-test/requirements.md"),
    "# Requirements\n\nSpacewar.\n",
  );
  writeFileSync(join(wt, "games/test/index.html"), "<h1>x</h1>");
  writeFileSync(join(wt, ".env"), "SECRET=1");
  writeFileSync(join(wt, "api_token.txt"), "t");
  writeFileSync(join(wt, "server.pem"), "k");
  writeFileSync(join(wt, "blob.bin"), Buffer.from([65, 0, 66]));
  writeFileSync(join(wt, "big.txt"), "a".repeat(256 * 1024 + 1));
  symlinkSync(join(outside, "loot.txt"), join(wt, "escape.txt"));
  symlinkSync(outside, join(wt, "escdir"));
  symlinkSync(join(wt, ".kiro"), join(wt, "kiro-link"));
  let server: Awaited<ReturnType<typeof startServer>>;

  const get = async (thread: string, path: string, token = tok) => {
    const r = await fetch(
      `${server.url}/api/files/${thread}?path=${encodeURIComponent(path)}`,
      { headers: { authorization: `Bearer ${token}` } },
    );
    return { status: r.status, j: (await r.json()) as Reply };
  };

  beforeAll(async () => {
    server = await startServer({ svc, port: 0 });
    const call = (body: object) =>
      fetch(`${server.url}/api/tools/bbs_create_task`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${tok}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(body),
      });
    await call({ thread_id: "arcade-test", text: "Spacewar" });
    await call({
      thread_id: "arcade-test-design",
      text: "design",
      parent: "arcade-test",
    });
    await call({ thread_id: "arcade-empty", text: "no worktree" });
  });
  afterAll(async () => {
    await server.close().catch(() => undefined);
  });

  it("serves a stage thread's file from the top task's worktree, to any caller", async () => {
    for (const t of [tok, builder]) {
      const r = await get(
        "arcade-test-design",
        ".kiro/specs/arcade-test/requirements.md",
        t,
      );
      expect(r.status).toBe(200);
      expect(r.j).toEqual({
        ok: true,
        value: {
          kind: "file",
          path: ".kiro/specs/arcade-test/requirements.md",
          text: "# Requirements\n\nSpacewar.\n",
        },
      });
    }
  });

  it("lists a directory one level, hiding .git and secret names", async () => {
    const r = await get("arcade-test", "games/");
    expect(r.j.value).toEqual({
      kind: "dir",
      path: "games",
      entries: ["test/"],
    });
    const root = await get("arcade-test", "");
    expect(root.j.value?.entries).toEqual([
      ".git-hooks/",
      ".kiro/",
      "big.txt",
      "blob.bin",
      "escape.txt",
      "escdir/",
      "games/",
      "kiro-link/",
    ]);
  });

  it("a symlink that stays inside the worktree is followed", async () => {
    const r = await get(
      "arcade-test",
      "kiro-link/specs/arcade-test/requirements.md",
    );
    expect(r.status).toBe(200);
  });

  it.each([
    ["../../graveyard.db", 403],
    ["games/../../x", 403],
    ["/etc/passwd", 403],
    ["escape.txt", 403],
    ["escdir/loot.txt", 403],
    [".git", 403],
    [".git/config", 403],
    [".graveyard/x", 403],
    [".env", 403],
    [".env.local", 403],
    ["api_token.txt", 403],
    ["my-secrets/a.txt", 403],
    ["server.pem", 403],
    ["id.key", 403],
    ["blob.bin", 415],
    ["big.txt", 413],
    ["nope.md", 404],
  ])("refuses %s with %i", async (path, status) => {
    const r = await get("arcade-test", path);
    expect(r.status, path).toBe(status);
    expect(r.j.ok).toBe(false);
    expect(typeof r.j.error?.code).toBe("string");
  });

  it("LiveSource.readFile goes through the route with the bearer token", async () => {
    const src = new LiveSource({ baseUrl: server.url, token: builder });
    const ok = await src.readFile("arcade-test-design", "games/test/");
    expect(ok).toEqual({
      ok: true,
      value: { kind: "dir", path: "games/test", entries: ["index.html"] },
    });
    const no = await src.readFile("arcade-test", ".env");
    expect(no).toMatchObject({ ok: false, error: { code: "FILE_REFUSED" } });
  });

  it("404s an unknown thread and a task with no worktree; 400 without a path; 401 without a token", async () => {
    expect((await get("arcade-nope", "a.md")).status).toBe(404);
    const none = await get("arcade-empty", "a.md");
    expect(none.status).toBe(404);
    expect(none.j.error?.code).toBe("NOT_FOUND");
    const noPath = await fetch(`${server.url}/api/files/arcade-test`, {
      headers: { authorization: `Bearer ${tok}` },
    });
    expect(noPath.status).toBe(400);
    expect(
      (await fetch(`${server.url}/api/files/arcade-test?path=games/`)).status,
    ).toBe(401);
  });
});
