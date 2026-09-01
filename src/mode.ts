import type { Mode } from './types.js';

/**
 * Everything decided before the first socket is read, and decided the same way
 * every slash-* tool decides it: flags, then environment, then the default.
 * There is no config file to consult, and there is not going to be one - this
 * tool reads the socket table and writes nothing.
 */

export const MODES: readonly Mode[] = ['beginner', 'advanced'];

/**
 * Beginner is the default, and deliberately so. The person who does not know
 * what took port 3000 is the person who went looking for a tool that would
 * tell them; someone who already knows can say `--advanced` once, or set
 * `SLASH_PORT_MODE` and never say it again.
 */
export const DEFAULT_MODE: Mode = 'beginner';

export function isMode(value: string): value is Mode {
  return (MODES as readonly string[]).includes(value);
}

export function resolveMode(flag: Mode | null, env: NodeJS.ProcessEnv = process.env): Mode {
  if (flag) return flag;
  const configured = env['SLASH_PORT_MODE']?.trim().toLowerCase();
  if (configured && isMode(configured)) return configured;
  return DEFAULT_MODE;
}

const TRUTHY = new Set(['1', 'true', 'yes', 'on']);
const FALSY = new Set(['0', 'false', 'no', 'off']);

/**
 * Whether to ask the local Docker engine which container publishes a port.
 *
 * Off unless asked for. It is the only thing slash-port asks anything, and a
 * tool whose whole claim is that it reads two local tables and stops should
 * not quietly start talking to a daemon because a daemon happened to be there.
 * `--docker` turns it on for one run; `SLASH_PORT_DOCKER=1` turns it on for
 * good, and `--no-docker` still overrules that.
 */
export function resolveDocker(flag: boolean | null, env: NodeJS.ProcessEnv = process.env): boolean {
  if (flag !== null) return flag;
  const configured = env['SLASH_PORT_DOCKER']?.trim().toLowerCase();
  if (configured && TRUTHY.has(configured)) return true;
  if (configured && FALSY.has(configured)) return false;
  return false;
}
