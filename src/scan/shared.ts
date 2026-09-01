import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

/** Wildcard bind addresses, shown as `*` the way lsof and netstat do. */
const WILDCARD = new Set(['0.0.0.0', '::', '*', '[::]', '0000:0000:0000:0000:0000:0000:0000:0000']);

export function normaliseAddress(address: string): string {
  const trimmed = address.trim();
  if (WILDCARD.has(trimmed)) return '*';
  // Strip the brackets netstat puts round IPv6 literals.
  if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
    const inner = trimmed.slice(1, -1);
    return WILDCARD.has(inner) ? '*' : inner;
  }
  return trimmed;
}

/**
 * Split `host:port` where the host may itself contain colons. Everything after
 * the last colon is the port, which is why IPv6 literals arrive bracketed.
 */
export function splitHostPort(value: string): { address: string; port: number } | null {
  const separator = value.lastIndexOf(':');
  if (separator === -1) return null;
  const rawPort = value.slice(separator + 1);
  const port = Number.parseInt(rawPort, 10);
  if (!Number.isInteger(port) || port < 0 || port > 65535) return null;
  return { address: normaliseAddress(value.slice(0, separator)), port };
}

export interface RunResult {
  stdout: string;
  stderr: string;
}

/**
 * Run a local helper binary. Nothing here touches the network; these are the
 * platform tools that expose the socket table.
 */
export async function run(command: string, args: string[]): Promise<RunResult> {
  const { stdout, stderr } = await execFileAsync(command, args, {
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
    windowsHide: true,
  });
  return { stdout, stderr };
}

/** Map over items with a bounded number of in-flight operations. */
export async function mapConcurrent<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;

  const worker = async (): Promise<void> => {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await fn(items[index]!);
    }
  };

  const workers = Array.from({ length: Math.min(limit, items.length) }, worker);
  await Promise.all(workers);
  return results;
}
