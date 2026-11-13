/** Task 1: ANSI helpers, box drawing and the safe-text stripper (R3.1, posts-are-data.md). */

export const ESC = "\x1b";
export const RESET = `${ESC}[0m`;

/** Wrap text in an SGR style. Empty style returns the text unchanged. */
export const sgr = (style: string, s: string): string =>
  style ? `${ESC}[${style}m${s}${RESET}` : s;

const SGR_ANY = /\x1b\[[0-9;]*m/g;
// Colour subset only: reset, bold, dim, italic, underline, normal intensity, fg/bg 8+16 colours.
// Blink (5/6) and reverse (7) stay reserved for the UI itself.
const SAFE_NUM = /^(?:0|1|2|3|4|22|23|24|3[0-79]|4[0-79]|9[0-7]|10[0-7])?$/;

function safeSgr(params: string): boolean {
  const t = params.split(";");
  for (let i = 0; i < t.length; i++) {
    const tok = t[i] ?? "";
    if (tok === "38" || tok === "48") {
      const n = Number(t[i + 2]);
      if (t[i + 1] !== "5" || !Number.isInteger(n) || n < 0 || n > 255)
        return false;
      i += 2;
    } else if (!SAFE_NUM.test(tok)) return false;
  }
  return true;
}

// One pass, one alternative per kind of control string. Order matters: strings before bare ESC.
const CONTROL =
  // OSC, DCS/APC/PM/SOS, CSI (final byte optional), any other ESC, C1 OSC, remaining C0/C1/bidi controls.
  /\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)?|\x1b[P_^X][^\x1b]*(?:\x1b\\)?|\x1b\[([0-?]*)([ -/]*)([@-~])?|\x1b[\s\S]?|\x9d[^\x07\x9c]*[\x07\x9c]?|[\x00-\x08\x0b-\x1f\x7f-\x9f\u202a-\u202e\u2066-\u2069]/g;

/** R3.1: drop every control sequence from untrusted text except safe SGR colours. Tabs become spaces. */
export function stripUnsafe(s: string): string {
  return s
    .replace(CONTROL, (m, params?: string, inter?: string, fin?: string) =>
      fin === "m" && !inter && safeSgr(params ?? "") ? m : "",
    )
    .replace(/\t/g, "    ");
}

/** Visible width: SGR is zero, emoji presentation is two cells, joiners are zero. */
export function vlen(s: string): number {
  let n = 0;
  for (const ch of s.replace(SGR_ANY, "")) {
    if (ch === "\u200d" || ch === "\ufe0f") continue;
    n += /\p{Emoji_Presentation}/u.test(ch) ? 2 : 1;
  }
  return n;
}

/** Cut to `n` visible cells, keeping SGR and closing it when something was cut. */
export function truncate(s: string, n: number): string {
  if (vlen(s) <= n) return s;
  let out = "";
  let w = 0;
  for (const part of s.split(/(\x1b\[[0-9;]*m)/)) {
    if (part.startsWith(ESC)) {
      out += part;
      continue;
    }
    for (const ch of part) {
      const cw = vlen(ch);
      if (w + cw > n - 1) return `${out}…${RESET}`;
      out += ch;
      w += cw;
    }
  }
  return out;
}

export const pad = (s: string, n: number): string =>
  s + " ".repeat(Math.max(0, n - vlen(s)));

/** Word wrap to `n` cells. Existing newlines are kept; over-long words are cut. */
export function wrap(text: string, n: number): string[] {
  const out: string[] = [];
  for (const para of text.split("\n")) {
    let cur = "";
    for (const word of para.split(" ")) {
      if (cur && vlen(cur) + 1 + vlen(word) > n) {
        out.push(cur);
        cur = "";
      }
      cur = cur ? `${cur} ${word}` : word;
      if (vlen(cur) > n) {
        out.push(truncate(cur, n));
        cur = "";
      }
    }
    out.push(cur);
  }
  return out;
}

export interface BoxStyle {
  double?: boolean;
  style?: string;
  title?: string;
}

/** A box `width` cells wide around `lines`. Lines are cut to fit. */
export function box(
  lines: string[],
  width: number,
  o: BoxStyle = {},
): string[] {
  const [tl, h, tr, v, bl, br] = o.double
    ? ["╔", "═", "╗", "║", "╚", "╝"]
    : ["┌", "─", "┐", "│", "└", "┘"];
  const inner = width - 2;
  const title = o.title ? ` ${o.title} ` : "";
  const c = (s: string) => sgr(o.style ?? "", s);
  return [
    c(tl + title + h.repeat(Math.max(0, inner - vlen(title))) + tr),
    ...lines.map((l) => `${c(v)}${pad(truncate(l, inner), inner)}${c(v)}`),
    c(bl + h.repeat(inner) + br),
  ];
}
