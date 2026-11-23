import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { inside } from "./deploy.js";
import { defineDoor } from "./types.js";

const SOURCE = { game: "games", deck: "decks" } as const;
const ListSchema = z.array(
  z.object({
    kind: z.enum(["game", "deck"]),
    slug: z.string(),
    thread: z.string(),
  }),
);

/** The `[D]oors` / `#slides` menu reads this file. */
export function readPublished(dataDir: string): z.infer<typeof ListSchema> {
  const f = join(dataDir, "published", "index.json");
  return existsSync(f)
    ? ListSchema.parse(JSON.parse(readFileSync(f, "utf8")))
    : [];
}

/** Task 15: list a game (`games/<slug>/`) or deck (`decks/<slug>/`) from the worktree in the published area. */
export const publish = defineDoor({
  name: "publish",
  argsSchema: z.object({
    kind: z.enum(["game", "deck"]),
    slug: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
  }),
  async run(ctx, args) {
    const src = inside(ctx.worktree, join(SOURCE[args.kind], args.slug));
    if (!src || !existsSync(join(src, "index.html")))
      return {
        exitCode: 1,
        log: `${SOURCE[args.kind]}/${args.slug}/index.html not found\n`,
      };
    const root = join(ctx.svc.config.dataDir, "published");
    const to = join(root, SOURCE[args.kind], args.slug);
    mkdirSync(to, { recursive: true });
    cpSync(src, to, { recursive: true });
    const list = readPublished(ctx.svc.config.dataDir).filter(
      (x) => !(x.kind === args.kind && x.slug === args.slug),
    );
    list.push({ kind: args.kind, slug: args.slug, thread: ctx.thread_id });
    writeFileSync(join(root, "index.json"), JSON.stringify(list, null, 2));
    return {
      exitCode: 0,
      log: `published ${args.kind} ${args.slug} at /published/${SOURCE[args.kind]}/${args.slug}/\n`,
      extra: {
        kind: args.kind,
        slug: args.slug,
        path: to,
        // Served by the BBS itself (api.ts /published/*), same host as the terminal.
        url: `/published/${SOURCE[args.kind]}/${args.slug}/`,
      },
    };
  },
});
