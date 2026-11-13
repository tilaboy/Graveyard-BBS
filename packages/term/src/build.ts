/** Tasks 7, 22: bundle the browser client (esbuild) and build the static judge site. */
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { build } from "esbuild";
import { BundleSchema } from "./state.js";

const here = import.meta.dirname;
const require_ = createRequire(import.meta.url);

/** Writes index.html, client.js and xterm.css into `out`. `mode` picks live or replay behaviour. */
export async function buildClient(
  out: string,
  mode: "live" | "replay",
): Promise<void> {
  mkdirSync(out, { recursive: true });
  await build({
    entryPoints: [join(here, "client.ts")],
    outfile: join(out, "client.js"),
    bundle: true,
    format: "iife",
    target: "es2022",
    minify: true,
    legalComments: "none",
  });
  const css = join(
    dirname(require_.resolve("@xterm/xterm/package.json")),
    "css",
    "xterm.css",
  );
  cpSync(css, join(out, "xterm.css"));
  writeFileSync(
    join(out, "index.html"),
    readFileSync(join(here, "web", "index.html"), "utf8").replace(
      "__MODE__",
      mode,
    ),
  );
}

/** Default live-client folder; built on first use. */
export async function ensureClient(): Promise<string> {
  const out = resolve(here, "../dist/live");
  if (!existsSync(join(out, "client.js"))) await buildClient(out, "live");
  return out;
}

export interface SiteOptions {
  /** Bundle files, or directories holding `*.bundle.json`. */
  bundles: string[];
  out: string;
  /** Folder with `games/` and `decks/` (the server's published area), copied to `published/`. */
  published?: string;
}

/** Task 22: a folder of static files. No server, no login, no LLM; a later step uploads it. */
export async function buildSite(o: SiteOptions): Promise<{ runs: string[] }> {
  await buildClient(o.out, "replay");
  const files = o.bundles.flatMap((p) =>
    statSync(p).isDirectory()
      ? readdirSync(p)
          .filter((f) => f.endsWith(".bundle.json"))
          .map((f) => join(p, f))
      : [p],
  );
  mkdirSync(join(o.out, "runs"), { recursive: true });
  const index: { runId: string; file: string }[] = [];
  for (const f of files) {
    // Refuse a bad bundle at build time, not in the judge's browser.
    const b = BundleSchema.parse(JSON.parse(readFileSync(f, "utf8")));
    const name = `${b.runId}.bundle.json`;
    cpSync(f, join(o.out, "runs", name));
    const art = join(dirname(f), b.runId);
    if (existsSync(art))
      cpSync(art, join(o.out, "runs", b.runId), { recursive: true });
    index.push({ runId: b.runId, file: `runs/${name}` });
  }
  writeFileSync(
    join(o.out, "runs", "index.json"),
    JSON.stringify(index, null, 2),
  );
  if (o.published && existsSync(o.published))
    cpSync(o.published, join(o.out, "published"), { recursive: true });
  return { runs: index.map((r) => r.runId) };
}
