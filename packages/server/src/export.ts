import { copyFileSync, mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, relative } from "node:path";
import type { Event } from "@graveyard/core";
import { z } from "zod";
import type { Board } from "./boards.js";
import { parseEvidence } from "./commands.js";
import type { Config } from "./config.js";
import type { Store } from "./store.js";

const SECRET_NAME = /(TOKEN|SECRET|KEY|PASSWORD|PASSWD|CREDENTIAL)/i;
const TOKEN_SHAPE = /gy_[0-9a-f]{48}/g;

export interface Scrubber {
  (v: unknown): unknown;
}

/** Spec 00 design §2: strip caller tokens, env secret values and absolute home / repo paths from every string. */
export function makeScrubber(env: NodeJS.ProcessEnv, repo: string, home = homedir()): Scrubber {
  const secrets = Object.entries(env)
    .filter(([k, v]) => SECRET_NAME.test(k) && (v?.length ?? 0) >= 6)
    .map(([, v]) => v as string)
    .sort((a, b) => b.length - a.length);
  const str = (s: string): string => {
    let out = s.replace(TOKEN_SHAPE, "[redacted]");
    for (const x of secrets) out = out.replaceAll(x, "[redacted]");
    // longest path first, so the repo (usually under home) becomes <repo>, not ~/...
    return out.replaceAll(repo, "<repo>").replaceAll(home, "~");
  };
  const walk = (v: unknown): unknown =>
    typeof v === "string"
      ? str(v)
      : Array.isArray(v)
        ? v.map(walk)
        : v && typeof v === "object"
          ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x)]))
          : v;
  return walk;
}

export interface RunBundle {
  runId: string;
  recordedAt: string;
  project: string;
  boards: Board[];
  events: Event[];
  artifacts: { sha256: string; name: string; path: string }[];
  outputs: { landingUrl?: string; games: string[]; decks: string[] };
}

const PublishExtra = z.object({ kind: z.enum(["game", "deck"]), slug: z.string() });

/** Task 17: `runs/<run-id>.bundle.json` plus `runs/<run-id>/artifacts/<sha256>`. */
export function exportRun(
  store: Store,
  config: Config,
  boards: Record<string, Board>,
  runId: string,
  outDir: string,
  env: NodeJS.ProcessEnv = process.env,
  now = new Date(),
): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(runId)) throw new Error(`bad run id '${runId}'`);
  const scrub = makeScrubber(env, config.repo);
  const events = store.events();
  const evidence = events.flatMap((e) => (e.type === "EVIDENCE" ? [parseEvidence(e.body.text)] : []));
  const published = evidence.flatMap((ev) => {
    const p = ev?.door === "publish" ? PublishExtra.safeParse(ev.extra) : undefined;
    return p?.success ? [p.data] : [];
  });
  const deployUrls = evidence.flatMap((ev) => (ev?.door === "deploy" && typeof ev.extra["url"] === "string" ? [ev.extra["url"]] : []));

  const files = store.files();
  const artDir = join(outDir, runId, "artifacts");
  mkdirSync(artDir, { recursive: true });
  for (const f of files) copyFileSync(f.path, join(artDir, f.sha256));

  const landing = deployUrls.at(-1);
  const bundle: RunBundle = {
    runId,
    recordedAt: now.toISOString(),
    project: "graveyard-bbs",
    boards: Object.values(boards),
    events,
    artifacts: files.map((f) => ({ sha256: f.sha256, name: f.name, path: relative(outDir, join(artDir, f.sha256)) })),
    outputs: {
      ...(landing ? { landingUrl: landing } : {}),
      games: published.filter((p) => p.kind === "game").map((p) => p.slug),
      decks: published.filter((p) => p.kind === "deck").map((p) => p.slug),
    },
  };
  const file = join(outDir, `${runId}.bundle.json`);
  writeFileSync(file, JSON.stringify(scrub(bundle), null, 2));
  return file;
}
