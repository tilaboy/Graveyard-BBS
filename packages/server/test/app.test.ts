import { spawnSync } from "node:child_process";
import { createHash, createHmac } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { syncApp } from "../src/sync-app.js";
import { REPO_ROOT } from "./helpers.js";

const APP = join(REPO_ROOT, "app");
const manifest = JSON.parse(readFileSync(join(APP, "app.json"), "utf8")) as {
  iconPath: string;
  agents: string[];
  mcpServers: Record<string, { args: string[] }>;
  ui: { entry: string };
  backend: { entryPoint: string };
  crons: { agent: string }[];
};

const py = (code: string, env: Record<string, string> = {}) =>
  spawnSync("python3", ["-c", code], {
    cwd: join(APP, "backend"),
    env: { ...process.env, ...env },
    encoding: "utf8",
  });

describe("Kiro Crew app (spec 05)", () => {
  it("R1.3: every path the manifest references exists in app/", () => {
    const paths = [
      manifest.iconPath,
      ...manifest.agents,
      join("ui", manifest.ui.entry),
      manifest.backend.entryPoint,
      ...Object.values(manifest.mcpServers).map((s) => s.args[0] as string),
    ];
    for (const p of paths) expect(existsSync(join(APP, p)), p).toBe(true);
  });

  it("R4.1/R6.1: five agents, and the cron names one of them", () => {
    const names = manifest.agents.map(
      (a) =>
        (JSON.parse(readFileSync(join(APP, a), "utf8")) as { name: string })
          .name,
    );
    expect(names).toHaveLength(5);
    expect(names).toContain(manifest.crons[0]?.agent);
  });

  it("R4.2: app/agents and app/steering match .kiro", () => {
    expect(syncApp(REPO_ROOT, true)).toEqual([]);
  });

  it("agents register in Kiro Crew: parse, have fields, no {PLACEHOLDER}", () => {
    // Crew renders {NAME} only for builtin apps and skips an agent that holds one.
    for (const a of manifest.agents) {
      const text = readFileSync(join(APP, a), "utf8");
      const agent = JSON.parse(text) as Record<string, unknown>;
      for (const k of ["name", "description", "prompt"])
        expect(typeof agent[k], `${a} ${k}`).toBe("string");
      expect(text, a).not.toMatch(/\{[A-Z][A-Z0-9_]*\}/);
      expect(agent.resources, a).toBeUndefined();
    }
  });

  it("R7.2: the launcher explains itself when the checkout is missing", () => {
    const home = mkdtempSync(join(tmpdir(), "gy-home-"));
    const r = py("import gy; gy.command(['mcp'])", {
      PYTHONPATH: join(APP, "bin"),
      HOME: home,
      GRAVEYARD_HOME: "",
    });
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain("GRAVEYARD_HOME");
  });

  it("agents' MCP reaches the app's own BBS: the URL the backend records wins, junk is ignored", () => {
    // A throwaway checkout, so the test never rewrites the real app's URL file.
    const fake = mkdtempSync(join(tmpdir(), "gy-url-"));
    mkdirSync(join(fake, "packages/server/bin"), { recursive: true });
    writeFileSync(join(fake, "packages/server/bin/graveyard.mjs"), "");
    const run = (written: string) =>
      py(
        `import gy, json
gy.write_url(${JSON.stringify(written)})
print(json.dumps(gy.bbs_env().get("GRAVEYARD_URL")))`,
        {
          PYTHONPATH: join(APP, "bin"),
          GRAVEYARD_HOME: fake,
          GRAVEYARD_URL: "http://127.0.0.1:2626",
        },
      ).stdout.trim();
    expect(run("http://127.0.0.1:49163")).toBe('"http://127.0.0.1:49163"');
    expect(run("")).toBe('"http://127.0.0.1:2626"');
    expect(run("http://evil.example:80")).toBe('"http://127.0.0.1:2626"');
  });

  it("R7.1: the launcher runs the server from GRAVEYARD_HOME", () => {
    const r = py("import gy; print(gy.command(['mcp'])[1][-2:])", {
      PYTHONPATH: join(APP, "bin"),
      GRAVEYARD_HOME: REPO_ROOT,
    });
    expect(r.stdout).toContain("graveyard.mjs");
    expect(r.stdout).toContain("'mcp'");
  });

  it("the page's fetch path reaches a backend route through the gateway proxy", () => {
    // A process backend (backend.entryPoint) is reached only through the
    // gateway proxy /apps/<name>/api/<p>, which forwards /api/<p>.
    // /api/apps/<name>/ is the in-gateway hooks namespace and answers 404 here.
    const ui = readFileSync(join(APP, "ui", "index.mjs"), "utf8");
    const url = /\.get\("([^"]+)"\)/.exec(ui)?.[1] ?? "";
    expect(url).toBe("/apps/graveyard-bbs/api/launch");
    expect(ui).not.toContain("/api/apps/");
    const api = (manifest as unknown as { permissions: { api: string[] } })
      .permissions.api;
    expect(api).toEqual(["/apps/graveyard-bbs/api"]);
    expect(url.startsWith(api[0] + "/")).toBe(true);
    const backendPath = url.replace("/apps/graveyard-bbs/api", "/api");
    const secret = "s3cret";
    const nonce = "b".repeat(32);
    const ts = Math.floor(Date.now() / 1000);
    const sig = createHmac("sha256", secret)
      .update(
        `v2:${ts}:${nonce}:GET:${backendPath}:${createHash("sha256").update("").digest("hex")}`,
      )
      .digest("hex");
    const r = py(
      `import server
from http.server import HTTPServer
import threading, urllib.request
server.verifier = server.ProxyV2("${secret}")
s = HTTPServer(("127.0.0.1", 0), server.Handler)
threading.Thread(target=s.serve_forever, daemon=True).start()
q = urllib.request.Request("http://127.0.0.1:%d${backendPath}" % s.server_port, headers={"X-KiroCrew-Proxy-V2": "${ts}:${sig}", "X-KiroCrew-Proxy-Nonce": "${nonce}"})
print(urllib.request.urlopen(q).read().decode())`,
      { PYTHONPATH: join(APP, "bin") },
    );
    expect(r.stdout).toContain('"url"');
  });

  it("the launch route answers whichever prefix the gateway forwards", () => {
    const secret = "s3cret";
    const ts = Math.floor(Date.now() / 1000);
    for (const [i, path] of [
      "/launch",
      "/api/launch",
      "/api/apps/graveyard-bbs/launch",
    ].entries()) {
      const nonce = String(i).repeat(32);
      const sig = createHmac("sha256", secret)
        .update(
          `v2:${ts}:${nonce}:GET:${path}:${createHash("sha256").update("").digest("hex")}`,
        )
        .digest("hex");
      const r = py(
        `import server
from http.server import HTTPServer
import threading, urllib.request
server.verifier = server.ProxyV2("${secret}")
s = HTTPServer(("127.0.0.1", 0), server.Handler)
threading.Thread(target=s.serve_forever, daemon=True).start()
q = urllib.request.Request("http://127.0.0.1:%d${path}" % s.server_port, headers={"X-KiroCrew-Proxy-V2": "${ts}:${sig}", "X-KiroCrew-Proxy-Nonce": "${nonce}"})
print(urllib.request.urlopen(q).read().decode())`,
        { PYTHONPATH: join(APP, "bin") },
      );
      expect(r.stdout, path).toContain('"url"');
    }
  });

  describe("R3.3: proxy signature", () => {
    const secret = "s3cret";
    const nonce = "a".repeat(32);
    const sign = (ts: number, target: string, body = "") =>
      `${ts}:${createHmac("sha256", secret)
        .update(
          `v2:${ts}:${nonce}:GET:${target}:${createHash("sha256").update(body).digest("hex")}`,
        )
        .digest("hex")}`;
    const check = (sig: string, twice = false) => {
      const r = py(
        `import server, time
v = server.ProxyV2("${secret}")
a = lambda: v.verify("GET", "/x", b"", "${sig}", "${nonce}")
print(a(), a() if ${twice ? "True" : "False"} else "")`,
        { PYTHONPATH: join(APP, "bin") },
      );
      return r.stdout.trim();
    };
    const now = Math.floor(Date.now() / 1000);

    it("accepts a fresh signature once, refuses its replay", () => {
      expect(check(sign(now, "/x"), true)).toBe("True False");
    });
    it("refuses a wrong target and a stale timestamp", () => {
      expect(check(sign(now, "/y"))).toBe("False");
      expect(check(sign(now - 120, "/x"))).toBe("False");
    });
  });
});
