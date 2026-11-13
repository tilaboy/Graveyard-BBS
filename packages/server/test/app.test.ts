import { spawnSync } from "node:child_process";
import { createHash, createHmac } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
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

  it("R7.1: the launcher runs the server from GRAVEYARD_HOME", () => {
    const r = py("import gy; print(gy.command(['mcp'])[1][-2:])", {
      PYTHONPATH: join(APP, "bin"),
      GRAVEYARD_HOME: REPO_ROOT,
    });
    expect(r.stdout).toContain("graveyard.mjs");
    expect(r.stdout).toContain("'mcp'");
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
