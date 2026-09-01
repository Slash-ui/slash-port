import { elevationRemedy, guardReason } from './describe.js';
import type { PortEntry } from './types.js';

export type KillStatus =
  /** Refused outright by a guardrail. No signal was sent. */
  | 'refused'
  /** The scan could not resolve an owner, so there is nothing to signal. */
  | 'unresolved'
  /** The process had already exited. No signal was sent. */
  | 'gone'
  /** The process exists but belongs to someone else. */
  | 'denied'
  /** The process exited within the grace period. */
  | 'terminated'
  /** SIGTERM was delivered and the process is still running. */
  | 'survived'
  /** The signal could not be delivered for some other reason. */
  | 'failed';

export interface KillResult {
  status: KillStatus;
  signal: NodeJS.Signals | null;
  message: string;
}

/** Injection points, so the guardrails can be tested without real processes. */
export interface KillDeps {
  kill?: (pid: number, signal: NodeJS.Signals | 0) => void;
  wait?: (ms: number) => Promise<void>;
}

export interface KillOptions extends KillDeps {
  /** SIGKILL is only ever sent because the caller explicitly asked for it. */
  signal?: Extract<NodeJS.Signals, 'SIGTERM' | 'SIGKILL'>;
  /** How long to wait for a graceful exit before reporting `survived`. */
  graceMs?: number;
  pollMs?: number;
}

const defaultWait = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

export type Liveness = 'alive' | 'gone' | 'denied';

/**
 * Signal 0 asks the kernel whether the process exists and whether we may
 * signal it, without delivering anything. `EPERM` means it exists but is
 * someone else's, which deserves a different message from "gone".
 */
export function probe(pid: number, kill: NonNullable<KillDeps['kill']> = process.kill): Liveness {
  try {
    kill(pid, 0);
    return 'alive';
  } catch (error) {
    const failure = error as NodeJS.ErrnoException;
    if (failure.code === 'EPERM') return 'denied';
    return 'gone';
  }
}

function describeTarget(entry: PortEntry): string {
  const name = entry.processName ?? entry.label ?? 'the process';
  return `${name} (pid ${entry.pid}) on port ${entry.port}`;
}

/**
 * Kill whatever is holding a port.
 *
 * The order is fixed and every branch before the signal is a refusal, not a
 * prompt: guardrails, then an unresolved owner, then a process that has
 * already gone. SIGTERM is polled for up to `graceMs`; a process that outlives
 * it is reported as `survived` rather than being escalated, because escalating
 * is a second, deliberate action by the caller.
 *
 * On Windows there is no signal delivery: SIGTERM becomes TerminateProcess,
 * which cannot be caught or ignored, so a process never gets the chance to
 * shut down cleanly and `survived` is unreachable. The grace period still
 * applies - it is how long the process is given to disappear.
 */
export async function killEntry(entry: PortEntry, options: KillOptions = {}): Promise<KillResult> {
  const { signal = 'SIGTERM', graceMs = 3000, pollMs = 50, kill = process.kill, wait = defaultWait } = options;

  const guard = entry.guard ?? guardReason(entry);
  if (guard) {
    return {
      status: 'refused',
      signal: null,
      message: `Refusing to kill ${guard}.`,
    };
  }

  if (entry.pid === null) {
    return {
      status: 'unresolved',
      signal: null,
      message: `Port ${entry.port} has an owner slash-port cannot see. Re-run with ${elevationRemedy()} to resolve it.`,
    };
  }

  const before = probe(entry.pid, kill);
  if (before === 'gone') {
    return {
      status: 'gone',
      signal: null,
      message: `${describeTarget(entry)} had already exited. Nothing was signalled.`,
    };
  }
  if (before === 'denied') {
    return {
      status: 'denied',
      signal: null,
      message: `${describeTarget(entry)} belongs to another user. Re-run with ${elevationRemedy()} to signal it.`,
    };
  }

  try {
    kill(entry.pid, signal);
  } catch (error) {
    const failure = error as NodeJS.ErrnoException;
    if (failure.code === 'ESRCH') {
      return {
        status: 'gone',
        signal: null,
        message: `${describeTarget(entry)} exited before the signal was delivered.`,
      };
    }
    if (failure.code === 'EPERM') {
      return {
        status: 'denied',
        signal: null,
        message: `${describeTarget(entry)} belongs to another user. Re-run with ${elevationRemedy()} to signal it.`,
      };
    }
    return {
      status: 'failed',
      signal: null,
      message: `Could not signal ${describeTarget(entry)}: ${failure.message}`,
    };
  }

  const deadline = graceMs;
  let waited = 0;
  while (waited <= deadline) {
    if (probe(entry.pid, kill) !== 'alive') {
      return {
        status: 'terminated',
        signal,
        message: `${describeTarget(entry)} exited after ${signal}.`,
      };
    }
    await wait(pollMs);
    waited += pollMs;
  }

  return {
    status: 'survived',
    signal,
    message:
      signal === 'SIGKILL'
        ? `${describeTarget(entry)} did not exit, even after SIGKILL. It is probably stuck in the kernel.`
        : `${describeTarget(entry)} ignored SIGTERM after ${graceMs}ms. Force it with SIGKILL to escalate.`,
  };
}
