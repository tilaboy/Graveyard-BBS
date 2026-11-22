/**
 * Task 15: the one token table for words, emoji, colours, motion and sound.
 * Source of truth is `.kiro/steering/theme.md`; test/theme.test.ts fails when they drift.
 * Screens import from here and never hard-code an emoji or a colour.
 */
import type { EventType, Status } from "@graveyard/core";

/** One meaning each (theme.md "Emoji per meaning"). */
export const EMOJI = {
  agent: "👻",
  sysop: "🎃",
  pending: "🌙",
  running: "🔥",
  blocked: "🔒",
  review: "🔮",
  done: "✅",
  refusal: "💀",
  ask: "❓🦇",
  lesson: "🪦",
  idle: "💤",
  evidence: "🧪",
  monster: "🧟",
} as const;

/** Words (UI copy). Code identifiers stay plain; only rendered text is themed. */
export const WORDS = {
  agent: "ghost",
  online: "haunting",
  sysop: "the Gravekeeper",
  newPost: "a whisper from the beyond",
  ask: "the spirits summon you",
  done: "laid to rest",
  cancelled: "exorcised",
  blocked: "trapped in the crypt",
  lesson: "an epitaph",
  logout: "NO CARRIER",
  logoutLine: "the line goes cold",
} as const;

/** SGR parameters. Orange needs 256 colours; everything else is 16-colour ANSI. */
export const COLOR = {
  sysop: "38;5;208", // pumpkin orange
  agent: "97", // ghost white
  note: "37", // bone grey
  error: "91", // blood red
  pass: "92", // poison green
  witch: "35", // witch purple (TRIED, lessons)
  ask: "93", // candle yellow
  path: "36", // ectoplasm cyan (file paths in posts)
  dim: "2",
  bold: "1",
  blink: "5",
  inverse: "7",
} as const;

interface StatusTheme {
  emoji: string;
  color: string;
  /** Short themed phrase; the plain status name is always printed beside it. */
  phrase: string;
}

export const STATUS: Record<Status, StatusTheme> = {
  pending: {
    emoji: EMOJI.pending,
    color: COLOR.note,
    phrase: "waits in the dark",
  },
  running: {
    emoji: EMOJI.running,
    color: COLOR.sysop,
    phrase: "rises from the grave",
  },
  blocked: { emoji: EMOJI.blocked, color: COLOR.ask, phrase: WORDS.blocked },
  "awaiting-review": {
    emoji: EMOJI.review,
    color: COLOR.witch,
    phrase: "awaits the reviewer",
  },
  done: { emoji: EMOJI.done, color: COLOR.pass, phrase: WORDS.done },
  cancelled: { emoji: "", color: COLOR.note, phrase: WORDS.cancelled },
};

/** Colour per post type (theme.md "Colours"). */
export const POST_COLOR: Record<EventType, string> = {
  TASK: COLOR.note,
  NOTE: COLOR.note,
  ASK: COLOR.ask,
  ANSWER: COLOR.sysop,
  MILESTONE: COLOR.agent,
  EVIDENCE: COLOR.note,
  TRIED: COLOR.witch,
  REVIEW: COLOR.witch,
  CLAIM: COLOR.note,
  GRANT: COLOR.note,
  QUEUE: COLOR.note,
  RELEASE: COLOR.note,
  HEARTBEAT: COLOR.note,
  STATUS: COLOR.note,
  ACK: COLOR.note,
  REP: COLOR.agent,
  SYSTEM: COLOR.note,
};

/** Motion table: durations in ms. Flicker toggles at most twice a second (never > 3 Hz). */
export const MOTION = {
  login: 3000,
  mist: 400,
  ghost: 600,
  flickerHalfPeriod: 500,
  shake: 300,
  lid: 500,
  fog: 800,
  /** The needs-you monster moves one cell per step along its lane. */
  crawl: 250,
} as const;

/** Sound names, and when they play (theme.md "Sound"). */
export const SOUNDS = [
  "modem",
  "bell",
  "organ",
  "thud",
  "wind",
  "nocarrier",
  "chime",
] as const;
export type SoundName = (typeof SOUNDS)[number];

/** `???` bell repeats until the Sysop answers. */
export const BELL_REPEAT_MS = 60_000;

/** The login splash enters the tree by itself after this long with no key. */
export const LOGIN_AUTO_MS = 4000;
