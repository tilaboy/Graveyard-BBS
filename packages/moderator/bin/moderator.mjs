#!/usr/bin/env node
// Launcher: @graveyard/core ships TypeScript source, so run cli.ts through tsx.
import { register } from "tsx/esm/api";

register();
await import("../src/cli.ts");
