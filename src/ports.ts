/**
 * The three ways to name ports, shared by `--port` and the filter box: one
 * port, a pattern where `x` stands for any digit, or an inclusive range.
 */

const MIN_PORT = 1;
const MAX_PORT = 65535;

export interface PortSelector {
  kind: 'exact' | 'pattern' | 'range';
  /** Canonical text: `3000`, `3xxx`, `3000:3005`. Seeds the interactive filter. */
  text: string;
  /** Inclusive bounds, clamped to real ports. A pattern narrows them further. */
  from: number;
  to: number;
  /** Digits and `x` wildcards; `null` unless this is a pattern. */
  pattern: string | null;
}

/** A selector that could not be read. The message is written for the user. */
export class PortSelectorError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PortSelectorError';
  }
}

function exact(port: number): PortSelector {
  return { kind: 'exact', text: String(port), from: port, to: port, pattern: null };
}

function portNumber(raw: string): number {
  const port = /^\d{1,5}$/.test(raw) ? Number.parseInt(raw, 10) : Number.NaN;
  if (!(port >= MIN_PORT && port <= MAX_PORT)) {
    throw new PortSelectorError(`${raw} is not a port number between 1 and 65535.`);
  }
  return port;
}

/**
 * `3xxx` is every four-digit port beginning with 3, so a pattern is matched
 * against the port's digits rather than its value: `xxx` is 100 to 999, not 0
 * to 999. The bounds come from replacing every `x` with 0 and with 9 — a
 * leading `x` with 1, because no port is written with a leading zero.
 */
function parsePattern(text: string): PortSelector {
  if (!/^[\dx]+$/.test(text)) {
    throw new PortSelectorError(`${text} is not a port pattern. Write it as 3xxx, where x is any digit.`);
  }

  const from = Number.parseInt(text.replace(/^x/, '1').replace(/x/g, '0'), 10);
  const to = Number.parseInt(text.replace(/x/g, '9'), 10);
  if (from < MIN_PORT || from > MAX_PORT) {
    throw new PortSelectorError(`No port between 1 and 65535 matches ${text}.`);
  }

  return { kind: 'pattern', text, from, to: Math.min(to, MAX_PORT), pattern: text };
}

function parseRange(text: string): PortSelector {
  const halves = text.split(':');
  if (halves.length !== 2 || halves[0] === '' || halves[1] === '') {
    throw new PortSelectorError(`${text} is not a port range. Write it as 3000:3005.`);
  }

  const from = portNumber(halves[0]!);
  const to = portNumber(halves[1]!);
  if (from > to) {
    throw new PortSelectorError(`The range ${text} runs backwards. Write it as ${to}:${from}.`);
  }
  // A range of one port is that port, and is treated as one everywhere after.
  if (from === to) return exact(from);

  return { kind: 'range', text: `${from}:${to}`, from, to, pattern: null };
}

/** Reads `3000`, `3xxx`, or `3000:3005`. Throws a `PortSelectorError` otherwise. */
export function parsePortSelector(raw: string): PortSelector {
  const text = raw.trim().toLowerCase();
  if (text.includes(':')) return parseRange(text);
  if (text.includes('x')) return parsePattern(text);
  if (!/^\d+$/.test(text)) {
    throw new PortSelectorError(
      `${raw} is not a port, a pattern like 3xxx, or a range like 3000:3005.`,
    );
  }
  return exact(portNumber(text));
}

export function matchesPort(selector: PortSelector, port: number): boolean {
  if (port < selector.from || port > selector.to) return false;
  if (selector.pattern === null) return true;

  const digits = String(port);
  if (digits.length !== selector.pattern.length) return false;
  return [...selector.pattern].every((character, index) => character === 'x' || character === digits[index]);
}

/** How a selector is named in a message, e.g. "Nothing is listening on …". */
export function describePortSelector(selector: PortSelector): string {
  switch (selector.kind) {
    case 'exact':
      return `port ${selector.from}`;
    case 'pattern':
      return `ports matching ${selector.text}`;
    default:
      return `ports ${selector.from} to ${selector.to}`;
  }
}

/**
 * Whether a bare argument was meant as a port, so `slash-port 3xxx` works like
 * `slash-port 3000` and a typo in one is reported as a bad port rather than as
 * an unknown option.
 */
export function looksLikePort(raw: string): boolean {
  return /^\d/.test(raw) || /^x[\dx]*$/i.test(raw);
}

/**
 * The filter box reads `3xxx` and `3000:3005` as ports, and everything else —
 * including a bare `3000` — as a substring, because the filter still has to
 * find pids, users, and project names. Half-typed input is not an error there,
 * so an unreadable selector is simply not one.
 */
export function tryPortSelector(raw: string): PortSelector | null {
  const text = raw.trim().toLowerCase();
  if (!/^\d*x[\dx]*$/.test(text) && !/^\d+:\d+$/.test(text)) return null;
  try {
    return parsePortSelector(text);
  } catch {
    return null;
  }
}
