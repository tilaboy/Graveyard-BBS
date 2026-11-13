import websocket from "@fastify/websocket";
import Fastify, { type FastifyReply, type FastifyRequest } from "fastify";
import { z } from "zod";
import type { Event } from "@graveyard/core";
import { toolFail, type Service } from "./commands.js";
import { defaultDoors } from "./doors/index.js";
import type { RegisteredDoor } from "./doors/types.js";
import { checkPreTool, HookEventSchema, recordStop } from "./hooks.js";
import * as sysop from "./sysop.js";
import { buildTools, callTool, type ToolCtx, type ToolResult } from "./tools.js";
import type { CallerRow } from "./store.js";

export interface ServerOptions {
  svc: Service;
  doors?: RegisteredDoor[];
  /** Always loopback unless a test says otherwise (tech.md). */
  host?: string;
  port?: number;
  tickMs?: number;
  chaos?: boolean;
}

const send = (reply: FastifyReply, r: ToolResult) => reply.send(r);

/** R6: HTTP + WebSocket. MCP (stdio) proxies to `POST /api/tools/:name`; hooks use `/api/hook/*`. */
export async function startServer(opts: ServerOptions) {
  const { svc } = opts;
  const doors = opts.doors ?? defaultDoors();
  const tools = buildTools();
  const app = Fastify({ logger: false });
  await app.register(websocket);

  // R2.2: every /api request carries the caller's secret; the caller is looked up by its hash.
  const authOf = (req: FastifyRequest): CallerRow | undefined => {
    const h = req.headers.authorization;
    const q = z.object({ token: z.string() }).safeParse(req.query);
    const secret = h?.startsWith("Bearer ") ? h.slice(7) : q.success ? q.data.token : undefined;
    return secret ? svc.store.callerBySecret(secret) : undefined;
  };
  const ctxOf = (c: CallerRow): ToolCtx => ({ svc, doors, actor: { handle: c.handle, role: c.role } });

  app.get("/api/health", async () => ({ ok: true }));

  app.addHook("preHandler", async (req, reply) => {
    if (req.url.startsWith("/api/") && req.url !== "/api/health" && !authOf(req))
      return reply.code(401).send(toolFail("UNAUTHENTICATED", "missing or unknown token", "Set GRAVEYARD_TOKEN to a token from `graveyard caller add`."));
    return undefined;
  });

  app.get("/api/tools", async () =>
    tools.map((t) => ({ name: t.name, description: t.description, inputSchema: z.toJSONSchema(t.schema) })),
  );
  app.post("/api/tools/:name", async (req, reply) => {
    const { name } = z.object({ name: z.string() }).parse(req.params);
    return send(reply, await callTool(tools, ctxOf(authOf(req)!), name, req.body));
  });

  app.get("/api/threads", async () => Object.values(svc.p.tasks).map((t) => ({ thread_id: t.thread_id, status: t.status, owner: t.owner ?? null, reason: t.reason ?? null, text: t.text })));
  app.get("/api/events", async (req) => {
    const after = z.coerce.number().int().nonnegative().catch(0).parse((req.query as Record<string, unknown>)["after"]);
    return svc.store.events(after);
  });

  // R6.1: live feed. `?after=<seq>` replays what the client missed first.
  app.get("/ws", { websocket: true }, (socket, req) => {
    if (!authOf(req)) return socket.close(4401, "unauthenticated");
    const after = z.coerce.number().int().nonnegative().catch(0).parse((req.query as Record<string, unknown>)["after"]);
    const push = (e: Event) => socket.send(JSON.stringify(e));
    svc.store.events(after).forEach(push);
    const off = svc.onEvent(push);
    socket.on("close", off);
    return undefined;
  });

  // R6.2 Sysop endpoints.
  const sysopRoute = <S extends z.ZodType>(
    path: string,
    schema: S,
    fn: (actor: ToolCtx["actor"], b: z.infer<S>) => ToolResult,
  ) =>
    app.post(`/api/sysop/${path}`, async (req, reply) => {
      const c = authOf(req)!;
      const b = schema.safeParse(req.body);
      if (!b.success) return reply.code(400).send(toolFail("BAD_ARGS", b.error.issues.map((i) => i.message).join("; "), "Check the body."));
      return send(reply, fn({ handle: c.handle, role: c.role }, b.data));
    });
  sysopRoute("answer", sysop.SysopBodies.answer, (a, b) => sysop.answer(svc, a, b));
  sysopRoute("approve", sysop.SysopBodies.approve, (a, b) => sysop.approve(svc, a, b));
  sysopRoute("cancel", sysop.SysopBodies.cancel, (a, b) => sysop.cancel(svc, a, b));
  sysopRoute("reorder", sysop.SysopBodies.reorder, (a, b) => sysop.reorder(svc, a, b));
  sysopRoute("steer", sysop.SysopBodies.steer, (a, b) => sysop.steer(svc, a, b));
  sysopRoute("force-done", sysop.SysopBodies.forceDone, (a, b) => sysop.forceDone(svc, a, b));
  if (opts.chaos)
    sysopRoute("chaos-kill", sysop.SysopBodies.chaosKill, (a, b) =>
      a.role === "sysop" ? sysop.chaosKill(svc, b) : toolFail("ROLE_DENIED", "sysop only", "Test endpoint."),
    );

  // R5: hook support.
  app.post("/api/hook/pre-tool", async (req, reply) => {
    const ev = HookEventSchema.safeParse(req.body);
    if (!ev.success) return reply.code(400).send({ allow: false, reason: "bad hook event" });
    const c = authOf(req)!;
    return checkPreTool(svc, { handle: c.handle, role: c.role }, ev.data);
  });
  app.post("/api/hook/packet", async (req) => {
    const c = authOf(req)!;
    const t = svc.currentTask(c.handle);
    return t ? callTool(tools, ctxOf(c), "bbs_get_packet", { thread_id: t.thread_id }) : { ok: true, value: { text: "" } };
  });
  app.post("/api/hook/stop", async (req) => {
    const c = authOf(req)!;
    const b = z.object({ diff_stat: z.string().default("") }).parse(req.body ?? {});
    recordStop(svc, { handle: c.handle, role: c.role }, b.diff_stat);
    return { ok: true };
  });

  // Design: ticker sends tick(now) every second for lease expiry.
  const timer = setInterval(() => svc.tick(), opts.tickMs ?? 1000);
  timer.unref();

  await app.listen({ host: opts.host ?? "127.0.0.1", port: opts.port ?? svc.config.port });
  const addr = app.server.address();
  const port = typeof addr === "object" && addr ? addr.port : 0;
  return {
    url: `http://127.0.0.1:${port}`,
    port,
    close: async () => {
      clearInterval(timer);
      await app.close();
    },
  };
}
