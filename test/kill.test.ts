import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { afterEach, describe, expect, test } from 'vitest';
import { killEntry, probe } from '../src/kill.js';
import type { PortEntry } from '../src/types.js';

function entry(overrides: Partial<PortEntry> = {}): PortEntry {
  return {
    id: 'tcp:3000:1234',
    protocol: 'tcp',
    port: 3000,
    addresses: ['*'],
    families: [4],
    pid: 1234,
    processName: 'node',
    command: 'node server.js',
    user: 'dev',
    label: 'Node.js',
    source: 'signature',
    category: 'runtime',
    summary: 'slash-port could name the runtime but not the project it belongs to.',
    restart: null,
    url: null,
    risk: 'caution',
    riskReason: 'yours, but something may be relying on it',
    hint: null,
    guard: null,
    elevation: null,
    ...overrides,
  };
}

/** A `process.kill` that fails the way the kernel would. */
function failing(code: string): (pid: number, signal: NodeJS.Signals | 0) => void {
  return () => {
    const error = new Error(code) as NodeJS.ErrnoException;
    error.code = code;
    throw error;
  };
}

/**
 * Windows has no signal delivery. `process.kill` maps SIGTERM onto
 * TerminateProcess, which a process cannot catch, ignore, or clean up after,
 * so "ignored SIGTERM and survived" is unreachable there. The tests that
 * describe escalation are POSIX behaviour, and Windows gets its own.
 */
const POSIX = process.platform !== 'win32';

const children: ChildProcess[] = [];

/**
 * Spawn a child that stays alive until signalled, and wait until it is up.
 *
 * The readiness line is printed *after* the child has installed its signal
 * handlers. Printing it first races: libuv writes to the pipe synchronously
 * where it can, so the parent could see "up" and deliver SIGTERM before the
 * handler that is meant to ignore it exists.
 */
async function spawnChild(source: string): Promise<number> {
  const child = spawn(process.execPath, ['-e', `${source};console.log('up')`], {
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  children.push(child);
  await new Promise<void>((resolve, reject) => {
    child.stdout?.once('data', () => resolve());
    child.once('error', reject);
  });
  return child.pid!;
}

afterEach(() => {
  for (const child of children.splice(0)) {
    if (child.exitCode === null) child.kill('SIGKILL');
  }
});

describe('guardrails', () => {
  test('refuses a protected process outright, without signalling it', () => {
    let signalled = false;
    return killEntry(entry({ guard: 'the SSH daemon' }), {
      kill: () => {
        signalled = true;
      },
    }).then((result) => {
      expect(result.status).toBe('refused');
      expect(result.signal).toBeNull();
      expect(result.message).toMatch(/SSH daemon/);
      expect(signalled).toBe(false);
    });
  });

  test('re-derives the guard when the caller did not', async () => {
    // A caller that builds an entry by hand must not be able to opt out.
    const result = await killEntry(entry({ guard: null, pid: 1, processName: 'systemd' }), {
      kill: () => {
        throw new Error('must not be reached');
      },
    });
    expect(result.status).toBe('refused');
  });

  test('explains an unresolved owner and names the way round it', async () => {
    const result = await killEntry(entry({ pid: null }));
    expect(result.status).toBe('unresolved');
    // `sudo` everywhere but Windows, where it is an elevated terminal.
    expect(result.message).toMatch(/sudo|elevated terminal/);
  });

  test('reports a process that had already exited without signalling it', async () => {
    const result = await killEntry(entry(), { kill: failing('ESRCH') });
    expect(result.status).toBe('gone');
    expect(result.signal).toBeNull();
  });

  test('distinguishes another user’s process from a missing one', async () => {
    const result = await killEntry(entry(), { kill: failing('EPERM') });
    expect(result.status).toBe('denied');
    expect(result.message).toMatch(/another user/);
  });
});

describe('probe', () => {
  test('reads existence and permission without delivering a signal', async () => {
    const pid = await spawnChild('setInterval(() => {}, 1000)');
    expect(probe(pid)).toBe('alive');
    process.kill(pid, 'SIGKILL');
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(probe(pid)).toBe('gone');
  });

  test('reports EPERM as denied rather than gone', () => {
    expect(probe(1234, failing('EPERM'))).toBe('denied');
  });
});

describe('signal escalation against real processes', () => {
  test('SIGTERM ends a process that respects it', async () => {
    const pid = await spawnChild('setInterval(() => {}, 1000)');
    const result = await killEntry(entry({ pid }), { graceMs: 3000, pollMs: 25 });
    expect(result.status).toBe('terminated');
    expect(result.signal).toBe('SIGTERM');
    expect(probe(pid)).toBe('gone');
  });

  test.skipIf(!POSIX)('a process that ignores SIGTERM is reported, not escalated', async () => {
    const pid = await spawnChild("process.on('SIGTERM', () => {});setInterval(() => {}, 1000)");
    const result = await killEntry(entry({ pid }), { graceMs: 300, pollMs: 25 });

    expect(result.status).toBe('survived');
    expect(result.message).toMatch(/SIGKILL/);
    // Still running: escalation is the caller's next deliberate action, not
    // something that happens automatically because the first signal failed.
    expect(probe(pid)).toBe('alive');
  });

  test.skipIf(!POSIX)('SIGKILL ends it once the caller asks for it', async () => {
    const pid = await spawnChild("process.on('SIGTERM', () => {});setInterval(() => {}, 1000)");
    expect((await killEntry(entry({ pid }), { graceMs: 200, pollMs: 25 })).status).toBe('survived');

    const forced = await killEntry(entry({ pid }), { signal: 'SIGKILL', graceMs: 3000, pollMs: 25 });
    expect(forced.status).toBe('terminated');
    expect(forced.signal).toBe('SIGKILL');
    expect(probe(pid)).toBe('gone');
  });

  test.runIf(!POSIX)('SIGTERM cannot be caught on Windows, so it always terminates', async () => {
    const pid = await spawnChild("process.on('SIGTERM', () => {});setInterval(() => {}, 1000)");
    const result = await killEntry(entry({ pid }), { graceMs: 3000, pollMs: 25 });

    // The handler is installed and makes no difference, which is the platform
    // being honest rather than the guardrails failing.
    expect(result.status).toBe('terminated');
    expect(result.signal).toBe('SIGTERM');
  });

  test('sends nothing at all to a process that has already gone', async () => {
    const pid = await spawnChild('setInterval(() => {}, 1000)');
    process.kill(pid, 'SIGKILL');
    await new Promise((resolve) => setTimeout(resolve, 200));

    const result = await killEntry(entry({ pid }));
    expect(result.status).toBe('gone');
    expect(result.signal).toBeNull();
  });
});
