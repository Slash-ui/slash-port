import { readFile, readdir, readlink } from 'node:fs/promises';
import { mapConcurrent, normaliseAddress } from './shared.js';
import type { Family, Protocol, RawSocket, ScanOptions } from '../types.js';

/** TCP_LISTEN as `/proc/net/tcp` writes it. */
export const TCP_LISTEN = '0A';

/** One row of `/proc/net/{tcp,tcp6,udp,udp6}`, decoded but not yet enriched. */
export interface ProcNetRow {
  address: string;
  port: number;
  family: Family;
  remoteAddress: string;
  remotePort: number;
  state: string;
  uid: number;
  inode: number;
}

/**
 * Decode a `/proc/net` address literal.
 *
 * The kernel writes each 32-bit word in host byte order, which on every
 * platform this runs on is little-endian, so `0100007F` is 127.0.0.1 and not
 * 1.0.0.127. IPv6 is four such words, each independently byte-swapped.
 */
export function decodeAddress(hex: string): { address: string; family: Family } {
  if (hex.length === 8) {
    const bytes = hexBytes(hex).reverse();
    return { address: bytes.join('.'), family: 4 };
  }

  if (hex.length === 32) {
    const bytes: number[] = [];
    for (let word = 0; word < 4; word += 1) {
      bytes.push(...hexBytes(hex.slice(word * 8, word * 8 + 8)).reverse());
    }
    return { address: formatIpv6(bytes), family: 6 };
  }

  throw new Error(`unrecognised /proc address literal: ${hex}`);
}

function hexBytes(hex: string): number[] {
  const bytes: number[] = [];
  for (let index = 0; index < hex.length; index += 2) {
    bytes.push(Number.parseInt(hex.slice(index, index + 2), 16));
  }
  return bytes;
}

function formatIpv6(bytes: number[]): string {
  // IPv4-mapped addresses read far better in their dotted form.
  const mapped = bytes.slice(0, 10).every((byte) => byte === 0) && bytes[10] === 0xff && bytes[11] === 0xff;
  if (mapped) {
    return `::ffff:${bytes.slice(12).join('.')}`;
  }

  const groups: number[] = [];
  for (let index = 0; index < 16; index += 2) {
    groups.push((bytes[index]! << 8) | bytes[index + 1]!);
  }

  // Compress the longest run of two or more zero groups, per RFC 5952.
  let bestStart = -1;
  let bestLength = 0;
  let runStart = -1;
  for (let index = 0; index <= groups.length; index += 1) {
    if (index < groups.length && groups[index] === 0) {
      if (runStart === -1) runStart = index;
    } else if (runStart !== -1) {
      const length = index - runStart;
      if (length > bestLength && length > 1) {
        bestStart = runStart;
        bestLength = length;
      }
      runStart = -1;
    }
  }

  const parts = groups.map((group) => group.toString(16));
  if (bestStart === -1) return parts.join(':');

  const head = parts.slice(0, bestStart).join(':');
  const tail = parts.slice(bestStart + bestLength).join(':');
  return `${head}::${tail}`;
}

/**
 * Parse the whole of a `/proc/net` socket table, listening or not. Split from
 * file reading so it can be tested against a fixture instead of whatever the
 * host happens to have open.
 */
export function parseProcNetRows(content: string): ProcNetRow[] {
  const rows: ProcNetRow[] = [];

  for (const line of content.split('\n')) {
    const fields = line.trim().split(/\s+/);
    // sl local rem st tx:rx tr:when retrnsmt uid timeout inode
    if (fields.length < 10) continue;
    if (!/^\d+:$/.test(fields[0]!)) continue;

    const local = fields[1]!.split(':');
    const remote = fields[2]!.split(':');
    if (local.length !== 2 || remote.length !== 2) continue;

    let decoded: { address: string; family: Family };
    let decodedRemote: { address: string; family: Family };
    try {
      decoded = decodeAddress(local[0]!);
      decodedRemote = decodeAddress(remote[0]!);
    } catch {
      continue;
    }

    rows.push({
      address: decoded.address,
      port: Number.parseInt(local[1]!, 16),
      family: decoded.family,
      remoteAddress: decodedRemote.address,
      remotePort: Number.parseInt(remote[1]!, 16),
      state: fields[3]!.toUpperCase(),
      uid: Number.parseInt(fields[7]!, 10),
      inode: Number.parseInt(fields[9]!, 10),
    });
  }

  return rows;
}

/**
 * The rows worth showing: TCP sockets in LISTEN, and UDP sockets with no peer,
 * which is as close as UDP gets to the idea of listening.
 */
export function parseProcNet(content: string, protocol: Protocol): ProcNetRow[] {
  const rows = parseProcNetRows(content);
  if (protocol === 'tcp') {
    return rows.filter((row) => row.state === TCP_LISTEN);
  }
  return rows.filter((row) => row.remotePort === 0);
}

