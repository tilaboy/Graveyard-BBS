import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { EMOJI, STATUS, WORDS } from "../src/theme.js";

const md = readFileSync(
  resolve(import.meta.dirname, "../../../.kiro/steering/theme.md"),
  "utf8",
);
const section = (h: string) => md.split(`## ${h}`)[1]!.split("\n## ")[0]!;
const firstCells = (s: string) =>
  s
    .split("\n")
    .filter(
      (l) =>
        l.startsWith("| ") &&
        !l.startsWith("| Plain") &&
        !l.startsWith("| Emoji") &&
        !l.startsWith("|---"),
    )
    .map((l) => l.split("|")[1]!.trim());

describe("R5.1 theme.ts matches theme.md", () => {
  it("has exactly the emoji of 'Emoji per meaning'", () => {
    expect(new Set(firstCells(section("Emoji per meaning")))).toEqual(
      new Set(Object.values(EMOJI)),
    );
  });
  it("uses every phrase of the Words table", () => {
    const words = section("Words (UI copy)");
    for (const w of [
      WORDS.agent,
      WORDS.online,
      WORDS.sysop,
      WORDS.newPost,
      WORDS.ask,
      WORDS.done,
      WORDS.cancelled,
      WORDS.blocked,
      WORDS.lesson,
      WORDS.logout,
      WORDS.logoutLine,
    ])
      expect(words).toContain(w);
  });
  it("gives each status the emoji of its meaning", () => {
    expect(STATUS.pending.emoji).toBe(EMOJI.pending);
    expect(STATUS.running.emoji).toBe(EMOJI.running);
    expect(STATUS.blocked.emoji).toBe(EMOJI.blocked);
    expect(STATUS["awaiting-review"].emoji).toBe(EMOJI.review);
    expect(STATUS.done.emoji).toBe(EMOJI.done);
  });
});

describe("emoji render in the browser terminal", () => {
  it("every theme emoji is emoji-presentation, so it is drawn in colour and counts two cells", () => {
    for (const e of Object.values(EMOJI))
      for (const ch of e.replace(/\u200d|\ufe0f/g, ""))
        expect(ch, e).toMatch(/\p{Emoji_Presentation}/u);
  });
  it("the web client activates Unicode 11 widths and has an emoji font fallback", () => {
    const src = readFileSync(
      resolve(import.meta.dirname, "../src/client.ts"),
      "utf8",
    );
    expect(src).toContain("new Unicode11Addon()");
    expect(src).toContain('activeVersion = "11"');
    expect(src).toMatch(/Apple Color Emoji.*Segoe UI Emoji.*Noto Color Emoji/s);
  });
});
