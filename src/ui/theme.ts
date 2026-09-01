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

/** Truncate with an ellipsis, so a cut value is visibly cut rather than a lie. */
export function truncate(value: string, width: number): string {
  if (width <= 0) return '';
  if (value.length <= width) return value;
  if (width === 1) return ELLIPSIS;
  return value.slice(0, width - 1) + ELLIPSIS;
}

export function cell(value: string, width: number): string {
  return truncate(value, width).padEnd(width);
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
