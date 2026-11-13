import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { toolFail, type ToolError } from "./commands.js";
import { buildTools, type ToolResult } from "./tools.js";

/** Where tool calls go: the running server over HTTP (stdio proxy), or any function (tests). */
export type Backend = (name: string, args: unknown) => Promise<ToolResult>;

const ResultSchema = z.union([
  z.object({ ok: z.literal(true), value: z.unknown() }),
  z.object({
    ok: z.literal(false),
    error: z.object({
      code: z.string(),
      message: z.string(),
      hint: z.string(),
      voice: z.string(),
    }),
  }),
]);

/** Many agents share one server and one log: `graveyard mcp` forwards each call with the caller's token. */
export function httpBackend(baseUrl: string, token: string): Backend {
  return async (name, args) => {
    try {
      const res = await fetch(`${baseUrl}/api/tools/${name}`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(args ?? {}),
      });
      const parsed = ResultSchema.safeParse(await res.json());
      if (!parsed.success)
        return toolFail(
          "DOOR_FAILED",
          `unexpected server reply (HTTP ${res.status})`,
          "Is GRAVEYARD_URL a Graveyard server?",
        );
      return parsed.data as ToolResult;
    } catch (e) {
      return toolFail(
        "DOOR_FAILED",
        `server unreachable: ${e instanceof Error ? e.message : String(e)}`,
        "Start it with `graveyard serve`.",
      );
    }
  };
}

/** R3.2: refusals show the themed box and carry the machine-readable code and hint. */
export function renderError(e: ToolError): string {
  return [
    ` ☠  ACCESS DENIED · ${e.code}  ${e.message}`,
    ` > "${e.voice}"`,
    ` > hint: ${e.hint}`,
    JSON.stringify({
      code: e.code,
      message: e.message,
      hint: e.hint,
      voice: e.voice,
    }),
  ].join("\n");
}

/** R3: the `bbs_*` tools. Names, descriptions and schemas come from `tools.ts`, which builds them from core. */
export function createMcpServer(backend: Backend): McpServer {
  const server = new McpServer({ name: "graveyard", version: "0.1.0" });
  for (const t of buildTools()) {
    server.registerTool(
      t.name,
      { description: t.description, inputSchema: t.schema.shape },
      async (args: unknown) => {
        const r = await backend(t.name, args);
        return r.ok
          ? {
              content: [
                { type: "text" as const, text: JSON.stringify(r.value) },
              ],
            }
          : {
              isError: true,
              content: [{ type: "text" as const, text: renderError(r.error) }],
            };
      },
    );
  }
  return server;
}
