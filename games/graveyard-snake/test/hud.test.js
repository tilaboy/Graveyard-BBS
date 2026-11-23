import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { hudText, updateHud, loadBest, saveBest, HUD_IDS } from "../src/hud.js";
import { initialState } from "../src/sim.js";
import { BEST_KEY } from "../src/config.js";

/** @param {Partial<import("../src/config.js").State>} over */
function stateWith(over) {
  return { ...initialState(1), ...over };
}

/** A Map-backed localStorage. */
function fakeWin(/** @type {Record<string, string>} */ init = {}) {
  const store = new Map(Object.entries(init));
  return {
    store,
    localStorage: {
      /** @param {string} k */
      getItem: (k) =>
        store.has(k) ? /** @type {string} */ (store.get(k)) : null,
      /** @param {string} k @param {string} v */
      setItem: (k, v) => void store.set(k, v),
    },
  };
}

/** localStorage whose every call throws, like a blocked or full storage. */
const brokenWin = {
  localStorage: {
    getItem: () => {
      throw new Error("SecurityError");
    },
    setItem: () => {
      throw new Error("QuotaExceededError");
    },
  },
};

/** A document of HUD elements by id. */
function fakeDoc(/** @type {string[]} */ ids = [...HUD_IDS]) {
  /** @type {Record<string, {textContent: string}>} */
  const els = {};
  for (const id of ids) els[id] = { textContent: "" };
  return { els, getElementById: (/** @type {string} */ id) => els[id] ?? null };
}

describe("hudText (R7.1, R7.2, R7.4)", () => {
  it("R7.1 shows score, length, eaten by kind, spider count and best", () => {
    const s = stateWith({
      phase: "play",
      score: 12,
      eaten: { ghost: 4, skeleton: 1, dinosaur: 1 },
    });
    const t = hudText(s, 30);
    expect(t.score).toBe("12");
    expect(t.length).toBe(String(s.snake.length));
    expect(t.eaten).toBe("ghost 4 · skeleton 1 · dinosaur 1");
    expect(t.spiders).toBe(String(s.spiders.length));
    expect(t.best).toBe("30");
    expect(t.status).toContain("playing");
    expect(t.status).toContain("score 12");
  });

  it("best shows the live score once it beats the stored best", () => {
    expect(hudText(stateWith({ score: 9 }), 5).best).toBe("9");
    expect(hudText(stateWith({ score: 3 }), 5).best).toBe("5");
  });

  it("title and paused lines from design §11", () => {
    expect(hudText(stateWith({ phase: "title" }), 0).status).toBe(
      "🎃 Press Space to rise from the grave",
    );
    expect(hudText(stateWith({ phase: "paused" }), 0).status).toBe(
      "💤 Paused · press P",
    );
  });

  it.each([
    ["web", "💀 Caught in a spider web · GAME OVER · reason: web · score 12"],
    [
      "wall",
      "💀 Crashed into the graveyard fence · GAME OVER · reason: wall · score 12",
    ],
    ["self", "💀 Bit your own bones · GAME OVER · reason: self · score 12"],
    ["full", "✅ The graveyard is full · YOU WIN · reason: full · score 12"],
  ])("R7.2 game-over line for reason %s", (end, line) => {
    const s = stateWith({
      phase: "over",
      end: /** @type {import("../src/config.js").EndReason} */ (end),
      score: 12,
    });
    expect(hudText(s, 0).status).toBe(line);
  });

  it("R7.4 every field is plain words and numbers, never emoji alone", () => {
    const phases = /** @type {const} */ (["title", "play", "paused", "over"]);
    const ends = /** @type {const} */ (["web", "wall", "self", "full"]);
    fc.assert(
      fc.property(
        fc.constantFrom(...phases),
        fc.constantFrom(...ends),
        fc.nat(10_000),
        fc.nat(10_000),
        (phase, end, score, best) => {
          const t = hudText(stateWith({ phase, end, score }), best);
          for (const v of Object.values(t)) {
            expect(
              v.replace(/\p{Extended_Pictographic}/gu, "").trim(),
            ).not.toBe("");
          }
          if (phase === "over") {
            expect(t.status).toContain(`reason: ${end}`);
            expect(t.status).toContain(`score ${score}`);
          }
          expect(Number(t.best)).toBe(Math.max(best, score));
        },
      ),
    );
  });
});

describe("updateHud (R7.1, R7.4)", () => {
  it("writes textContent of every HUD id", () => {
    const doc = fakeDoc();
    const t = hudText(stateWith({ phase: "over", end: "web", score: 3 }), 7);
    updateHud(/** @type {any} */ (doc), t);
    for (const id of HUD_IDS) expect(doc.els[id].textContent).toBe(t[id]);
  });

  it("skips missing elements without throwing", () => {
    const doc = fakeDoc(["score"]);
    const t = hudText(stateWith({ score: 4 }), 0);
    expect(() => updateHud(/** @type {any} */ (doc), t)).not.toThrow();
    expect(doc.els.score.textContent).toBe("4");
  });
});

describe("loadBest and saveBest (R7.3)", () => {
  it(`R7.3 uses localStorage key ${BEST_KEY}`, () => {
    expect(BEST_KEY).toBe("graveyard-snake.best");
    const win = fakeWin();
    saveBest(win, 21);
    expect(win.store.get("graveyard-snake.best")).toBe("21");
    expect(loadBest(win)).toBe(21);
  });

  it.each([
    ["missing", undefined],
    ["empty", ""],
    ["text", "boo"],
    ["negative", "-4"],
    ["fraction", "3.5"],
    ["huge", "99999999999999999999"],
    ["json", "{}"],
  ])("R7.3 reads a %s value as 0", (_name, raw) => {
    const win = raw === undefined ? fakeWin() : fakeWin({ [BEST_KEY]: raw });
    expect(loadBest(win)).toBe(0);
  });

  it("R7.3 reads 0 and ignores writes when storage throws", () => {
    expect(loadBest(brokenWin)).toBe(0);
    expect(() => saveBest(brokenWin, 5)).not.toThrow();
  });

  it("never lowers the stored best and ignores bad values", () => {
    const win = fakeWin({ [BEST_KEY]: "10" });
    saveBest(win, 4);
    saveBest(win, -1);
    saveBest(win, 2.5);
    saveBest(win, Number.NaN);
    expect(loadBest(win)).toBe(10);
    saveBest(win, 11);
    expect(loadBest(win)).toBe(11);
  });

  it("R7.3 round-trips: loadBest after saves is the max saved score", () => {
    fc.assert(
      fc.property(fc.array(fc.nat(1_000_000), { maxLength: 30 }), (scores) => {
        const win = fakeWin();
        for (const n of scores) saveBest(win, n);
        expect(loadBest(win)).toBe(Math.max(0, ...scores));
      }),
    );
  });
});
