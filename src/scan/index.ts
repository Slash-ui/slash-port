import { describe, guardReason } from '../describe.js';
import { ScanError } from '../types.js';
import type { Family, PortEntry, RawSocket, ScanOptions } from '../types.js';
import { scanDarwin } from './darwin.js';
import { scanLinux } from './linux.js';
import { normaliseAddress } from './shared.js';
import { scanWin32 } from './win32.js';

export { ScanError } from '../types.js';

const PROTOCOL_ORDER = { tcp: 0, udp: 1 } as const;

/**
 * Collapse the sockets of one server into one row.
 *
 * A process bound to both `0.0.0.0` and `::` on port 3000 is one dev server,
 * not two, and listing it twice makes a busy machine unreadable. Rows with an
 * unresolved pid stay separate from owned ones, because there is no evidence
 * they are the same process.
 */
export function collapse(sockets: readonly RawSocket[]): PortEntry[] {
  const groups = new Map<string, { sockets: RawSocket[] }>();

  for (const socket of sockets) {
    const id = `${socket.protocol}:${socket.port}:${socket.pid ?? 'unowned'}`;
    const group = groups.get(id);
    if (group) group.sockets.push(socket);
    else groups.set(id, { sockets: [socket] });
  }

  const entries: PortEntry[] = [];

  for (const [id, group] of groups) {
    const first = group.sockets[0]!;
    // Prefer whichever socket carried the most process detail; on Linux the
    // IPv4 and IPv6 rows of one server can resolve differently.
    const richest = group.sockets.find((socket) => socket.command) ?? first;

    // Normalised here as well as in the scanners, so this funnel is the one
    // place that decides how an address is displayed.
    const addresses = [...new Set(group.sockets.map((socket) => normaliseAddress(socket.address)))].sort();
    const families = [...new Set(group.sockets.map((socket) => socket.family))].sort() as Family[];

    const base = {
      id,
      protocol: first.protocol,
      port: first.port,
      addresses,
      families,
      pid: first.pid,
      processName: richest.processName ?? first.processName,
      command: richest.command,
      user: richest.user ?? first.user,
    };

    const description = describe(base);

    entries.push({
      ...base,
      label: description.label,
      hint: description.hint,
      guard: guardReason(base),
    });
  }

  return sortEntries(entries);
}

export function sortEntries(entries: PortEntry[]): PortEntry[] {
  return entries.sort(
    (a, b) => a.port - b.port || PROTOCOL_ORDER[a.protocol] - PROTOCOL_ORDER[b.protocol] || (a.pid ?? 0) - (b.pid ?? 0),
  );
}

/** Read the local socket table. Nothing in this path touches the network. */
export async function scan(options: ScanOptions = {}): Promise<PortEntry[]> {
  switch (process.platform) {
    case 'linux':
      return collapse(await scanLinux(options));
    case 'darwin':
      return collapse(await scanDarwin(options));
    case 'win32':
      return collapse(await scanWin32(options));
    default:
      throw new ScanError(
        `slash-port has no scanner for ${process.platform}.`,
        'Supported platforms are Linux, macOS, and Windows.',
      );
  }
}
