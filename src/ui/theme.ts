/**
 * Only the sixteen named terminal colours are used, never hex or 256-colour
 * codes, so the UI inherits whatever palette the user has chosen instead of
 * fighting it. Colour is always redundant: a protected row is also refused and
 * also marked in text.
 */
export const roles = {
  heading: 'cyan',
  muted: 'gray',
  danger: 'red',
  warn: 'yellow',
  ok: 'green',
  accent: 'magenta',
} as const;

export type Role = keyof typeof roles;

/**
 * Honours NO_COLOR. Read on every call rather than at import time, because
 * `--no-color` is parsed after this module is loaded.
 */
export function colorEnabled(): boolean {
  return !process.env['NO_COLOR'];
}

export function color(role: Role): string | undefined {
  return colorEnabled() ? roles[role] : undefined;
}

const ELLIPSIS = '…';

/**
 * Code points a terminal draws two cells wide: CJK, Hangul, the fullwidth
 * forms, and emoji. Ranges rather than a table, and deliberately generous at
 * the edges - over-counting a character costs a space at the end of a row,
 * where under-counting costs the alignment of every row below it.
 */
function isWide(code: number): boolean {
  return (
    (code >= 0x1100 && code <= 0x115f) ||
    (code >= 0x2e80 && code <= 0x303e) ||
    (code >= 0x3041 && code <= 0x33ff) ||
    (code >= 0x3400 && code <= 0x4dbf) ||
    (code >= 0x4e00 && code <= 0x9fff) ||
    (code >= 0xa000 && code <= 0xa4cf) ||
    (code >= 0xa960 && code <= 0xa97f) ||
    (code >= 0xac00 && code <= 0xd7a3) ||
    (code >= 0xf900 && code <= 0xfaff) ||
    (code >= 0xfe10 && code <= 0xfe19) ||
    (code >= 0xfe30 && code <= 0xfe6f) ||
    (code >= 0xff00 && code <= 0xff60) ||
    (code >= 0xffe0 && code <= 0xffe6) ||
    (code >= 0x17000 && code <= 0x18aff) ||
    (code >= 0x1b000 && code <= 0x1b2ff) ||
    (code >= 0x1f300 && code <= 0x1f64f) ||
    (code >= 0x1f680 && code <= 0x1f6ff) ||
    (code >= 0x1f900 && code <= 0x1f9ff) ||
    (code >= 0x1fa70 && code <= 0x1faff) ||
    (code >= 0x20000 && code <= 0x3fffd)
  );
}

/** Combining marks, variation selectors, and skin tones: no cells of their own. */
function isZeroWidth(code: number): boolean {
  return (
    (code >= 0x0300 && code <= 0x036f) ||
    (code >= 0x0483 && code <= 0x0489) ||
    (code >= 0x0591 && code <= 0x05bd) ||
    (code >= 0x0610 && code <= 0x061a) ||
    (code >= 0x064b && code <= 0x065f) ||
    (code >= 0x0e31 && code <= 0x0e3a) ||
    (code >= 0x200b && code <= 0x200f) ||
    (code >= 0x20d0 && code <= 0x20ff) ||
    (code >= 0xfe00 && code <= 0xfe2f) ||
    (code >= 0x1f3fb && code <= 0x1f3ff)
  );
}

/**
 * How many cells a string occupies, which is not how many characters it has.
 *
 * Everything in the layout is measured with this rather than with `.length`.
 * A project directory called `店铺` is four cells and two code units; padding
 * it by code units puts the row two cells over the terminal width, and a row
 * one cell too wide wraps and destroys the alignment of every row below it -
 * the one thing the column arithmetic exists to prevent.
 */
export function displayWidth(value: string): number {
  let width = 0;
  for (const character of value) {
    const code = character.codePointAt(0)!;
    if (isZeroWidth(code)) continue;
    width += isWide(code) ? 2 : 1;
  }
  return width;
}

/**
 * Truncate with an ellipsis, so a cut value is visibly cut rather than a lie.
 * Cuts on code points, never between the halves of a surrogate pair, and
 * counts cells rather than characters.
 */
export function truncate(value: string, width: number): string {
  if (width <= 0) return '';
  if (displayWidth(value) <= width) return value;
  if (width === 1) return ELLIPSIS;

  let taken = '';
  let used = 0;
  for (const character of value) {
    const code = character.codePointAt(0)!;
    const size = isZeroWidth(code) ? 0 : isWide(code) ? 2 : 1;
    // One cell is held back for the ellipsis itself.
    if (used + size > width - 1) break;
    taken += character;
    used += size;
  }
  return taken + ELLIPSIS;
}

export function cell(value: string, width: number): string {
  const cut = truncate(value, width);
  // A wide character can leave the cell one cell short of its width, so the
  // padding is computed from the cells used rather than from the characters.
  return cut + ' '.repeat(Math.max(0, width - displayWidth(cut)));
}

export interface Layout {
  port: number;
  pid: number;
  user: number;
  process: number;
  address: number;
  description: number;
  total: number;
}

const PORT_WIDTH = 11; // "65535/tcp" plus a little slack
const PID_WIDTH = 7;
const USER_WIDTH = 10;
const PROCESS_WIDTH = 18;
const ADDRESS_WIDTH = 17;
const MIN_DESCRIPTION = 12;
/** What the description is worth before an optional column gets anything. */
const TARGET_DESCRIPTION = 28;

/**
 * Column widths that always add up to exactly the terminal width, including
 * the single-space gaps. Nothing may overflow: a row one character too wide
 * wraps, and a wrapped row destroys the alignment of every row below it.
 *
 * Columns are allocated by how much they carry. The port is never dropped,
 * the description is reserved next because it is the reason the tool exists,
 * and the rest compete for what is left - so an 80-column window keeps the
 * columns that matter and a 40-column one still reads.
 *
 * A zero width means the column is not shown at all.
 */
export function layout(totalWidth: number): Layout {
  const total = Math.max(24, Math.floor(totalWidth) || 80);

  const port = PORT_WIDTH;
  let budget = total - port;

  let description = Math.min(MIN_DESCRIPTION, budget - 1);
  budget -= description + 1;

  /** Take a column and its leading gap, or nothing if it does not fit. */
  const take = (want: number): number => {
    if (budget < want + 1) return 0;
    budget -= want + 1;
    return want;
  };

  const pid = take(PID_WIDTH);
  const process = take(PROCESS_WIDTH);
  const user = take(USER_WIDTH);

  // Bring the description up to a width that can hold "Vite dev server
  // (admin)" before spending anything on the address, which is the column
  // that carries the least. At 80 columns that is the difference between a
  // readable description and a truncated one.
  const bump = Math.min(TARGET_DESCRIPTION - description, budget);
  description += bump;
  budget -= bump;

  const address = take(ADDRESS_WIDTH);

  // Whatever is left widens the description rather than being left as a gap.
  description += budget;

  return { port, pid, user, process, address, description, total };
}
