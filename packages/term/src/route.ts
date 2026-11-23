import { BOARDS } from "./state.js";

type Board = (typeof BOARDS)[number];

/**
 * Issue #2: words that point a new task at a board. A word also matches with a trailing
 * "s" or "es" ("games", "crashes"). Keep each word on one board only.
 */
const WORDS: Record<Board, readonly string[]> = {
  arcade: [
    "arcade",
    "game",
    "play",
    "player",
    "level",
    "score",
    "sprite",
    "invader",
    "pong",
    "snake",
    "tetris",
    "puzzle",
    "platformer",
    "shooter",
    "joystick",
  ],
  websites: [
    "website",
    "site",
    "web",
    "webpage",
    "page",
    "landing",
    "homepage",
    "html",
    "css",
    "signup",
    "form",
    "frontend",
    "blog",
    "portfolio",
  ],
  slides: [
    "slide",
    "deck",
    "presentation",
    "pitch",
    "talk",
    "keynote",
    "powerpoint",
    "outline",
  ],
  media: [
    "media",
    "image",
    "picture",
    "photo",
    "logo",
    "icon",
    "art",
    "artwork",
    "illustration",
    "poster",
    "banner",
    "video",
    "gif",
    "avatar",
    "wallpaper",
    "thumbnail",
  ],
  bugfix: [
    "bug",
    "bugfix",
    "fix",
    "issue",
    "crash",
    "error",
    "broken",
    "fail",
    "failing",
    "regression",
    "stuck",
    "repair",
    "exception",
  ],
};

const OWNER = new Map<string, Board>(
  BOARDS.flatMap((b) => WORDS[b].map((w) => [w, b] as const)),
);

const boardOfWord = (t: string): Board | undefined =>
  OWNER.get(t) ??
  (t.endsWith("es") ? OWNER.get(t.slice(0, -2)) : undefined) ??
  (t.endsWith("s") ? OWNER.get(t.slice(0, -1)) : undefined);

export interface BoardGuess {
  board: Board;
  /** The words of the text that chose the board, first seen first, each once. */
  why: string[];
}

/**
 * Pick a board for a new task from its words: the board with the most matching words wins,
 * a tie goes to the board listed first. Undefined when no word fits any board.
 */
export function guessBoard(text: string): BoardGuess | undefined {
  const hits = new Map<Board, string[]>();
  for (const t of new Set(text.toLowerCase().match(/[a-z0-9]+/g) ?? [])) {
    const b = boardOfWord(t);
    if (b) hits.set(b, [...(hits.get(b) ?? []), t]);
  }
  let best: BoardGuess | undefined;
  for (const b of BOARDS) {
    const why = hits.get(b);
    if (why && why.length > (best?.why.length ?? 0)) best = { board: b, why };
  }
  return best;
}

/** The new-task form's Board value that lets the words choose. */
export const AUTO_BOARD = "auto";

/** The guess for a form's title and body (what the Board field previews and submit uses). */
export const formGuess = (f: {
  title: string;
  body: string;
}): BoardGuess | undefined => guessBoard(`${f.title}\n${f.body}`);