async function readTable(path: string, protocol: Protocol): Promise<ProcNetRow[]> {
  try {
    return parseProcNet(await readFile(path, 'utf8'), protocol);
  } catch {
    // tcp6/udp6 are absent on kernels built without IPv6. That is not an error.
    return [];
  }
}

/** uid → user name, read straight from `/etc/passwd` so there is no dependency. */
async function readPasswd(): Promise<Map<number, string>> {
  const users = new Map<number, string>();
  try {
    const content = await readFile('/etc/passwd', 'utf8');
    for (const line of content.split('\n')) {
      const fields = line.split(':');
      if (fields.length < 3) continue;
      const uid = Number.parseInt(fields[2]!, 10);
      if (Number.isInteger(uid) && fields[0]) users.set(uid, fields[0]);
    }
  } catch {
    // Unreadable /etc/passwd only costs us the names; uids still display.
  }
  return users;
}

async function listProcessIds(): Promise<number[]> {
  const entries = await readdir('/proc');
  const pids: number[] = [];
  for (const entry of entries) {
    if (/^\d+$/.test(entry)) pids.push(Number.parseInt(entry, 10));
  }
  return pids;
}

/**
 * Map socket inodes to the pids holding them by walking `/proc/[pid]/fd`.
 *
 * Descriptors belonging to other users are not readable without privileges, so
 * those inodes stay unmapped and the row reports a null pid rather than
 * failing the whole scan.
 */
async function mapInodesToPids(wanted: Set<number>): Promise<Map<number, number>> {
  const owners = new Map<number, number>();
  const pids = await listProcessIds();

  await mapConcurrent(pids, 64, async (pid) => {
    let descriptors: string[];
    try {
      descriptors = await readdir(`/proc/${pid}/fd`);
    } catch {
      return;
    }

    for (const descriptor of descriptors) {
      let target: string;
      try {
        target = await readlink(`/proc/${pid}/fd/${descriptor}`);
      } catch {
        continue;
      }
      const match = /^socket:\[(\d+)\]$/.exec(target);
      if (!match) continue;
      const inode = Number.parseInt(match[1]!, 10);
      if (wanted.has(inode) && !owners.has(inode)) owners.set(inode, pid);
    }
  });

  return owners;
}

interface ProcessInfo {
  name: string | null;
  command: string | null;
}

async function readProcessInfo(pid: number): Promise<ProcessInfo> {
  const [name, command] = await Promise.all([
    readFile(`/proc/${pid}/comm`, 'utf8')
      .then((value) => value.trim() || null)
      .catch(() => null),
    readFile(`/proc/${pid}/cmdline`, 'utf8')
      .then((value) => value.replace(/\0+$/, '').split('\0').join(' ').trim() || null)
      .catch(() => null),
  ]);
  return { name, command };
}

export async function scanLinux(options: ScanOptions = {}): Promise<RawSocket[]> {
  const tables: Array<Promise<ProcNetRow[]>> = [
    readTable('/proc/net/tcp', 'tcp'),
    readTable('/proc/net/tcp6', 'tcp'),
  ];
  if (options.udp) {
    tables.push(readTable('/proc/net/udp', 'udp'), readTable('/proc/net/udp6', 'udp'));
  }

  const [tcp4, tcp6, udp4 = [], udp6 = []] = await Promise.all(tables);
  const tagged: Array<{ row: ProcNetRow; protocol: Protocol }> = [
    ...tcp4!.map((row) => ({ row, protocol: 'tcp' as const })),
    ...tcp6!.map((row) => ({ row, protocol: 'tcp' as const })),
    ...udp4.map((row) => ({ row, protocol: 'udp' as const })),
    ...udp6.map((row) => ({ row, protocol: 'udp' as const })),
  ];

  const wanted = new Set(tagged.map(({ row }) => row.inode).filter((inode) => inode > 0));
  const [owners, users] = await Promise.all([mapInodesToPids(wanted), readPasswd()]);

  const uniquePids = [...new Set(owners.values())];
  const details = new Map<number, ProcessInfo>();
  await mapConcurrent(uniquePids, 64, async (pid) => {
    details.set(pid, await readProcessInfo(pid));
  });

  return tagged.map(({ row, protocol }) => {
    const pid = owners.get(row.inode) ?? null;
    const info = pid === null ? undefined : details.get(pid);
    return {
      protocol,
      family: row.family,
      address: normaliseAddress(row.address),
      port: row.port,
      pid,
      processName: info?.name ?? null,
      command: info?.command ?? null,
      user: users.get(row.uid) ?? String(row.uid),
    } satisfies RawSocket;
  });
}
