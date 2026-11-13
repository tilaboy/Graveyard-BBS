import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { z } from "zod";

/** Design "Config": repo path, port, lease seconds, test command. Boards are read from the repo's steering files. */
const ConfigSchema = z.object({
  repo: z.string().default("."),
  dataDir: z.string().default(".graveyard"),
  port: z.number().int().min(0).max(65535).default(2626),
  leaseSeconds: z.number().positive().default(60),
  testCommand: z.string().optional(),
  boardsDir: z.string().default(".kiro/steering/boards"),
});
export type Config = z.infer<typeof ConfigSchema>;

/** Resolved config; the file `graveyard.config.json` in `cwd` is optional, `overrides` win. */
export function loadConfig(
  cwd: string,
  overrides: Partial<Config> = {},
): Config {
  const file = join(cwd, "graveyard.config.json");
  const fromFile: unknown = existsSync(file)
    ? JSON.parse(readFileSync(file, "utf8"))
    : {};
  const c = ConfigSchema.parse({ ...(fromFile as object), ...overrides });
  const repo = resolve(cwd, c.repo);
  return {
    ...c,
    repo,
    dataDir: resolve(repo, c.dataDir),
    boardsDir: resolve(repo, c.boardsDir),
  };
}
