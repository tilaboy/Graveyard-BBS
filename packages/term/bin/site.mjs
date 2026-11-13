#!/usr/bin/env node
// Launcher: @graveyard/core ships TypeScript source, so run build-cli.ts through tsx.
import { register } from "tsx/esm/api";

register();
process.argv.splice(2, 0, "site");
await import("../src/build-cli.ts");
