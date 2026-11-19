import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { rootOf, worktreeOf } from "../src/worktree.js";

const tasks = {
  "arcade-test": {},
  "arcade-test-design": { parent: "arcade-test" },
  "arcade-test-build": { parent: "arcade-test" },
  "arcade-test-build-1": { parent: "arcade-test-build" },
  "arcade-orphan-build": { parent: "arcade-gone" },
};

function repo(): string {
  const d = mkdtempSync(join(tmpdir(), "gy-mod-wt-"));
  const git = (...a: string[]) => execFileSync("git", a, { cwd: d });
  git("init", "-q");
  git("config", "user.email", "t@t");
  git("config", "user.name", "t");
  writeFileSync(join(d, "a"), "a");
  git("add", "a");
  git("commit", "-qm", "a");
  return d;
}

describe("stages share their top task's worktree", () => {
  it("rootOf follows parent to the Sysop's task, and stops at a missing parent", () => {
    expect(rootOf(tasks, "arcade-test-design")).toBe("arcade-test");
    expect(rootOf(tasks, "arcade-test-build-1")).toBe("arcade-test");
    expect(rootOf(tasks, "arcade-test")).toBe("arcade-test");
    expect(rootOf(tasks, "arcade-orphan-build")).toBe("arcade-orphan-build");
  });

  it("design and build get the same folder, created once, on branch gy/<root>", () => {
    const r = repo();
    const data = join(r, ".graveyard");
    const a = worktreeOf(data, r, tasks, "arcade-test-design");
    const b = worktreeOf(data, r, tasks, "arcade-test-build");
    expect(a).toBe(join(data, "wt", "arcade-test"));
    expect(b).toBe(a);
    expect(existsSync(join(a!, "a"))).toBe(true);
    const branch = execFileSync("git", ["branch", "--show-current"], {
      cwd: a!,
      encoding: "utf8",
    }).trim();
    expect(branch).toBe("gy/arcade-test");
  });
});
