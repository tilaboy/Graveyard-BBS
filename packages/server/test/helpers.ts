import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { startServer } from "../src/api.js";
import { loadBoards } from "../src/boards.js";
import { Service } from "../src/commands.js";
import { loadConfig, type Config } from "../src/config.js";
import { createMcpServer, httpBackend } from "../src/mcp.js";
import { createDemoRepo } from "../src/seed.js";
import { Store } from "../src/store.js";

export const REPO_ROOT = resolve(import.meta.dirname, "../../..");
export const CLI = join(REPO_ROOT, "packages/server/bin/graveyard.mjs");

export interface Env {
  dir: string;
  db: string;
  config: Config;
  open(): Service;
}

/** Temp git repo + temp SQLite file; boards come from this checkout's steering files. */
export function makeEnv(overrides: Partial<Config> = {}): Env {
  const dir = mkdtempSync(join(tmpdir(), "gy-"));
  const repo = join(dir, "repo");
  createDemoRepo(repo);
  const config = loadConfig(dir, {
    repo,
    dataDir: join(dir, "data"),
    boardsDir: join(REPO_ROOT, ".kiro/steering/boards"),
    testCommand: "npm test --silent",
    port: 0,
    ...overrides,
  });
  const db = join(dir, "graveyard.db");
  return {
    dir,
    db,
    config,
    open: () =>
      new Service(new Store(db), config, loadBoards(config.boardsDir)),
  };
}

export interface Reply {
  isError: boolean;
  text: string;
  json: Record<string, unknown>;
}

/** An MCP client wired (in memory) to the real MCP layer, which forwards to the real HTTP server. */
export async function dial(url: string, token: string) {
  const [a, b] = InMemoryTransport.createLinkedPair();
  await createMcpServer(httpBackend(url, token)).connect(b);
  const client = new Client({ name: "test", version: "0" });
  await client.connect(a);
  return {
    client,
    async call(
      name: string,
      args: Record<string, unknown> = {},
    ): Promise<Reply> {
      const r = await client.callTool({ name, arguments: args });
      const first = (r.content as { type: string; text: string }[])[0];
      const text = first?.text ?? "";
      // success: the whole text is JSON; error: the last line is JSON.
      const jsonLine = r.isError ? (text.split("\n").at(-1) ?? "{}") : text;
      let json: Record<string, unknown> = {};
      try {
        json = JSON.parse(jsonLine) as Record<string, unknown>;
      } catch {
        /* SDK-level input validation errors are plain text */
      }
      return { isError: Boolean(r.isError), text, json };
    },
  };
}

export { startServer };
