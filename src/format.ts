import { riskSentence } from './explain.js';
import { matchesPort, tryPortSelector } from './ports.js';
import type { Mode, PortEntry } from './types.js';

/** Shown wherever a value is genuinely absent, rather than an empty column. */
export const ABSENT = '-';

export function formatPort(entry: PortEntry): string {
  return `${entry.port}/${entry.protocol}`;
}

export function formatPid(entry: PortEntry): string {
  return entry.pid === null ? ABSENT : String(entry.pid);
}

export function formatUser(entry: PortEntry): string {
  return entry.user ?? ABSENT;
}

export function formatProcess(entry: PortEntry): string {
  return entry.processName ?? ABSENT;
}

export function formatAddresses(entry: PortEntry): string {
  return entry.addresses.join(', ');
}

/**
 * The description column: what it is, which project, and whether you can do
 * anything about it. A guarded row is never also marked `[locked]` - it is
 * refused whoever you are, so the extra badge would only add noise.
 *
 * A row nothing could be worked out about shows `-`, never the process name
 * over again. The process is already a column; repeating it here would dress
 * "slash-port has no idea" up as an answer.
 */
export function formatDescription(entry: PortEntry): string {
  const parts = [entry.label ?? ABSENT];
  if (entry.hint) parts.push(`(${entry.hint})`);
  if (entry.guard) parts.push('[protected]');
  else if (entry.elevation) parts.push('[locked]');
  return parts.join(' ');
}

/** Everything a row can be matched on, lowercased once for filtering. */
export function searchText(entry: PortEntry): string {
  return [
    String(entry.port),
    entry.protocol,
    formatPid(entry),
    entry.user ?? '',
    entry.processName ?? '',
    entry.label ?? '',
    entry.category,
    entry.hint ?? '',
    entry.addresses.join(' '),
    entry.command ?? '',
  ]
    .join(' ')
    .toLowerCase();
}

export function matchesFilter(entry: PortEntry, filter: string): boolean {
  const needle = filter.trim().toLowerCase();
  if (!needle) return true;
  // `3xxx` and `3000:3005` can mean nothing but ports, so they are matched as
  // ports. A bare `3000` stays a substring, because it is also half a pid.
  const selector = tryPortSelector(needle);
  if (selector) return matchesPort(selector, entry.port);
  return searchText(entry).includes(needle);
}

/**
 * The plain-text table used whenever output is not a terminal. Aligned to the
 * widest value in each column and containing no control codes at all, so it
 * survives a pipe, a redirect, and a `grep`.
 *
 * The first six columns are the same in both modes and always will be: a
 * script that already splits this output keeps working. Mode only ever adds a
 * column on the end - what closing it would mean for a beginner, the command
 * line for everybody else - because appending is the one change to a table
 * that cannot break a reader of it.
 */
export function plainTable(entries: readonly PortEntry[], mode: Mode = 'beginner'): string {
  const beginner = mode === 'beginner';
  const header = ['PORT', 'PID', 'USER', 'PROCESS', 'ADDRESS', 'DESCRIPTION'];
  header.push(beginner ? 'CAN I CLOSE IT?' : 'COMMAND');

  const rows = entries.map((entry) => [
    formatPort(entry),
    formatPid(entry),
    formatUser(entry),
    formatProcess(entry),
    formatAddresses(entry),
    formatDescription(entry),
    beginner ? riskSentence(entry) : (entry.command ?? ABSENT),
  ]);

  const widths = header.map((label, column) =>
    Math.max(label.length, ...rows.map((row) => row[column]!.length), 0),
  );

  const render = (row: string[]): string =>
    row
      .map((value, column) => (column === row.length - 1 ? value : value.padEnd(widths[column]!)))
      .join('  ')
      .trimEnd();

  return [render(header), ...rows.map(render)].join('\n');
}

/**
 * The `--json` shape: a superset of every mode, because a program reading this
 * has no mode. Fields are added over time and never repurposed, so `jq` on an
 * old field keeps working.
 *
 * `description` is null rather than a repeat of `process` when nothing could be
 * identified, which is the one thing here that a reader has to know: absence is
 * reported as absence.
 */
export function toJson(entries: readonly PortEntry[]): unknown {
  return entries.map((entry) => ({
    port: entry.port,
    protocol: entry.protocol,
    addresses: entry.addresses,
    families: entry.families,
    pid: entry.pid,
    user: entry.user,
    process: entry.processName,
    command: entry.command,
    description: entry.label,
    descriptionSource: entry.source,
    category: entry.category,
    project: entry.hint,
    summary: entry.summary,
    url: entry.url,
    restart: entry.restart,
    risk: entry.risk,
    riskReason: entry.riskReason,
    protected: entry.guard !== null,
    protectedReason: entry.guard,
    locked: entry.elevation !== null,
    lockedReason: entry.elevation,
  }));
}
