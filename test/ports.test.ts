import { describe, expect, test } from 'vitest';
import { matchesFilter } from '../src/format.js';
import {
  describePortSelector,
  looksLikePort,
  matchesPort,
  parsePortSelector,
  tryPortSelector,
} from '../src/ports.js';
import type { PortEntry } from '../src/types.js';

const matches = (raw: string, port: number): boolean => matchesPort(parsePortSelector(raw), port);

describe('one port', () => {
  test('reads a port number and matches only it', () => {
    const selector = parsePortSelector('3000');
    expect(selector.kind).toBe('exact');
    expect(selector.text).toBe('3000');
    expect(matchesPort(selector, 3000)).toBe(true);
    expect(matchesPort(selector, 3001)).toBe(false);
  });

  test('refuses a number that is not a port', () => {
    expect(() => parsePortSelector('0')).toThrow(/between 1 and 65535/);
    expect(() => parsePortSelector('65536')).toThrow(/between 1 and 65535/);
    expect(() => parsePortSelector('123456')).toThrow(/between 1 and 65535/);
  });

  test('says what the three forms are when the argument is none of them', () => {
    expect(() => parsePortSelector('http')).toThrow(/pattern like 3xxx.*range like 3000:3005/);
  });
});

describe('patterns', () => {
  test('x stands for one digit, so 3xxx is the 3000s', () => {
    expect(matches('3xxx', 3000)).toBe(true);
    expect(matches('3xxx', 3999)).toBe(true);
    expect(matches('3xxx', 2999)).toBe(false);
    expect(matches('3xxx', 4000)).toBe(false);
  });

  // A pattern is matched against the digits of the port, not against its
  // value: `3xxx` is four digits beginning with 3, so 300 is not in it.
  test('a port with a different number of digits never matches', () => {
    expect(matches('3xxx', 300)).toBe(false);
    expect(matches('3xxx', 30000)).toBe(false);
    expect(matches('xxx', 443)).toBe(true);
    expect(matches('xxx', 80)).toBe(false);
    expect(matches('xxx', 8080)).toBe(false);
  });

  test('x can be anywhere in the pattern, not only at the end', () => {
    expect(matches('8x80', 8080)).toBe(true);
    expect(matches('8x80', 8980)).toBe(true);
    expect(matches('8x80', 8081)).toBe(false);
  });

  test('X is the same as x', () => {
    expect(parsePortSelector('3XXX').text).toBe('3xxx');
    expect(matches('3XXX', 3500)).toBe(true);
  });

  test('the top of a pattern is clamped to the highest real port', () => {
    const selector = parsePortSelector('65xxx');
    expect(selector.to).toBe(65535);
    expect(matchesPort(selector, 65000)).toBe(true);
    expect(matchesPort(selector, 65535)).toBe(true);
    expect(matchesPort(selector, 65999)).toBe(false);
  });

  test('refuses a pattern no port can satisfy', () => {
    expect(() => parsePortSelector('7xxxx')).toThrow(/No port between 1 and 65535 matches 7xxxx/);
    expect(() => parsePortSelector('xxxxxx')).toThrow(/No port between 1 and 65535/);
    // No port is written with a leading zero, so `0xxx` would match nothing.
    expect(() => parsePortSelector('0xxx')).toThrow(/No port between 1 and 65535/);
  });

  test('refuses a pattern with something other than digits and x in it', () => {
    expect(() => parsePortSelector('3x0y')).toThrow(/not a port pattern/);
  });
});

describe('ranges', () => {
  test('both ends are included', () => {
    const selector = parsePortSelector('3000:3005');
    expect(selector.kind).toBe('range');
    expect([selector.from, selector.to]).toEqual([3000, 3005]);
    expect(matchesPort(selector, 3000)).toBe(true);
    expect(matchesPort(selector, 3003)).toBe(true);
    expect(matchesPort(selector, 3005)).toBe(true);
    expect(matchesPort(selector, 2999)).toBe(false);
    expect(matchesPort(selector, 3006)).toBe(false);
  });

  // Killing is refused for anything that can match several ports, so a range
  // of one has to collapse or `--port 3000:3000 --kill` would need `--all`.
  test('a range of one port is that port', () => {
    const selector = parsePortSelector('3000:3000');
    expect(selector.kind).toBe('exact');
    expect(selector.text).toBe('3000');
  });

  test('a backwards range says how to write it', () => {
    expect(() => parsePortSelector('3005:3000')).toThrow(/runs backwards.*3000:3005/);
  });

  test('each end has to be a port', () => {
    expect(() => parsePortSelector('3000:99999')).toThrow(/99999 is not a port number/);
    expect(() => parsePortSelector('3000:')).toThrow(/not a port range/);
    expect(() => parsePortSelector('3000:3005:3010')).toThrow(/not a port range/);
  });
});

describe('describing a selector', () => {
  test('names ports the way a sentence needs them', () => {
    expect(describePortSelector(parsePortSelector('3000'))).toBe('port 3000');
    expect(describePortSelector(parsePortSelector('3xxx'))).toBe('ports matching 3xxx');
    expect(describePortSelector(parsePortSelector('3000:3005'))).toBe('ports 3000 to 3005');
  });
});

describe('bare arguments', () => {
  test('anything starting like a port is read as one, so a typo in it says so', () => {
    expect(looksLikePort('3000')).toBe(true);
    expect(looksLikePort('3xxx')).toBe(true);
    expect(looksLikePort('3000:3005')).toBe(true);
    expect(looksLikePort('xxx')).toBe(true);
    expect(looksLikePort('--port')).toBe(false);
    expect(looksLikePort('nonsense')).toBe(false);
  });
});

const entry = (port: number, overrides: Partial<PortEntry> = {}): PortEntry => ({
  id: `tcp:${port}`,
  protocol: 'tcp',
  port,
  addresses: ['*'],
  families: [4],
  pid: 100,
  processName: 'node',
  command: 'node server.js',
  user: 'dev',
  label: 'Node.js',
  hint: null,
  guard: null,
  ...overrides,
});

describe('the filter box', () => {
  test('reads patterns and ranges as ports', () => {
    expect(tryPortSelector('3xxx')?.text).toBe('3xxx');
    expect(tryPortSelector('3000:3005')?.text).toBe('3000:3005');
    expect(matchesFilter(entry(3500), '3xxx')).toBe(true);
    expect(matchesFilter(entry(4500), '3xxx')).toBe(false);
    expect(matchesFilter(entry(3005), '3000:3005')).toBe(true);
    expect(matchesFilter(entry(3006), '3000:3005')).toBe(false);
  });

  // A pattern can only mean a port. Everything else is still a substring of
  // the whole row, which is how pids, users, and project names are found.
  test('a pattern matches the port and nothing else in the row', () => {
    const noisy = entry(5173, { pid: 30001, hint: '3xxx' });
    expect(matchesFilter(noisy, '3xxx')).toBe(false);
    expect(matchesFilter(noisy, '3000')).toBe(true);
    expect(matchesFilter(noisy, 'node')).toBe(true);
  });

  test('half-typed input is a substring, not an error', () => {
    expect(tryPortSelector('3000')).toBeNull();
    expect(tryPortSelector('3000:')).toBeNull();
    expect(tryPortSelector('7xxxx')).toBeNull();
    expect(tryPortSelector('vite')).toBeNull();
    expect(matchesFilter(entry(3000), '3000:')).toBe(false);
  });
});
