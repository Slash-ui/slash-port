import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { describe as describeEntry, guardReason, projectHint } from '../src/describe.js';
import { parseLsof, parsePs } from '../src/scan/darwin.js';
import { collapse } from '../src/scan/index.js';
import { decodeAddress, parseProcNet, parseProcNetRows } from '../src/scan/linux.js';
import { normaliseAddress, splitHostPort } from '../src/scan/shared.js';
import { parseNetstat, parseTasklist } from '../src/scan/win32.js';
import type { RawSocket } from '../src/types.js';

const fixture = (name: string): string =>
  readFileSync(new URL(`fixtures/${name}`, import.meta.url), 'utf8');

function socket(overrides: Partial<RawSocket> = {}): RawSocket {
  return {
    protocol: 'tcp',
    family: 4,
    address: '*',
    port: 3000,
    pid: 1234,
    processName: 'node',
    command: null,
    user: 'dev',
    ...overrides,
  };
}

describe('/proc address decoding', () => {
  test('reads IPv4 words little-endian', () => {
    // 0x7F000001 written host-endian is 0100007F, not 7F000001. Reading it the
    // other way round yields 1.0.0.127, which is a real address elsewhere.
    expect(decodeAddress('0100007F')).toEqual({ address: '127.0.0.1', family: 4 });
    expect(decodeAddress('00000000')).toEqual({ address: '0.0.0.0', family: 4 });
    expect(decodeAddress('0101A8C0')).toEqual({ address: '192.168.1.1', family: 4 });
  });

  test('byte-swaps each IPv6 word independently and compresses zeroes', () => {
    expect(decodeAddress('00000000000000000000000000000000')).toEqual({ address: '::', family: 6 });
    expect(decodeAddress('000080FE00000000000000000100000A')).toEqual({
      address: 'fe80::a00:1',
      family: 6,
    });
  });

  test('renders IPv4-mapped addresses in their dotted form', () => {
    expect(decodeAddress('0000000000000000FFFF00000100007F')).toEqual({
      address: '::ffff:127.0.0.1',
      family: 6,
    });
  });

  test('rejects a literal that is neither IPv4 nor IPv6', () => {
    expect(() => decodeAddress('ABC')).toThrow(/unrecognised/);
  });
});

describe('/proc/net parsing', () => {
  test('reads every row of a captured table, header excluded', () => {
    const rows = parseProcNetRows(fixture('proc-net-tcp'));
    expect(rows).toHaveLength(5);
    expect(rows[0]).toMatchObject({ address: '0.0.0.0', port: 8080, uid: 1000, inode: 34521 });
  });

  test('keeps only TCP sockets in LISTEN', () => {
    const rows = parseProcNet(fixture('proc-net-tcp'), 'tcp');
    expect(rows.map((row) => row.port)).toEqual([8080, 5432, 22]);
    // The established socket on 49588 and the TIME_WAIT one on 8081 are gone.
    expect(rows.every((row) => row.state === '0A')).toBe(true);
  });

  test('keeps only UDP sockets with no peer', () => {
    const rows = parseProcNet(fixture('proc-net-udp'), 'udp');
    expect(rows.map((row) => row.port)).toEqual([5353]);
  });

  test('parses the IPv6 table, including link-local and mapped addresses', () => {
    const rows = parseProcNet(fixture('proc-net-tcp6'), 'tcp');
    expect(rows.map((row) => row.address)).toEqual(['::', 'fe80::a00:1', '::ffff:127.0.0.1']);
    expect(rows.every((row) => row.family === 6)).toBe(true);
  });

  test('ignores a truncated or corrupt line rather than failing the scan', () => {
    expect(parseProcNetRows('   0: 00000000:1F90 0A\nnonsense\n')).toEqual([]);
  });
});

