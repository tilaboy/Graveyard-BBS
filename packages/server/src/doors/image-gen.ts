import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { parseEvidence } from "../commands.js";
import { defineDoor } from "./types.js";

/** Pluggable provider (R4.4). Returns the bytes of one image. */
export type ImageProvider = (
  prompt: string,
) => Promise<{ ext: string; data: Buffer }>;

/** Stub for tests and the demo: a deterministic SVG derived from the prompt. */
export const stubProvider: ImageProvider = async (prompt) => {
  const hue =
    parseInt(
      createHash("sha256").update(prompt).digest("hex").slice(0, 4),
      16,
    ) % 360;
  const esc = prompt.replace(/[<>&"]/g, "");
  return {
    ext: "svg",
    data: Buffer.from(
      `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><rect width="256" height="256" fill="hsl(${hue},40%,15%)"/><text x="12" y="128" fill="#eee" font-size="14">${esc}</text></svg>`,
    ),
  };
};

const MAX_GENERATIONS = 10; // media.md: default 10 generations per thread

export function makeImageGen(provider: ImageProvider = stubProvider) {
  return defineDoor({
    name: "image_gen",
    argsSchema: z.object({ prompt: z.string().min(1).max(500) }),
    async run(ctx, args) {
      const t = ctx.svc.p.tasks[ctx.thread_id];
      const used = (t?.posts ?? []).filter(
        (p) =>
          p.type === "EVIDENCE" && parseEvidence(p.text)?.door === "image_gen",
      ).length;
      if (used >= MAX_GENERATIONS)
        return {
          exitCode: 1,
          log: `budget: ${MAX_GENERATIONS} generations used\n`,
        };
      const img = await provider(args.prompt);
      const dir = join(ctx.worktree, "images");
      mkdirSync(dir, { recursive: true });
      const name = `candidate-${used + 1}.${img.ext}`;
      writeFileSync(join(dir, name), img.data);
      return {
        exitCode: 0,
        log: `generated images/${name} (${img.data.length} bytes)\n`,
        extra: {
          file: `images/${name}`,
          sha256: createHash("sha256").update(img.data).digest("hex"),
        },
      };
    },
  });
}

export const imageGen = makeImageGen();
