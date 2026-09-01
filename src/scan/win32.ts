import { normaliseAddress, run, splitHostPort } from './shared.js';
import { ScanError } from '../types.js';
import type { Family, Protocol, RawSocket, ScanOptions } from '../types.js';

export interface NetstatRow {
  protocol: Protocol;
  address: string;
  port: number;
  family: Family;
  pid: number;
}

/**
 * Parse `netstat -ano`.
 *
 * TCP rows carry a state column and UDP rows do not, so the pid is the last
 * field rather than a fixed index. `netstat` is used in preference to
 * `Get-NetTCPConnection` because it exists on every edition of Windows and
 * costs nothing to start, where PowerShell costs about a second.
 */
export function parseNetstat(output: string): NetstatRow[] {
  const rows: NetstatRow[] = [];

  for (const line of output.split('\n')) {
    const fields = line.trim().split(/\s+/);
    if (fields.length < 4) continue;

    const protocol = fields[0]!.toUpperCase();
    if (protocol !== 'TCP' && protocol !== 'UDP') continue;

    // Localised builds translate the state word, so a TCP row also counts as
    // listening when it has no peer - only LISTEN has a foreign port of zero.
    if (protocol === 'TCP') {
      if (fields.length < 5) continue;
      const listening = fields[3]!.toUpperCase() === 'LISTENING' || splitHostPort(fields[2]!)?.port === 0;
      if (!listening) continue;
    }

    const pid = Number.parseInt(fields[fields.length - 1]!, 10);
    if (!Number.isInteger(pid)) continue;

    const local = fields[1]!;
    const split = splitHostPort(local);
    if (!split) continue;

    rows.push({
      protocol: protocol === 'TCP' ? 'tcp' : 'udp',
      address: split.address,
      port: split.port,
      family: local.startsWith('[') ? 6 : 4,
      pid,
    });
  }

  return rows;
}

/** Minimal RFC 4180 reader; tasklist quotes every field and escapes `"` as `""`. */
export function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let current = '';
  let quoted = false;

  for (let index = 0; index < line.length; index += 1) {
    const character = line[index]!;
    if (quoted) {
      if (character === '"') {
        if (line[index + 1] === '"') {
          current += '"';
          index += 1;
        } else {
          quoted = false;
        }
      } else {
        current += character;
      }
    } else if (character === '"') {
      quoted = true;
    } else if (character === ',') {
      fields.push(current);
      current = '';
    } else {
      current += character;
    }
  }

  fields.push(current);
  return fields;
}

/**
 * Parse `tasklist /V /FO CSV /NH`: image name, pid, session, session number,
 * memory, status, user name, cpu time, window title. The column *positions*
 * are stable across locales even though the headings are not, which is why the
 * headings are suppressed with `/NH`.
 */
export function parseTasklist(output: string): Map<number, { name: string; user: string | null }> {
  const processes = new Map<number, { name: string; user: string | null }>();

  for (const line of output.split('\n')) {
    if (!line.trim()) continue;
    const fields = parseCsvLine(line.trim());
    if (fields.length < 2) continue;
    const pid = Number.parseInt(fields[1]!, 10);
    if (!Number.isInteger(pid)) continue;
    const user = fields[6]?.trim();
    processes.set(pid, {
      name: fields[0]!.trim(),
      user: user && user !== 'N/A' ? user : null,
    });
  }

  return processes;
}

async function runNetstat(args: string[]): Promise<string> {
  try {
    const { stdout } = await run('netstat', args);
    return stdout;
  } catch (error) {
    const failure = error as NodeJS.ErrnoException & { stdout?: string };
    if (failure.code === 'ENOENT') {
      throw new ScanError('netstat could not be found on PATH.', 'Check that %SystemRoot%\\System32 is on PATH.');
    }
    if (typeof failure.stdout === 'string') return failure.stdout;
    throw error;
  }
}

export async function scanWin32(options: ScanOptions = {}): Promise<RawSocket[]> {
  const netstatArgs = options.udp ? ['-ano'] : ['-ano', '-p', 'TCP'];

  const [netstatOutput, tasklistOutput] = await Promise.all([
    runNetstat(netstatArgs),
    // Losing tasklist costs the process names, not the scan.
    run('tasklist', ['/V', '/FO', 'CSV', '/NH']).then(
      (result) => result.stdout,
      () => '',
    ),
  ]);

  const processes = parseTasklist(tasklistOutput);

  return parseNetstat(netstatOutput)
    .filter((row) => options.udp || row.protocol === 'tcp')
    .map((row) => {
      const process = processes.get(row.pid);
      return {
        protocol: row.protocol,
        family: row.family,
        address: normaliseAddress(row.address),
        port: row.port,
        // Windows reports pid 0 for the system idle process, which owns
        // nothing a user can act on.
        pid: row.pid === 0 ? null : row.pid,
        processName: process?.name ?? null,
        // netstat and tasklist cannot supply a command line; the description
        // heuristics fall back to the image name.
        command: null,
        user: process?.user ?? null,
      } satisfies RawSocket;
    });
}