describe('socket collapsing', () => {
  test('folds the IPv4 and IPv6 sockets of one server into one row', () => {
    const entries = collapse([
      socket({ family: 4, address: '0.0.0.0' }),
      socket({ family: 6, address: '::' }),
    ]);

    expect(entries).toHaveLength(1);
    expect(entries[0]!.families).toEqual([4, 6]);
    // Both wildcards normalise to the same display form.
    expect(entries[0]!.addresses).toEqual(['*']);
  });

  test('keeps two different processes on one port apart', () => {
    const entries = collapse([socket({ pid: 10 }), socket({ pid: 20 })]);
    expect(entries).toHaveLength(2);
  });

  test('does not merge an unowned socket into an owned one', () => {
    const entries = collapse([socket({ pid: 10 }), socket({ pid: null, processName: null })]);
    expect(entries).toHaveLength(2);
  });

  test('keeps distinct bind addresses and prefers the socket with a command line', () => {
    const entries = collapse([
      socket({ address: '127.0.0.1', command: null }),
      socket({ address: '192.168.1.5', command: 'node server.js' }),
    ]);
    expect(entries[0]!.addresses).toEqual(['127.0.0.1', '192.168.1.5']);
    expect(entries[0]!.command).toBe('node server.js');
  });

  test('sorts by port, then protocol', () => {
    const entries = collapse([
      socket({ port: 8080 }),
      socket({ port: 80, protocol: 'udp' }),
      socket({ port: 80 }),
    ]);
    expect(entries.map((entry) => `${entry.port}/${entry.protocol}`)).toEqual([
      '80/tcp',
      '80/udp',
      '8080/tcp',
    ]);
  });
});

describe('description heuristics', () => {
  test('names the framework rather than the runtime that hosts it', () => {
    expect(
      describeEntry({
        command: '/usr/local/bin/node /home/dev/shop/node_modules/.bin/vite --port 5173',
        processName: 'node',
        port: 5173,
        pid: 42,
      }).label,
    ).toBe('Vite dev server');

    expect(
      describeEntry({
        command: 'node /srv/site/node_modules/next/dist/bin/next dev',
        processName: 'node',
        port: 3000,
        pid: 42,
      }).label,
    ).toBe('Next.js');
  });

  test('falls back to the runtime when nothing more specific matches', () => {
    expect(
      describeEntry({ command: 'node server.js', processName: 'node', port: 3000, pid: 42 }).label,
    ).toBe('Node.js');
  });

  test('names the project so two dev servers can be told apart', () => {
    expect(projectHint('node /home/dev/shop/node_modules/.bin/vite')).toBe('shop');
    expect(projectHint('node /home/dev/admin/node_modules/.bin/vite')).toBe('admin');
    expect(projectHint('python3 /srv/api/manage.py runserver')).toBe('api');
    expect(projectHint(null)).toBeNull();
  });

  test('uses the port registry only when the process is unidentifiable', () => {
    expect(
      describeEntry({ command: null, processName: null, port: 5432, pid: null }).label,
    ).toBe('PostgreSQL');
  });

  test('suppresses registry entries that would add nothing', () => {
    // "dev server" on 3000 tells a developer precisely what they already knew.
    const description = describeEntry({ command: null, processName: null, port: 3000, pid: null });
    expect(description.label).toBe('owner not visible');
  });
});

describe('protection rules', () => {
  test('refuses the init process by pid and by name', () => {
    expect(guardReason({ pid: 1, processName: 'systemd' })).toMatch(/init/);
    expect(guardReason({ pid: 900, processName: 'launchd' })).toMatch(/init/);
  });

  test('refuses sshd, and says why', () => {
    expect(guardReason({ pid: 900, processName: 'sshd' })).toMatch(/locks you out/);
  });

  test('refuses slash-port itself and the shell that launched it', () => {
    expect(guardReason({ pid: 5, processName: 'node' }, { self: 5, parent: 6 })).toMatch(/itself/);
    expect(guardReason({ pid: 6, processName: 'zsh' }, { self: 5, parent: 6 })).toMatch(/shell/);
  });

  test('matches Windows names regardless of case or extension', () => {
    expect(guardReason({ pid: 700, processName: 'LSASS.EXE' })).toMatch(/security subsystem/);
  });

  test('allows an ordinary dev server', () => {
    expect(guardReason({ pid: 4321, processName: 'node' }, { self: 5, parent: 6 })).toBeNull();
  });
});

