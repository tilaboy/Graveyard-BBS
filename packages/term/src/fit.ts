/** Terminal size from the space it has: whole cells only, never below 80x24. */
export const MIN_COLS = 80;
export const MIN_ROWS = 24;

export function fitSize(
  space: { width: number; height: number },
  cell: { width: number; height: number },
): { cols: number; rows: number } {
  const n = (px: number, c: number) =>
    c > 0 && Number.isFinite(px) ? Math.floor(px / c) : 0;
  return {
    cols: Math.max(MIN_COLS, n(space.width, cell.width)),
    rows: Math.max(MIN_ROWS, n(space.height, cell.height)),
  };
}
