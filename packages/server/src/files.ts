/**
 * Read-only file view for the terminal: a text file (or one directory level) from a thread's top
 * task worktree. Trust boundary: the path comes from a post an agent wrote, so it is resolved,
 * realpath'd and kept inside the worktree; VCS and data folders and secret-looking names are refused.
 */
import { readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { isAbsolute, join, relative, sep } from "node:path";
import { VOICE } from "@graveyard/core";

export const MAX_FILE_BYTES = 256 * 1024;

export type FileCode =
  "BAD_ARGS" | "NOT_FOUND" | "FILE_REFUSED" | "TOO_LARGE" | "BINARY";

export type FileView =
  | { ok: true; value: { kind: "file"; path: string; text: string } }
  | { ok: true; value: { kind: "dir"; path: string; entries: string[] } }
  | {
      ok: false;
      status: number;
      error: { code: FileCode; message: string; hint: string; voice: string };
    };

const refuse = (
  status: number,
  code: FileCode,
  message: string,
  hint: string,
): FileView => ({
  ok: false,
  status,
  error: {
    code,
    message,
    hint,
    voice: code === "NOT_FOUND" ? VOICE.NOT_FOUND : VOICE.ROLE_DENIED,
  },
});

/** Folders never shown, and names that look like secrets (.env, *token*, *secret*, *.pem, *.key). */
const HIDDEN_DIRS = new Set([".git", ".graveyard"]);
const SECRET = /^\.env(\..*)?$|\.env$|token|secret|\.pem$|\.key$/i;
const deniedName = (n: string): boolean => HIDDEN_DIRS.has(n) || SECRET.test(n);
const deniedPath = (rel: string): string | undefined =>
  rel.split(/[\\/]/).find((seg) => seg && deniedName(seg));

/** `rel` inside `root` (a worktree). Never throws. */
export function readTreeFile(root: string, rel: string): FileView {
  if (rel.length > 1024 || rel.includes("\0"))
    return refuse(400, "BAD_ARGS", "bad path", "Send a relative path.");
  if (isAbsolute(rel) || /^[\\/]/.test(rel))
    return refuse(
      403,
      "FILE_REFUSED",
      `absolute path ${rel}`,
      "Paths are relative to the task's worktree.",
    );
  if (rel.split(/[\\/]/).includes(".."))
    return refuse(
      403,
      "FILE_REFUSED",
      `path ${rel} leaves the worktree`,
      "Paths are relative to the task's worktree.",
    );
  const bad = deniedPath(rel);
  if (bad)
    return refuse(
      403,
      "FILE_REFUSED",
      `${bad} is not shown`,
      "VCS, data and secret files stay hidden.",
    );
  let base: string;
  let real: string;
  try {
    base = realpathSync(root);
  } catch {
    return refuse(
      404,
      "NOT_FOUND",
      "this task has no worktree yet",
      "It appears once an agent starts work.",
    );
  }
  try {
    real = realpathSync(join(base, rel));
  } catch {
    return refuse(
      404,
      "NOT_FOUND",
      `no file ${rel}`,
      "The agent may not have written it yet.",
    );
  }
  // A symlink inside the tree may point anywhere: check where it really lands.
  const inside = relative(base, real);
  if (
    real !== base &&
    (inside.startsWith(`..${sep}`) || inside === ".." || isAbsolute(inside))
  )
    return refuse(
      403,
      "FILE_REFUSED",
      `${rel} points outside the worktree`,
      "Only the task's own files are shown.",
    );
  const badReal = deniedPath(inside);
  if (badReal)
    return refuse(
      403,
      "FILE_REFUSED",
      `${badReal} is not shown`,
      "VCS, data and secret files stay hidden.",
    );
  const shown = inside.split(sep).join("/");
  try {
    const st = statSync(real);
    if (st.isDirectory()) {
      const entries = readdirSync(real, { withFileTypes: true })
        .filter((d) => !deniedName(d.name))
        .map((d) => {
          // A symlinked folder lists as a folder; where it points is checked when it is opened.
          const dir =
            d.isDirectory() ||
            (d.isSymbolicLink() && isDir(join(real, d.name)));
          return dir ? `${d.name}/` : d.name;
        })
        .sort();
      return { ok: true, value: { kind: "dir", path: shown, entries } };
    }
    if (!st.isFile())
      return refuse(
        403,
        "FILE_REFUSED",
        `${rel} is not a regular file`,
        "Only text files are shown.",
      );
    if (st.size > MAX_FILE_BYTES)
      return refuse(
        413,
        "TOO_LARGE",
        `${rel} is ${st.size} bytes (limit ${MAX_FILE_BYTES})`,
        "Open it in an editor.",
      );
    const buf = readFileSync(real);
    if (buf.includes(0))
      return refuse(
        415,
        "BINARY",
        `${rel} is not a text file`,
        "Only text files are shown.",
      );
    return {
      ok: true,
      value: { kind: "file", path: shown, text: buf.toString("utf8") },
    };
  } catch {
    return refuse(
      404,
      "NOT_FOUND",
      `no file ${rel}`,
      "The agent may not have written it yet.",
    );
  }
}

function isDir(p: string): boolean {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
}