describe('address helpers', () => {
  test('shows every wildcard form as a single asterisk', () => {
    expect(normaliseAddress('0.0.0.0')).toBe('*');
    expect(normaliseAddress('::')).toBe('*');
    expect(normaliseAddress('[::]')).toBe('*');
    expect(normaliseAddress('[::1]')).toBe('::1');
  });

  test('splits a host and port when the host is itself full of colons', () => {
    expect(splitHostPort('[::1]:8080')).toEqual({ address: '::1', port: 8080 });
    expect(splitHostPort('127.0.0.1:80')).toEqual({ address: '127.0.0.1', port: 80 });
    expect(splitHostPort('no-port-here')).toBeNull();
  });
});

describe('macOS lsof parsing', () => {
  const output = ['p501', 'cnode', 'Ldev', 'f23', 'tIPv4', 'n*:3000', 'f24', 'tIPv6', 'n[::1]:3000', 'p502', 'cpostgres', 'Lpostgres', 'f7', 'tIPv4', 'n127.0.0.1:5432'].join('\n');

  test('reads tagged field output rather than aligned columns', () => {
    const records = parseLsof(output);
    expect(records).toHaveLength(3);
    expect(records[0]).toMatchObject({ pid: 501, command: 'node', user: 'dev', address: '*', port: 3000, family: 4 });
    expect(records[1]).toMatchObject({ family: 6, address: '::1' });
    expect(records[2]).toMatchObject({ pid: 502, command: 'postgres', port: 5432 });
  });

  test('drops connected sockets, which are not listening', () => {
    expect(parseLsof('p1\ncnode\nf3\ntIPv4\nn127.0.0.1:5000->127.0.0.1:80')).toEqual([]);
  });

  test('reads the full command line out of ps', () => {
    const processes = parsePs('  501 dev      node /srv/app/index.js --port 3000\n  502 root     /usr/sbin/sshd -D\n');
    expect(processes.get(501)).toEqual({ user: 'dev', command: 'node /srv/app/index.js --port 3000' });
    expect(processes.get(502)?.user).toBe('root');
  });
});

describe('Windows netstat and tasklist parsing', () => {
  const netstat = [
    'Active Connections',
    '',
    '  Proto  Local Address          Foreign Address        State           PID',
    '  TCP    0.0.0.0:135            0.0.0.0:0              LISTENING       1084',
    '  TCP    [::]:135               [::]:0                 LISTENING       1084',
    '  TCP    127.0.0.1:52134        127.0.0.1:3000         ESTABLISHED     8123',
    '  UDP    0.0.0.0:5353           *:*                                    2400',
  ].join('\n');

  test('keeps listening TCP rows and drops established ones', () => {
    const rows = parseNetstat(netstat);
    expect(rows.filter((row) => row.protocol === 'tcp')).toHaveLength(2);
    expect(rows.some((row) => row.port === 52134)).toBe(false);
  });

  test('reads the pid from the last column, which UDP rows shift', () => {
    const udp = parseNetstat(netstat).find((row) => row.protocol === 'udp');
    expect(udp).toMatchObject({ port: 5353, pid: 2400 });
  });

  test('records the family from the bracketed IPv6 form', () => {
    expect(parseNetstat(netstat).map((row) => row.family)).toEqual([4, 6, 4]);
  });

  test('reads image name and user out of tasklist CSV', () => {
    const processes = parseTasklist(
      '"node.exe","8123","Console","1","52,300 K","Running","DESKTOP\\\\dev","0:00:12","N/A"\n' +
        '"System Idle Process","0","Services","0","8 K","Unknown","NT AUTHORITY\\\\SYSTEM","3:21:00","N/A"\n',
    );
    expect(processes.get(8123)).toEqual({ name: 'node.exe', user: 'DESKTOP\\\\dev' });
    expect(processes.get(0)?.name).toBe('System Idle Process');
  });
});
