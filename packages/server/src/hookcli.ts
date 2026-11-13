import { execFileSync } from "node:child_process";
import { z } from "zod";
import { HookEventSchema, needsServer } from "./hooks.js";

export interface HookResult {
  code: 0 | 2;
  stdout: string;
  stderr: string;
}

export interface HookEnv {
  url: string;
  token: string | undefined;
}

type Post = (path: string, body: unknown) => Promise<unknown>;

/** POST with the caller's token; throws on network errors, timeouts, non-2xx. */
const poster =
  (env: HookEnv): Post =>
  async (path, body) => {
    if (!env.token) throw new Error("GRAVEYARD_TOKEN is not set");
    const res = await fetch(`${env.url}${path}`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${env.token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) throw new Error(`server answered HTTP ${res.status}`);
    return res.json();
  };

const Verdict = z.object({ allow: z.boolean(), reason: z.string().optional() });

/**
 * Kiro CLI 3 hook contract: event JSON on stdin; exit 0 allow; exit 2 deny with the reason on stderr.
 * R5.4: when the server cannot be asked, writes and status changes are denied; reads are allowed.
 */
export async function preTool(
  stdin: string,
  env: HookEnv,
  post: Post = poster(env),
): Promise<HookResult> {
  let raw: unknown;
  try {
    raw = JSON.parse(stdin);
  } catch {
    return {
      code: 2,
      stdout: "",
      stderr: "graveyard: hook event is not JSON; refusing (fail closed)\n",
    };
  }
  const ev = HookEventSchema.safeParse(raw);
  if (!ev.success)
    return {
      code: 2,
      stdout: "",
      stderr: "graveyard: malformed hook event; refusing (fail closed)\n",
    };
  const tool = ev.data.tool_name ?? "";
  if (!needsServer(tool)) return { code: 0, stdout: "", stderr: "" };
  try {
    const v = Verdict.parse(await post("/api/hook/pre-tool", ev.data));
    return v.allow
      ? { code: 0, stdout: "", stderr: "" }
      : { code: 2, stdout: "", stderr: `${v.reason ?? "refused"}\n` };
  } catch (e) {
    return {
      code: 2,
      stdout: "",
      stderr: `graveyard: cannot reach the BBS (${e instanceof Error ? e.message : String(e)}); writes and status changes are refused until it is back\n`,
    };
  }
}

const PacketReply = z.object({
  ok: z.literal(true),
  value: z.object({ text: z.string() }),
});

/** R5.2: print the caller's QWK packet as AgentSpawn context. Never blocks the agent. */
export async function spawn(
  env: HookEnv,
  post: Post = poster(env),
): Promise<HookResult> {
  try {
    const r = PacketReply.parse(await post("/api/hook/packet", {}));
    return {
      code: 0,
      stdout: r.value.text ? `${r.value.text}\n` : "",
      stderr: "",
    };
  } catch (e) {
    return {
      code: 0,
      stdout: "",
      stderr: `graveyard: no packet (${e instanceof Error ? e.message : String(e)})\n`,
    };
  }
}

/** R5.3: MILESTONE with `git diff --stat`, plus a heartbeat. Never blocks the agent from stopping. */
export async function stop(
  stdin: string,
  env: HookEnv,
  post: Post = poster(env),
): Promise<HookResult> {
  let cwd = process.cwd();
  try {
    const ev = HookEventSchema.safeParse(JSON.parse(stdin));
    if (ev.success && ev.data.cwd) cwd = ev.data.cwd;
  } catch {
    /* no event: use the current directory */
  }
  let diff_stat = "";
  try {
    diff_stat = execFileSync("git", ["diff", "--stat"], {
      cwd,
      encoding: "utf8",
      timeout: 10_000,
    });
  } catch {
    /* not a git directory: post without a diff */
  }
  try {
    await post("/api/hook/stop", { diff_stat });
    return { code: 0, stdout: "", stderr: "" };
  } catch (e) {
    return {
      code: 0,
      stdout: "",
      stderr: `graveyard: milestone not posted (${e instanceof Error ? e.message : String(e)})\n`,
    };
  }
}
