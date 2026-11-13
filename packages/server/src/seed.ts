import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Role } from "@graveyard/core";
import type { Service } from "./commands.js";

/** Demo callers (docs/demo.md): one per role the demo uses. */
export const DEMO_CALLERS: { handle: string; role: Role }[] = [
  { handle: "sysop", role: "sysop" },
  { handle: "moderator", role: "moderator" },
  { handle: "designer-1", role: "designer" },
  { handle: "builder-1", role: "builder" },
  { handle: "builder-2", role: "builder" },
  { handle: "reviewer-1", role: "reviewer" },
  { handle: "release-1", role: "release" },
  { handle: "artist-1", role: "artist" },
];

export const DEMO_THREADS: { id: string; text: string; assigned: string }[] = [
  { id: "websites-landing", text: "Haunted landing page with a signup form", assigned: "builder-1" },
  { id: "arcade-crypt-runner", text: "Door game (spec mode): crypt runner", assigned: "builder-2" },
  { id: "arcade-bat-dodge", text: "Door game (vibe mode): bat dodge", assigned: "builder-1" },
  { id: "slides-pitch", text: "Six-slide pitch deck", assigned: "builder-2" },
];

/** Task 12: create missing demo callers (tokens are printed once, existing ones are kept) and demo threads. */
export function seed(svc: Service): { created: Record<string, string>; threads: string[] } {
  const have = new Set(svc.store.callers().map((c) => c.handle));
  const created: Record<string, string> = {};
  for (const c of DEMO_CALLERS)
    if (!have.has(c.handle)) created[c.handle] = svc.store.addCaller(c.handle, c.role);
  const threads: string[] = [];
  for (const t of DEMO_THREADS) {
    if (svc.p.tasks[t.id]) continue;
    const r = svc.exec({
      type: "create_task",
      actor: { handle: "sysop", role: "sysop" },
      thread_id: t.id,
      text: t.text,
      assigned: t.assigned,
    });
    if (r.ok) threads.push(t.id);
  }
  return { created, threads };
}

/** Task 14: a clean git repo with a passing `npm test`, so doors have something real to run. */
export function createDemoRepo(dir: string): void {
  mkdirSync(dir, { recursive: true });
  if (existsSync(join(dir, ".git"))) return;
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify({ name: "graveyard-demo", private: true, scripts: { test: "node -e \"process.exit(0)\"" } }, null, 2),
  );
  writeFileSync(join(dir, ".gitignore"), ".graveyard/\n");
  const git = (...a: string[]) => execFileSync("git", ["-c", "user.name=graveyard", "-c", "user.email=graveyard@localhost", ...a], { cwd: dir });
  git("init", "-q");
  git("add", ".");
  git("commit", "-q", "-m", "demo repo");
}
