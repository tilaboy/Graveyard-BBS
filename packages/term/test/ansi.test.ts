import { describe, expect, it } from "vitest";
import { box, pad, stripUnsafe, truncate, vlen, wrap } from "../src/ansi.js";

const E = "\x1b";

describe("R3.1 stripUnsafe", () => {
  it("removes clear-screen and cursor moves", () => {
    expect(stripUnsafe(`a${E}[2Jb${E}[1;1Hc${E}[?25lд`)).toBe("abcд");
  });
  it("removes OSC with BEL and ST terminators, and unterminated OSC", () => {
    expect(stripUnsafe(`x${E}]0;pwned\x07y`)).toBe("xy");
    expect(stripUnsafe(`x${E}]52;c;ZXZpbA==${E}\\y`)).toBe("xy");
    expect(stripUnsafe(`x${E}]8;;http://evil`)).toBe("x");
  });
  it("removes DCS/APC and C1 controls", () => {
    expect(stripUnsafe(`x${E}Pq#0${E}\\y${E}_app${E}\\z`)).toBe("xyz");
    expect(stripUnsafe("x\x9b2Jy\x9d0;t\x07z")).toBe("x2Jyz");
  });
  it("keeps safe SGR colours", () => {
    const s = `${E}[31mred${E}[0m ${E}[1;92mgreen${E}[0m ${E}[38;5;208morange${E}[0m`;
    expect(stripUnsafe(s)).toBe(s);
  });
  it("drops blink, reverse and malformed SGR", () => {
    expect(
      stripUnsafe(`${E}[5mx${E}[7my${E}[38;2;1;2;3mz${E}[38;5;999mw`),
    ).toBe("xyzw");
  });
  it("drops lone ESC, unterminated CSI, CR, BEL and bidi overrides; tabs become spaces", () => {
    expect(stripUnsafe(`a${E}`)).toBe("a");
    expect(stripUnsafe(`a${E}[12`)).toBe("a");
    expect(stripUnsafe("a\rb\x07c\u202ed\tx")).toBe("abcd    x");
  });
  it("leaves ordinary text, emoji and newlines alone", () => {
    expect(stripUnsafe("👻 builder-2 rises… running\nline 2")).toBe(
      "👻 builder-2 rises… running\nline 2",
    );
  });
});

describe("layout helpers", () => {
  it("vlen counts emoji as two cells and ignores SGR", () => {
    expect(vlen("👻ab")).toBe(4);
    expect(vlen(`${E}[31mab${E}[0m`)).toBe(2);
    expect(vlen("⚰ok")).toBe(3);
  });
  it("truncate cuts to width and keeps short text", () => {
    expect(vlen(truncate("abcdefghij", 5))).toBeLessThanOrEqual(5);
    expect(truncate("abc", 5)).toBe("abc");
    expect(vlen(truncate("👻👻👻👻", 5))).toBeLessThanOrEqual(5);
  });
  it("pad and wrap respect width", () => {
    expect(vlen(pad("👻", 6))).toBe(6);
    for (const l of wrap("one two three four five six seven", 10))
      expect(vlen(l)).toBeLessThanOrEqual(10);
    expect(wrap("a\nb", 10)).toEqual(["a", "b"]);
  });
  it("box lines all have the same width", () => {
    const lines = box(
      ["hi", "👻 a longer line that must be cut off here"],
      20,
      { title: "T", double: true },
    );
    expect(new Set(lines.map(vlen))).toEqual(new Set([20]));
  });
});
