import { spawn as nodeSpawn, type ChildProcess } from "node:child_process";
import type { HubLesson } from "./planner.js";

export interface SpawnReq {
  thread: string;
  handle: string;
  role: string;
  /** Header + QWK packet (the packet is the child's task text, R3.2). */
  task: string;
  env: Record<string, string>;
  cwd?: string;
}

/** The agent name for a role: app/agents and .kiro/agents both name it `graveyard-<role>`. */
export function agentName(role: string): string {
  return `graveyard-${role}`;
}

/** How a board agent is started and steered. The planner never touches this. */
export interface Runner {
  /** Returns an agent id. */
  spawn(r: SpawnReq): Promise<string>;
  /** False when the agent cannot be reached (the caller notes it in the thread). */
  steer(thread: string, message: string): Promise<boolean>;
  /** Mirror a lesson into the runner's own memory (Kiro Crew `learn_add`). */
  learn(l: HubLesson): Promise<void>;
}

type Launch = (
  file: string,
  args: string[],
  opts: { env: NodeJS.ProcessEnv; cwd?: string },
) => Pick<ChildProcess, "pid">;

/**
 * Task 8: no Kiro Crew needed. One detached `kiro-cli chat --no-interactive --agent <role>` per task.
 * shortcut: a one-shot CLI run cannot be steered, so steer returns false; upgrade by resuming the session.
 */
export class KiroCliRunner implements Runner {
  constructor(
    private readonly launch: Launch = (f, a, o) => {
      const c = nodeSpawn(f, a, { ...o, detached: true, stdio: "ignore" });
      c.unref();
      return c;
    },
    private readonly bin = "kiro-cli",
  ) {}

  async spawn(r: SpawnReq): Promise<string> {
    const child = this.launch(
      this.bin,
      ["chat", "--no-interactive", "--agent", agentName(r.role), r.task],
      {
        env: { ...process.env, ...r.env },
        ...(r.cwd ? { cwd: r.cwd } : {}),
      },
    );
    return String(child.pid ?? "unknown");
  }
  steer(): Promise<boolean> {
    return Promise.resolve(false);
  }
  learn(): Promise<void> {
    return Promise.resolve();
  }
}

/** One Kiro Crew MCP tool call the moderator agent must make. */
export interface CrewCall {
  tool: "spawn_run" | "spawn_steer" | "learn_add";
  args: Record<string, unknown>;
}

/**
 * Task 5. Kiro Crew has no CLI or HTTP path to start or steer a sub-agent: `spawn_run`,
 * `spawn_steer` and `learn_add` are MCP tools of the Crew session. So this runner does not start
 * anything itself. It turns each action into the exact tool call and queues it in `calls`; the
 * moderator agent (a Crew session) drains the queue and makes the calls. Agent ids come back
 * from `spawn_run`; `recordAgent` stores them so a later steer can name the agent.
 */
export class KiroCrewRunner implements Runner {
  readonly calls: CrewCall[] = [];
  constructor(private readonly agents: Record<string, string> = {}) {}

  recordAgent(thread: string, id: string): void {
    this.agents[thread] = id;
  }

  // shortcut: Crew spawn_run has no env parameter, so GRAVEYARD_TOKEN travels inside the task text.
  spawn(r: SpawnReq): Promise<string> {
    this.calls.push({
      tool: "spawn_run",
      args: {
        task: r.task,
        agent: agentName(r.role),
        include_lessons: true,
        ...(r.cwd ? { cwd: r.cwd } : {}),
      },
    });
    return Promise.resolve(`pending:${r.thread}`);
  }
  steer(thread: string, message: string): Promise<boolean> {
    this.calls.push({
      tool: "spawn_steer",
      args: {
        agent_id:
          this.agents[thread] ?? `<agent id of ${thread} from spawn_list>`,
        message,
        mode: "interrupt",
      },
    });
    return Promise.resolve(true);
  }
  learn(l: HubLesson): Promise<void> {
    this.calls.push({
      tool: "learn_add",
      args: {
        rule: `[${l.project}/${l.thread}] ${l.text}`.slice(0, 500),
        category: "knowledge",
        applies: "on_topic",
      },
    });
    return Promise.resolve();
  }
}
