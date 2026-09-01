import { run, splitHostPort } from './shared.js';
import { ScanError } from '../types.js';
import type { Family, Protocol, RawSocket, ScanOptions } from '../types.js';

/** One `-F` record from lsof, before it is paired with `ps` output. */
export interface LsofRecord {
  pid: number;
  command: string | null;
  user: string | null;
  address: string;
  port: number;
  family: Family;
}

/**
 * Parse lsof field output (`-F`), which emits one tagged field per line:
 * `p`/`c`/`L` open a process set, `f` opens a file set within it, and `n`/`t`
 * describe that file. Far more robust than parsing lsof's aligned columns,
 * which shift with the width of the values in them.
 */
export function parseLsof(output: string): LsofRecord[] {
  const records: LsofRecord[] = [];

  let pid: number | null = null;
  let command: string | null = null;
  let user: string | null = null;
  let name: string | null = null;
  let type: string | null = null;

  const flushFile = (): void => {
    if (pid === null || name === null) return;
    // `a:b->c:d` is a connected socket, not something listening.
    if (!name.includes('->')) {
      const split = splitHostPort(name);
      if (split && split.port > 0) {
        records.push({
          pid,
          command,
          user,
          address: split.address,
          port: split.port,
          family: type === 'IPv6' ? 6 : 4,
        });
      }
    }
    name = null;
    type = null;
  };

  for (const line of output.split('\n')) {
    if (!line) continue;
    const tag = line[0]!;
    const value = line.slice(1);

    switch (tag) {
      case 'p': {
        flushFile();
        const parsed = Number.parseInt(value, 10);
        pid = Number.isInteger(parsed) ? parsed : null;
        command = null;
        user = null;
        break;
      }
      case 'c':
        command = value || null;
        break;
      case 'L':
        user = value || null;
        break;
      case 'f':
        flushFile();
        break;
      case 'n':
        name = value;
        break;
      case 't':
        type = value;
        break;
      default:
        break;
    }
  }

  flushFile();
  return records;
}

/** Parse `ps -axww -o pid=,user=,args=` into pid → user and full command line. */
export function parsePs(output: string): Map<number, { user: string; command: string }> {
  const processes = new Map<number, { user: string; command: string }>();
  for (const line of output.split('\n')) {
    const match = /^\s*(\d+)\s+(\S+)\s+(.*)$/.exec(line);
    if (!match) continue;
    processes.set(Number.parseInt(match[1]!, 10), { user: match[2]!, command: match[3]!.trim() });
  }
  return processes;
}

/**
 * lsof exits 1 when it matched nothing, which is a normal outcome rather than
 * a failure, so its stdout is used either way.
 */
async function runLsof(args: string[]): Promise<string> {
  try {
    const { stdout } = await run('lsof', args);
    return stdout;
  } catch (error) {
    const failure = error as NodeJS.ErrnoException & { stdout?: string };
    if (failure.code === 'ENOENT') {
      throw new ScanError(
        'lsof is not installed, and macOS needs it to read the socket table.',
        'Install it with `brew install lsof`, or use the system copy at /usr/sbin/lsof.',
      );
    }
    if (typeof failure.stdout === 'string') return failure.stdout;
    throw error;
  }
}

export async function scanDarwin(options: ScanOptions = {}): Promise<RawSocket[]> {
  const jobs: Array<Promise<{ protocol: Protocol; records: LsofRecord[] }>> = [
    runLsof(['-nP', '-iTCP', '-sTCP:LISTEN', '-FpcLfnt']).then((stdout) => ({
      protocol: 'tcp' as const,
      records: parseLsof(stdout),
    })),
  ];
  if (options.udp) {
    jobs.push(
      runLsof(['-nP', '-iUDP', '-FpcLfnt']).then((stdout) => ({
        protocol: 'udp' as const,
        records: parseLsof(stdout),
      })),
    );
  }

  // lsof reports a truncated command name; ps supplies the full command line
  // the description heuristics need. One extra spawn, and it can fail safely.
  const [groups, psOutput] = await Promise.all([
    Promise.all(jobs),
    run('ps', ['-axww', '-o', 'pid=,user=,args=']).then(
      (result) => result.stdout,
      () => '',
    ),
  ]);

  const details = parsePs(psOutput);

  return groups.flatMap(({ protocol, records }) =>
    records.map((record) => {
      const detail = details.get(record.pid);
      return {
        protocol,
        family: record.family,
        address: record.address,
        port: record.port,
        pid: record.pid,
        processName: record.command,
        command: detail?.command ?? null,
        user: detail?.user ?? record.user,
      } satisfies RawSocket;
    }),
  );
}
