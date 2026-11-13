import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { loadBoards } from "./boards.js";
import { Service } from "./commands.js";
import { loadConfig, type Config } from "./config.js";
import { Store } from "./store.js";

/** Open the store (SQLite file in dataDir, or GRAVEYARD_DB) and fold the log into projections (R1.1). */
export function openService(
  cwd: string,
  overrides: Partial<Config> = {},
  env: NodeJS.ProcessEnv = process.env,
): Service {
  const config = loadConfig(cwd, overrides);
  mkdirSync(config.dataDir, { recursive: true });
  const store = new Store(
    env["GRAVEYARD_DB"] ?? join(config.dataDir, "graveyard.db"),
  );
  return new Service(store, config, loadBoards(config.boardsDir));
}
