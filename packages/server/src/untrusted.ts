/**
 * R3.3 / posts-are-data.md: post text reaches agents as quoted data.
 * Control characters (incl. ESC, so no ANSI) are removed, and `<`, `>`, `&` are escaped so a post
 * can never close its own wrapper or open another one.
 */
const CONTROL = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/g;

export const stripControl = (s: string): string => s.replace(CONTROL, "");

export function wrapPost(
  from: string,
  seq: number,
  type: string,
  text: string,
): string {
  const esc = (s: string) =>
    stripControl(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  return `<post from="${esc(from).replace(/"/g, "&quot;")}" seq="${seq}" type="${type}">${esc(text)}</post>`;
}
