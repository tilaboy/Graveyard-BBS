import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { guessBoard } from "../src/route.js";
import { boardNames } from "../src/state.js";

// Issue #2: the Sysop should not have to pick the board; the task's own words choose it.
describe("guessBoard: a task's words choose its board", () => {
  it.each([
    ["Graveyard Invaders — a space shooter game with levels", "arcade"],
    ["Haunted landing page — signup form and HTML/CSS", "websites"],
    ["Pitch deck for demo day — 10 slides", "slides"],
    ["Pumpkin logo — an icon image for the app", "media"],
    [
      "Address Git Repo Issue 2 — https://github.com/tilaboy/Graveyard-BBS/issues/2",
      "bugfix",
    ],
    ["Login crashes with an error after the update", "bugfix"],
  ])("%s → #%s", (text, board) => {
    expect(guessBoard(text)?.board).toBe(board);
  });

  it("names the words that chose the board", () => {
    expect(guessBoard("Snake game with a high score")).toEqual({
      board: "arcade",
      why: ["snake", "game", "score"],
    });
  });

  it("matches plurals and any case", () => {
    expect(guessBoard("Two BUGS, one CRASH")?.why).toEqual(["bugs", "crash"]);
  });

  it("the board with the most matching words wins", () => {
    expect(guessBoard("Fix the website signup page")?.board).toBe("websites");
  });

  it("returns undefined when no word fits a board", () => {
    expect(guessBoard("Dig the grave with a spade")).toBeUndefined();
    expect(guessBoard("")).toBeUndefined();
  });

  it("R2.1 any text gives one of the five boards or nothing, the same every time", () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 200 }), (text) => {
        const g = guessBoard(text);
        expect(g).toEqual(guessBoard(text));
        if (g) {
          expect(boardNames()).toContain(g.board);
          expect(g.why.length).toBeGreaterThan(0);
        }
      }),
    );
  });

  it("R2.2 adding a board's keyword never moves the guess away from that board", () => {
    const words = ["game", "website", "slides", "logo", "bug"] as const;
    const boards = ["arcade", "websites", "slides", "media", "bugfix"];
    fc.assert(
      fc.property(
        fc.array(fc.constantFrom(...words), { minLength: 1, maxLength: 8 }),
        fc.integer({ min: 0, max: 4 }),
        (picked, i) => {
          const before = guessBoard(picked.join(" "));
          if (before?.board !== boards[i]) return;
          const after = guessBoard(`${picked.join(" ")} ${words[i]}`);
          expect(after?.board).toBe(boards[i]);
        },
      ),
    );
  });
});
