import { readFile, readlink } from 'node:fs/promises';
import { run } from './scan/shared.js';
import type { PortEntry } from './types.js';

/** What a probe found, or why it could not look. */
type Probe<T> = { value: T } | { denied: true } | null;

/**
 * The facts about a running process that are worth a second look but not worth
 * a second scan. Every field is optional and every one of them is best effort:
 * a platform that cannot answer leaves the line out rather than guessing, and
 * a probe that fails leaves the panel one line shorter rather than failing the
 * interface.
 */
export interface ProcessDetail {
  parentPid?: number;
  parentName?: string;
  /** Local clock time the process started, already formatted. */
  startedAt?: string;
  uptimeSeconds?: number;
  rssBytes?: number;
  cpuPercent?: number;
  /** Working directory: which checkout this dev server is actually serving. */
  cwd?: string;
  /** True when the working directory exists but is not ours to read. */
  cwdDenied?: boolean;
  /** Connections in ESTABLISHED on this port - whether anything is using it. */
  established?: number;
}

/** Never let a probe take the interface down with it. */
async function attempt<T>(work: () => Promise<T>): Promise<T | null> {
  try {
    return await work();
  } catch {
    return null;
  }
}

/**
 * The same, but keeping the one distinction that carries advice: a permission
 * failure is somebody else's process and `sudo` would answer it, where a
 * missing file is a process that exited between the scan and the probe. Both
 * would otherwise arrive as the same silence.
 */
async function attemptOrDenied<T>(work: () => Promise<T>): Promise<Probe<T>> {
  try {
    return { value: await work() };
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    return code === 'EACCES' || code === 'EPERM' ? { denied: true } : null;
  }
}

/**
 * lsof exits 1 when it matched nothing, which is a normal outcome and not a
 * failure. Treating it as one is why macOS could report a count or nothing at
 * all, but never "nothing connected" - the one answer that is often the point.
 */
async function runTolerant(command: string, args: string[]): Promise<string | null> {
  try {
    return (await run(command, args)).stdout;
  } catch (error) {
    const failure = error as NodeJS.ErrnoException & { stdout?: string };
    if (failure.code === 'ENOENT') return null;
    return typeof failure.stdout === 'string' ? failure.stdout : null;
  }
}

/**
 * Count established connections in lsof's field output.
 *
 * `-iTCP:PORT` matches a socket whose local *or* remote port is the one asked
 * about, so every loopback connection appears twice - once from each end. Only
 * the end whose local side carries the port is counted, or a dev server with
 * three browser tabs open reports six.
 */
export function countLsofEstablished(output: string, port: number): number {
  let total = 0;
  for (const line of output.split('\n')) {
    if (!line.startsWith('n')) continue;
    const arrow = line.indexOf('->');
    if (arrow === -1) continue;
    if (line.slice(1, arrow).endsWith(`:${port}`)) total += 1;
  }
  return total;
}

/** `[[DD-]HH:]MM:SS` as ps writes it. */
export function parseElapsed(value: string): number | null {
  const match = /^(?:(\d+)-)?(?:(\d+):)?(\d+):(\d+)$/.exec(value.trim());
  if (!match) return null;
  const [, days, hours, minutes, seconds] = match;
  return (
    Number(days ?? 0) * 86400 +
    Number(hours ?? 0) * 3600 +
    Number(minutes ?? 0) * 60 +
    Number(seconds ?? 0)
  );
}

/**
 * `/proc/[pid]/stat`, whose second field is a command name in parentheses that
 * may itself contain spaces and parentheses. Everything positional has to be
 * counted from the last `)`, which is why this is not a `split`.
 */
export function parseProcStat(content: string): { ppid: number; startTicks: number } | null {
  const close = content.lastIndexOf(')');
  if (close === -1) return null;
  const fields = content.slice(close + 2).trim().split(/\s+/);
  // Fields after `comm` start at index 0 = state, so ppid is 1 and starttime,
  // field 22 in the manual page, is 19 here.
  const ppid = Number.parseInt(fields[1] ?? '', 10);
  const startTicks = Number.parseInt(fields[19] ?? '', 10);
  if (!Number.isInteger(ppid) || !Number.isInteger(startTicks)) return null;
  return { ppid, startTicks };
}

