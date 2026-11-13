export const ERROR_CODES = [
  "ILLEGAL_TRANSITION",
  "NO_EVIDENCE",
  "SELF_REVIEW",
  "ROLE_DENIED",
  "NO_ACK",
  "STALE_TOKEN",
  "BUDGET_EXHAUSTED",
  "NOT_FOUND",
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];

/** Fixed Halloween voice lines (theme.md). Spooky wrapper; `message` and `hint` carry the plain facts. */
export const VOICE: Record<ErrorCode, string> = {
  ILLEGAL_TRANSITION:
    "Not even the Sysop may raise the dead without a review. The tests must be run. The reviewer must speak.",
  NO_EVIDENCE:
    "The grave is empty. Bring proof from the test door, or the veil stays shut.",
  SELF_REVIEW:
    "A ghost may not judge its own haunting. Another reviewer must speak.",
  ROLE_DENIED:
    "This door is sealed to your kind. The crypt does not know your name.",
  NO_ACK: "You have not read the scroll. Post your ACK, then knock again.",
  STALE_TOKEN: "Your key has rotted. Another spirit holds the lock now.",
  BUDGET_EXHAUSTED:
    "The candle has burned down to nothing. Ask the Gravekeeper for more wax.",
  NOT_FOUND: "The spirits searched the whole graveyard. Nothing lies there.",
};

export interface DomainError {
  code: ErrorCode;
  /** Plain fact: what was refused and the missing precondition. */
  message: string;
  /** Plain advice: what to do next. */
  hint: string;
  /** Themed line for the ACCESS DENIED box. */
  voice: string;
}

export type Result<T, E = DomainError> =
  { ok: true; value: T } | { ok: false; error: E };
export const ok = <T>(value: T): Result<T, never> => ({ ok: true, value });
export const fail = (
  code: ErrorCode,
  message: string,
  hint: string,
): Result<never> => ({
  ok: false,
  error: { code, message, hint, voice: VOICE[code] },
});

/** The ACCESS DENIED box shown in the terminal. Plain facts stay in the first line. */
export function renderAccessDenied(e: DomainError): string {
  return [
    ` ☠  ACCESS DENIED · ${e.code}  ${e.message}`,
    ` > "${e.voice}"`,
    ` > hint: ${e.hint}`,
  ].join("\n");
}
