import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { ERROR_CODES, VOICE, fail, renderAccessDenied } from "../src/index.js";
import { commandArbs, simulate } from "./sim.js";

describe("voice (R1.8)", () => {
  it("every error code has a themed voice line", () => {
    for (const c of ERROR_CODES) expect(VOICE[c].length).toBeGreaterThan(10);
  });
  it("ACCESS DENIED box keeps the plain facts: code, message, hint", () => {
    const r = fail(
      "ILLEGAL_TRANSITION",
      "running → done: no such transition",
      "Submit for review.",
    );
    if (r.ok) throw new Error("unreachable");
    const box = renderAccessDenied(r.error);
    expect(box).toContain("ACCESS DENIED · ILLEGAL_TRANSITION  running → done");
    expect(box).toContain(
      "Not even the Sysop may raise the dead without a review.",
    );
    expect(box).toContain("hint: Submit for review.");
  });
  it("every refusal a command can produce carries a hint and a voice line", () => {
    const seen = new Set<string>();
    fc.assert(
      fc.property(
        fc.commands(commandArbs, { maxCommands: 60, size: "max" }),
        (c) => {
          for (const e of simulate(c).errors) {
            seen.add(e.code);
            expect(e.hint.length).toBeGreaterThan(0);
            expect(e.voice).toBe(VOICE[e.code]);
          }
        },
      ),
      { numRuns: 200 },
    );
    expect(seen.size).toBeGreaterThanOrEqual(5);
  });
});