function formatClock(startedMsAgo: number, now: number): string {
  return new Date(now - startedMsAgo).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

async function inspectLinux(entry: PortEntry, pid: number): Promise<ProcessDetail> {
  const detail: ProcessDetail = {};

  const stat = await attempt(() => readFile(`/proc/${pid}/stat`, 'utf8'));
  const parsed = stat === null ? null : parseProcStat(stat);
  if (parsed) {
    detail.parentPid = parsed.ppid;
    const uptime = await attempt(() => readFile('/proc/uptime', 'utf8'));
    if (uptime) {
      // The kernel counts a process's start in clock ticks since boot, so its
      // age is the machine's age minus that. 100 ticks a second is the value
      // Linux has shipped for decades and there is no portable way to read it.
      const seconds = Number.parseFloat(uptime.split(/\s+/)[0] ?? '') - parsed.startTicks / 100;
      if (Number.isFinite(seconds) && seconds >= 0) {
        detail.uptimeSeconds = seconds;
        detail.startedAt = formatClock(seconds * 1000, Date.now());
      }
    }
    const comm = await attempt(() => readFile(`/proc/${parsed.ppid}/comm`, 'utf8'));
    if (comm) detail.parentName = comm.trim();
  }

  const status = await attempt(() => readFile(`/proc/${pid}/status`, 'utf8'));
  const rss = status === null ? null : /^VmRSS:\s+(\d+)\s+kB$/m.exec(status);
  if (rss?.[1]) detail.rssBytes = Number.parseInt(rss[1], 10) * 1024;

  // Readable only for your own processes, which is exactly when it is useful.
  // A permission failure is worth saying out loud, because `sudo` answers it.
  const cwd = await attemptOrDenied(() => readlink(`/proc/${pid}/cwd`));
  if (cwd && 'value' in cwd) detail.cwd = cwd.value;
  else if (cwd && 'denied' in cwd) detail.cwdDenied = true;

  const established = await attempt(() => countEstablishedLinux(entry.port));
  if (established !== null) detail.established = established;

  return detail;
}

/**
 * Connections on this port in state 01, ESTABLISHED. Read from the same tables
 * the Linux scanner already parses, so this costs a file read and no process.
 */
async function countEstablishedLinux(port: number): Promise<number> {
  const hex = port.toString(16).toUpperCase().padStart(4, '0');
  let total = 0;
  for (const table of ['/proc/net/tcp', '/proc/net/tcp6']) {
    const content = await attempt(() => readFile(table, 'utf8'));
    if (!content) continue;
    for (const line of content.split('\n').slice(1)) {
      const fields = line.trim().split(/\s+/);
      if (fields.length < 4) continue;
      if (!fields[1]?.endsWith(`:${hex}`)) continue;
      if (fields[3] === '01') total += 1;
    }
  }
  return total;
}

async function inspectDarwin(entry: PortEntry, pid: number): Promise<ProcessDetail> {
  const detail: ProcessDetail = {};

  const ps = await attempt(() => run('ps', ['-p', String(pid), '-o', 'ppid=,etime=,rss=,pcpu=']));
  // Each field independently: one blank column must not take the other three
  // down with it.
  const fields = ps?.stdout.trim().split(/\s+/) ?? [];

  const ppid = Number.parseInt(fields[0] ?? '', 10);
  if (Number.isInteger(ppid)) {
    detail.parentPid = ppid;
    const parent = await attempt(() => run('ps', ['-p', String(ppid), '-o', 'comm=']));
    // `comm` is a full path on macOS; the last component is the name.
    const name = parent?.stdout.trim().split('/').pop();
    if (name) detail.parentName = name;
  }

  const elapsed = fields[1] === undefined ? null : parseElapsed(fields[1]);
  if (elapsed !== null) {
    detail.uptimeSeconds = elapsed;
    detail.startedAt = formatClock(elapsed * 1000, Date.now());
  }

  const rssKb = Number.parseInt(fields[2] ?? '', 10);
  if (Number.isInteger(rssKb)) detail.rssBytes = rssKb * 1024;

  const cpu = Number.parseFloat(fields[3] ?? '');
  if (Number.isFinite(cpu)) detail.cpuPercent = cpu;

  // Two lsof runs, and neither needs the other's answer: waiting for them one
  // after the other doubles how long the panel takes to fill in for nothing.
  // The connection count is only asked for when the process is ours, because
  // lsof cannot see another user's sockets and a count that saw half of them
  // is worse than no count at all.
  const [cwd, connections] = await Promise.all([
    runTolerant('lsof', ['-a', '-p', String(pid), '-d', 'cwd', '-Fn']),
    entry.elevation === null
      ? runTolerant('lsof', ['-nP', `-iTCP:${entry.port}`, '-sTCP:ESTABLISHED', '-Fn'])
      : Promise.resolve(null),
  ]);

  const cwdLine = cwd?.split('\n').find((line) => line.startsWith('n/'));
  if (cwdLine) detail.cwd = cwdLine.slice(1);
  else if (cwd !== null && entry.elevation !== null) detail.cwdDenied = true;

  if (connections !== null) detail.established = countLsofEstablished(connections, entry.port);

  return detail;
}

/**
 * Windows gives up its process table cheaply and the rest of it expensively.
 * `tasklist` is already a dependency of the scanner and answers memory;
 * parents, working directories, and start times all need WMI or PowerShell,
 * which cost about a second each, so those lines are simply not offered there.
 */
async function inspectWin32(entry: PortEntry, pid: number): Promise<ProcessDetail> {
  const detail: ProcessDetail = {};

  const tasklist = await attempt(() =>
    run('tasklist', ['/FI', `PID eq ${pid}`, '/FO', 'CSV', '/NH']),
  );
  // The thousands separator is whatever the locale says: a comma, a full stop,
  // a space, or the non-breaking space French Windows uses.
  const memory = tasklist === null ? null : /"([^"]+) K"\s*$/m.exec(tasklist.stdout.trim());
  if (memory?.[1]) {
    const kb = Number.parseInt(memory[1].replace(/\D/g, ''), 10);
    if (Number.isInteger(kb)) detail.rssBytes = kb * 1024;
  }

  const netstat = await attempt(() => run('netstat', ['-ano', '-p', 'TCP']));
  if (netstat) detail.established = countNetstatEstablished(netstat.stdout, entry.port);

  return detail;
}

