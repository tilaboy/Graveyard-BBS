import { readFileSync, statSync } from "node:fs";
import { extname, resolve, sep } from "node:path";

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".gif": "image/gif",
  ".txt": "text/plain; charset=utf-8",
  ".md": "text/plain; charset=utf-8",
};

/** A file under `root` for the URL tail `rel`, or undefined. `..` and absolute tails never leave `root`. */
export function readStatic(
  root: string,
  rel: string,
): { body: Buffer; type: string } | undefined {
  const base = resolve(root);
  let path: string;
  try {
    path = resolve(base, decodeURIComponent(rel) || "index.html");
  } catch {
    return undefined;
  }
  if (!path.startsWith(base + sep)) return undefined;
  try {
    if (statSync(path).isDirectory()) path = resolve(path, "index.html");
    return {
      body: readFileSync(path),
      type: MIME[extname(path)] ?? "application/octet-stream",
    };
  } catch {
    return undefined;
  }
}
