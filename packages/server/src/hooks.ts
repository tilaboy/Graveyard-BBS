import { isAbsolute, relative, resolve } from "node:path";
import { renderAccessDenied, type Actor } from "@graveyard/core";
import { z } from "zod";
import { boardOf, globMatch } from "./boards.js";
import type { Service } from "./commands.js";
import { worktreePath } from "./worktree.js";

/** Kiro CLI 3 hook event (stdin of the hook command). Unknown fields are ignored. */
export const HookEventSchema = z.object({
  hook_event_name: z.string().optional(),
  cwd: z.string().optional(),
  tool_name: z.string().optional(),
  tool_input: z.record(z.string(), z.unknown()).default({}),
});
export type HookEvent = z.infer<typeof HookEventSchema>;

const WRITE_TOOLS = /^(fs_write|fs_append|str_replace|write|edit|apply_patch)$/;
const SET_STATUS = /bbs_set_status$/;
const base = (name: string) => name.split(/[/:]/).pop() ?? name;

/** What the hook CLI must do when the server cannot be asked: writes and status changes fail closed. */
export const needsServer = (toolName: string): boolean =>
  WRITE_TOOLS.test(base(toolName)) || SET_STATUS.test(toolName);

export interface Verdict {
  allow: boolean;
  reason?: string;
}
const deny = (reason: string): Verdict => ({ allow: false, reason });

const StatusInput = z.object({
  thread_id: z.string(),
  to: z.string(),
  reason: z.string().optional(),
});

/** R5.1: dry-run the same core rules the MCP tool applies; nothing is appended. */
export function checkPreTool(
  svc: Service,
  actor: Actor,
  ev: HookEvent,
): Verdict {
  const name = ev.tool_name ?? "";
  if (SET_STATUS.test(name)) {
    const a = StatusInput.safeParse(ev.tool_input);
    if (!a.success) return deny("bbs_set_status needs thread_id and to");
    const to = z
      .enum([
        "pending",
        "running",
        "blocked",
        "awaiting-review",
        "done",
        "cancelled",
      ])
      .safeParse(a.data.to);
    if (!to.success) return deny(`unknown status '${a.data.to}'`);
    const r = svc.check({
      type: "set_status",
      actor,
      thread_id: a.data.thread_id,
      to: to.data,
      ...(a.data.reason ? { reason: a.data.reason } : {}),
      gate_ok: svc.gateOk(a.data.thread_id),
    });
    return r.ok ? { allow: true } : deny(renderAccessDenied(r.error));
  }
  if (!WRITE_TOOLS.test(base(name))) return { allow: true };

  const t = svc.currentTask(actor.handle);
  if (!t) return { allow: true };
  if (t.packet !== null && t.acked !== t.packet)
    return deny(
      ` ☠  ACCESS DENIED · NO_ACK  ${t.thread_id}: ACK ${t.packet} before writing`,
    );

  const raw =
    ev.tool_input["path"] ??
    ev.tool_input["file_path"] ??
    ev.tool_input["filePath"];
  if (typeof raw !== "string") return { allow: true };
  const abs = isAbsolute(raw) ? raw : resolve(ev.cwd ?? svc.config.repo, raw);
  const rel = [worktreePath(svc.config.dataDir, t.thread_id), svc.config.repo]
    .map((root) => relative(root, abs))
    .find((p) => !p.startsWith(".."));
  if (rel === undefined) return { allow: true };
  for (const m of svc.boards[boardOf(t.thread_id)]?.pathLocks ?? []) {
    if (!globMatch(m.glob, rel)) continue;
    if (svc.p.locks[m.lock]?.holder?.thread !== t.thread_id)
      return deny(
        ` ☠  ACCESS DENIED · STALE_TOKEN  ${rel} is under lock '${m.lock}', which ${t.thread_id} does not hold. Claim it with bbs_claim_lock.`,
      );
  }
  return { allow: true };
}

/** R5.3: MILESTONE with the diff summary, and a heartbeat for every lock the caller holds. */
export function recordStop(svc: Service, actor: Actor, diffStat: string): void {
  const t = svc.currentTask(actor.handle);
  if (!t) return;
  svc.exec({
    type: "post",
    actor,
    thread_id: t.thread_id,
    kind: "MILESTONE",
    body: {
      text:
        diffStat.trim() === ""
          ? "turn ended, no file changes"
          : `turn ended\n${diffStat.trim()}`,
      code_change: diffStat.trim() !== "",
    },
  });
  for (const l of Object.values(svc.p.locks))
    if (l.holder?.thread === t.thread_id && l.holder.caller === actor.handle)
      svc.exec({
        type: "heartbeat",
        actor,
        thread_id: t.thread_id,
        lock: l.name,
      });
}