/**
 * Established connections on a port, from `netstat -ano`.
 *
 * The state word is translated on a localised Windows - `HERGESTELLT` on a
 * German build - so the row's shape decides rather than its wording, the same
 * way the Windows scanner already decides what is listening: a TCP row whose
 * local port is the one asked about and whose foreign port is not zero is a
 * connection to it.
 */
export function countNetstatEstablished(output: string, port: number): number {
  let total = 0;
  for (const line of output.split('\n')) {
    const fields = line.trim().split(/\s+/);
    if (fields.length < 4 || fields[0]?.toUpperCase() !== 'TCP') continue;
    if (!fields[1]?.endsWith(`:${port}`)) continue;
    const peer = fields[2];
    if (!peer) continue;
    const peerPort = Number.parseInt(peer.slice(peer.lastIndexOf(':') + 1), 10);
    if (Number.isInteger(peerPort) && peerPort > 0) total += 1;
  }
  return total;
}

/**
 * Look a single process up in more detail, on demand.
 *
 * This is deliberately not part of the scan. A machine with four hundred
 * listening sockets would pay four hundred times over for facts the reader is
 * looking at one row at a time, so advanced mode asks only about the row under
 * the cursor, and asks again when the cursor moves.
 */
export async function inspectProcess(
  entry: PortEntry,
  platform: NodeJS.Platform = process.platform,
): Promise<ProcessDetail> {
  if (entry.pid === null) return {};
  switch (platform) {
    case 'linux':
      return inspectLinux(entry, entry.pid);
    case 'darwin':
      return inspectDarwin(entry, entry.pid);
    case 'win32':
      return inspectWin32(entry, entry.pid);
    default:
      return {};
  }
}
