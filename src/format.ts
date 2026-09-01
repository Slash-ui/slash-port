import { matchesPort, tryPortSelector } from './ports.js';
import type { PortEntry } from './types.js';

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

/** The description column: what it is, which project, and whether it is protected. */
export function formatDescription(entry: PortEntry): string {
  const parts = [entry.label];
  if (entry.hint) parts.push(`(${entry.hint})`);
  if (entry.guard) parts.push('[protected]');
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
    entry.label,
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
 */
export function plainTable(entries: readonly PortEntry[]): string {
  const header = ['PORT', 'PID', 'USER', 'PROCESS', 'ADDRESS', 'DESCRIPTION'];
  const rows = entries.map((entry) => [
    formatPort(entry),
    formatPid(entry),
    formatUser(entry),
    formatProcess(entry),
    formatAddresses(entry),
    formatDescription(entry),
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

/** The `--json` shape. Stable, and a superset of what the table shows. */
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
    project: entry.hint,
    protected: entry.guard !== null,
    protectedReason: entry.guard,
  }));
}
