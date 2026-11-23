import { readFileSync, existsSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, it, expect } from "vitest";
import * as config from "../src/config.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

// Exports only: later tasks replace the stubs, so "throws not implemented" is never asserted
// (lesson from arcade-flip-ghost-build-1).
const MODULES = {
  "config.js": [],
  "rng.js": ["seedWord", "next", "randInt", "pickWeighted"],
  "notImplemented.js": ["notImplemented"],
  "grid.js": ["key", "inBounds", "cheb", "webCells", "hazardSet", "fitsGrid"],
  "snake.js": ["queueTurn", "nextHead", "advance", "hitsSelf"],
  "spawn.js": ["spawnCreature", "spawnSpider"],
  "sim.js": ["initialState", "step"],
  "input.js": ["keyToAction", "bindInput"],
  "render.js": ["draw"],
  "hud.js": ["hudText", "updateHud", "loadBest", "saveBest"],
  "sound.js": ["createSound"],
  "main.js": ["boot"],
};

describe("scaffold (R1.1, R1.2, R6.6, R9.1, R9.2, R9.4)", () => {
  it("R9.1 index.html has a 480x480 canvas and loads src/main.js as a module", () => {
    const html = readFileSync(join(root, "index.html"), "utf8");
    expect(html).toMatch(
      /<script type="module" src="src\/main\.js"><\/script>/,
    );
    expect(html).toMatch(/<canvas[^>]*id="screen"/);
    expect(html).toContain('width="480"');
    expect(html).toContain('height="480"');
    expect(html).toContain('href="style.css"');
    expect(existsSync(join(root, "style.css"))).toBe(true);
    expect(existsSync(join(root, "src", "main.js"))).toBe(true);
  });

  it("R7.1 R7.4 HUD ids exist and #status is aria-live polite", () => {
    const html = readFileSync(join(root, "index.html"), "utf8");
    for (const id of [
      "score",
      "length",
      "eaten",
      "spiders",
      "best",
      "status",
    ]) {
      expect(html, `id ${id}`).toContain(`id="${id}"`);
    }
    expect(html).toMatch(/id="status"[^>]*aria-live="polite"/);
  });

  it("R6.6 the page lists every key in plain text", () => {
    const html = readFileSync(join(root, "index.html"), "utf8");
    for (const text of [
      "Arrow keys",
      "W A S D",
      "Space",
      "Enter",
      "P:",
      "R:",
      "M:",
    ]) {
      expect(html, text).toContain(text);
    }
  });

  it("R9.2 package.json has a vitest test script and no dependencies", () => {
    const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
    expect(pkg.name).toBe("graveyard-snake");
    expect(pkg.type).toBe("module");
    expect(pkg.scripts.test).toBe("vitest run");
    expect(pkg.dependencies).toBeUndefined();
    expect(pkg.devDependencies).toBeUndefined();
  });

  it("R9.1 R8.2 the game folder ships no audio files", () => {
    /** @param {string} dir @returns {string[]} */
    const walk = (dir) =>
      readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
        e.name === "node_modules"
          ? []
          : e.isDirectory()
            ? walk(join(dir, e.name))
            : [e.name],
      );
    const audio = walk(root).filter((f) =>
      /\.(wav|mp3|ogg|m4a|flac)$/i.test(f),
    );
    expect(audio).toEqual([]);
  });

  it("R9.4 every src file starts with // @ts-check", () => {
    for (const file of Object.keys(MODULES)) {
      const src = readFileSync(join(root, "src", file), "utf8");
      expect(src.startsWith("// @ts-check"), file).toBe(true);
    }
  });

  it("every design §1 module exists with its exported functions", async () => {
    for (const [file, names] of Object.entries(MODULES)) {
      const mod = await import(/* @vite-ignore */ `../src/${file}`);
      for (const name of names) {
        expect(typeof mod[name], `${file} exports ${name}`).toBe("function");
      }
    }
  });

  it("R1.1 R1.2 design §2 constants", () => {
    expect(config.COLS).toBe(24);
    expect(config.ROWS).toBe(24);
    expect(config.CELL_PX).toBe(20);
    expect(config.COLS * config.CELL_PX).toBe(480);
    expect(config.TICK_HZ).toBe(60);
    expect(config.START_STEP_TICKS).toBe(8);
    expect(config.MIN_STEP_TICKS).toBe(4);
    expect(config.SPEEDUP_EVERY).toBe(10);
    expect(config.START_CELLS).toEqual([
      [12, 12],
      [11, 12],
      [10, 12],
    ]);
    expect(config.START_DIR).toBe("right");
    expect(config.TURN_BUFFER).toBe(2);
    expect(config.CREATURES).toEqual({
      ghost: { weight: 60, points: 1, growth: 1 },
      skeleton: { weight: 30, points: 3, growth: 2 },
      dinosaur: { weight: 10, points: 5, growth: 3 },
    });
    expect(config.KINDS).toEqual(["ghost", "skeleton", "dinosaur"]);
    expect(config.START_SPIDERS).toBe(2);
    expect(config.SPIDER_EVERY).toBe(3);
    expect(config.MAX_SPIDERS).toBe(6);
    expect(config.WEB_MIN_R).toBe(1);
    expect(config.WEB_MAX_R).toBe(3);
    expect(config.HEAD_SAFE_DIST).toBe(3);
    expect(config.SPAWN_TRIES).toBe(50);
    expect(config.BEST_KEY).toBe("graveyard-snake.best");
    expect(config.FLASH_HZ).toBeLessThanOrEqual(3);
  });
});
