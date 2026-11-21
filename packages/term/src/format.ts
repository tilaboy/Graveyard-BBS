/**
 * Post bodies laid out for reading. Render only: stored events are never changed.
 * A body becomes blocks (lead line, sentence lines, `Label:` lines, bullets), then lines wrapped
 * with a hanging indent. Words are never cut, so a file path is never broken, and paths get
 * their own colour.
 */
import { ESC, sgr, vlen } from "./ansi.js";
import { COLOR } from "./theme.js";

export type Block =
  | { kind: "text"; text: string }
  | { kind: "label"; label: string; text: string }
  | { kind: "item"; mark: string; text: string; depth: number };

/** Split at `sep` outside () and []. */
function splitTop(s: string, sep: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = "";
  for (const ch of s) {
    if (ch === "(" || ch === "[") depth++;
    else if ((ch === ")" || ch === "]") && depth > 0) depth--;
    if (ch === sep && depth === 0) {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  out.push(cur);
  return out.map((x) => x.trim()).filter(Boolean);
}

/** A file path: has a `/` and ends in an extension or in `/`. */
export function isPath(word: string): boolean {
  const core = word.replace(/^[(["'`]+/, "").replace(/[)\]"'`,;:!?]+$/, "");
  return (
    core.includes("/") &&
    (/\/\.?$/.test(core) || /\.[A-Za-z0-9]{1,8}$/.test(core))
  );
}

const BULLET = /^(\s*)([-*•]|\d{1,2}[.)]|\(\d{1,2}\))\s+(.*)$/;
const ENUM = /(?:^|\s)(\(\d{1,2}\)|\d{1,2}\))\s/g;
const LABEL = /^([A-Z][A-Za-z0-9 ._/-]{0,28}):\s+(.*)$/s;
const SENTENCE = /(?<=[.!?])\s+(?=[A-Z0-9"'`\p{Extended_Pictographic}])/u;
/** Trailing list glue: `;`, `,`, `, and`, `; or`. */
const tidy = (s: string): string =>
  s.replace(/\s*[;,](?:\s*(?:and|or))?\s*$/, "").trim();

/** One sentence: an enumeration, a `Label: value`, a `;` list, or a plain line. */
function sentence(s: string): Block[] {
  const en = [...s.matchAll(ENUM)];
  if (en.length >= 2 || (en.length === 1 && en[0]!.index === 0)) {
    const out: Block[] = [];
    const pre = s.slice(0, en[0]!.index).trim();
    if (pre) out.push(...sentence(pre));
    en.forEach((m, i) => {
      const from = m.index + m[0].length;
      const to = en[i + 1]?.index ?? s.length;
      out.push({
        kind: "item",
        mark: m[1]!,
        text: tidy(s.slice(from, to)),
        depth: 0,
      });
    });
    return out;
  }
  const lab = LABEL.exec(s);
  if (lab && lab[1]!.split(" ").length <= 4) {
    const [label, value] = [lab[1]!, lab[2]!.trim()];
    const semi = splitTop(value, ";");
    const comma = splitTop(value, ",");
    const items =
      semi.length >= 2
        ? semi
        : comma.length >= 2 &&
            comma.filter((c) => c.split(" ").some(isPath)).length >= 2
          ? comma
          : undefined;
    if (!items) return [{ kind: "label", label, text: value }];
    return [
      { kind: "label", label, text: "" },
      ...items.map((t): Block => ({
        kind: "item",
        mark: "•",
        text: tidy(t),
        depth: 1,
      })),
    ];
  }
  const semi = splitTop(s, ";");
  if (semi.length >= 2)
    return semi.map((t) => ({
      kind: "item",
      mark: "•",
      text: tidy(t),
      depth: 0,
    }));
  return [{ kind: "text", text: s }];
}

/** Body text to blocks. Lines the author already wrote as bullets stay bullets. */
export function blocks(text: string): Block[] {
  const out: Block[] = [];
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    const b = BULLET.exec(line);
    if (b) {
      out.push({
        kind: "item",
        mark: /^[-*•]$/.test(b[2]!) ? "•" : b[2]!,
        text: b[3]!.trim(),
        depth: b[1]!.length >= 2 ? 1 : 0,
      });
      continue;
    }
    for (const s of line.trim().split(SENTENCE)) out.push(...sentence(s));
  }
  return out;
}

const PICTO = /^((?:\p{Extended_Pictographic}|\u200d|\ufe0f)+)\s*/u;

/** Drop a leading emoji from the body when the post header already shows it. */
export function stripLeadEmoji(text: string, head: string): string {
  const m = PICTO.exec(text);
  if (!m) return text;
  const chars = [...m[1]!.replace(/\u200d|\ufe0f/g, "")];
  return chars.every((c) => head.includes(c)) ? text.slice(m[0].length) : text;
}

/** Greedy wrap of whole words; a word longer than the line gets a line of its own, uncut. */
function flow(
  first: number,
  words: string[],
  hang: number,
  w: number,
): string[] {
  const out: string[] = [];
  let cur = "";
  let len = first;
  for (const word of words) {
    const n = vlen(word);
    if (cur && len + 1 + n > w) {
      out.push(cur);
      cur = "";
      len = hang;
    }
    len += (cur ? 1 : 0) + n;
    cur = cur ? `${cur} ${word}` : word;
  }
  out.push(cur);
  return out;
}

const PATHS = /[\w.~@+-]*(?:\/[\w.~@+-]*)+/g;

/** Where file paths sit in plain text: `[start, end)` string offsets, the same ones `paint` colours. */
export function pathSpans(
  text: string,
): { start: number; end: number; path: string }[] {
  return [...text.matchAll(PATHS)].flatMap((m) => {
    const path = m[0].replace(/\.+$/, "");
    return isPath(path)
      ? [{ start: m.index, end: m.index + path.length, path }]
      : [];
  });
}

/** The distinct file paths a text names, in order. */
export const pathsIn = (text: string): string[] => [
  ...new Set(pathSpans(text).map((p) => p.path)),
];

/** Style a plain run, file paths in their own colour. */
function paint(s: string, style: string): string {
  const back = `${ESC}[0${style ? `;${style}` : ""}m`;
  return sgr(
    style,
    s.replace(PATHS, (m) => {
      const core = m.replace(/\.+$/, "");
      if (!isPath(core)) return m;
      return `${ESC}[0;${COLOR.path}m${core}${back}${m.slice(core.length)}`;
    }),
  );
}

/** Blocks to lines at most `w` cells wide (paths may overflow rather than break). */
export function layout(bs: Block[], w: number, style: string): string[] {
  const out: string[] = [];
  for (const b of bs) {
    const words = b.text.split(" ").filter(Boolean);
    if (b.kind === "text") {
      out.push(...flow(0, words, 0, w).map((l) => paint(l, style)));
    } else if (b.kind === "label") {
      const head = `${b.label}:`;
      const ls = words.length ? flow(vlen(head) + 1, words, 2, w) : [""];
      ls.forEach((l, i) =>
        out.push(
          i === 0
            ? `${sgr(`${style ? `${style};` : ""}${COLOR.bold}`, head)}${l ? ` ${paint(l, style)}` : ""}`
            : `  ${paint(l, style)}`,
        ),
      );
    } else {
      const lead = `${"  ".repeat(b.depth)}${b.mark} `;
      const hang = " ".repeat(vlen(lead));
      flow(lead.length, words, hang.length, w).forEach((l, i) =>
        out.push(`${i === 0 ? sgr(style, lead) : hang}${paint(l, style)}`),
      );
    }
  }
  return out;
}

/** The whole pipeline for one body: leading emoji the head shows dropped, blocks, lines. */
export const formatBody = (
  text: string,
  head: string,
  w: number,
  style: string,
): string[] => layout(blocks(stripLeadEmoji(text, head)), w, style);
