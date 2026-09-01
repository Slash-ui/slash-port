import { describe, expect, test } from 'vitest';
import { annotate, imageName, indexPorts, socketCandidates } from '../src/docker.js';
import {
  advancedFields,
  beginnerBrief,
  formatBytes,
  formatDuration,
  headline,
  riskWord,
} from '../src/explain.js';
import { plainTable, toJson } from '../src/format.js';
import { DEFAULT_MODE, resolveDocker, resolveMode } from '../src/mode.js';
import {
  countLsofEstablished,
  countNetstatEstablished,
  parseElapsed,
  parseProcStat,
} from '../src/inspect.js';
import type { PortEntry } from '../src/types.js';

function entry(overrides: Partial<PortEntry> = {}): PortEntry {
  return {
    id: 'tcp:3000:100',
    protocol: 'tcp',
    port: 3000,
    addresses: ['*'],
    families: [4],
    pid: 100,
    processName: 'node',
    command: 'node /home/dev/shop/node_modules/.bin/next dev',
    user: 'dev',
    label: 'Next.js',
    source: 'signature',
    category: 'web',
    hint: 'shop',
    summary: 'Point a browser at it - that is what it is there for.',
    restart: 'Start it again with `npm run dev`.',
    url: 'http://localhost:3000',
    risk: 'safe',
    riskReason: 'yours, and as easy to start again as it was to start',
    guard: null,
    elevation: null,
    ...overrides,
  };
}

describe('choosing a mode', () => {
  test('beginner is the default, because not knowing is why you are here', () => {
    expect(DEFAULT_MODE).toBe('beginner');
    expect(resolveMode(null, {})).toBe('beginner');
  });

  test('the environment sets the default and a flag overrules it', () => {
    expect(resolveMode(null, { SLASH_PORT_MODE: 'advanced' })).toBe('advanced');
    expect(resolveMode('beginner', { SLASH_PORT_MODE: 'advanced' })).toBe('beginner');
  });

  test('an unreadable SLASH_PORT_MODE is ignored rather than fatal', () => {
    // Nobody wants a tool that refuses to list ports over a typo in a dotfile.
    expect(resolveMode(null, { SLASH_PORT_MODE: 'expert' })).toBe('beginner');
  });
});

describe('asking Docker about a port', () => {
  test('is off unless it was asked for', () => {
    // The claim is that slash-port reads two local tables and stops. Keeping
    // that true by default is worth more than naming a container by default.
    expect(resolveDocker(null, {})).toBe(false);
  });

  test('can be turned on for one run or for good', () => {
    expect(resolveDocker(true, {})).toBe(true);
    expect(resolveDocker(null, { SLASH_PORT_DOCKER: '1' })).toBe(true);
    expect(resolveDocker(null, { SLASH_PORT_DOCKER: 'yes' })).toBe(true);
    // And a flag still overrules the environment.
    expect(resolveDocker(false, { SLASH_PORT_DOCKER: '1' })).toBe(false);
  });

  test('an unreadable SLASH_PORT_DOCKER leaves it off', () => {
    expect(resolveDocker(null, { SLASH_PORT_DOCKER: 'maybe' })).toBe(false);
    expect(resolveDocker(null, { SLASH_PORT_DOCKER: 'off' })).toBe(false);
  });

  test('a container row says the lookup did not run, rather than nothing', () => {
    // Otherwise the default quietly costs the answer: "Docker Desktop" on 5432
    // is true, useless, and gives no clue that a flag would fix it.
    const container = entry({
      port: 5432,
      label: 'Docker Desktop',
      category: 'container',
      hint: null,
    });
    const value = beginnerBrief(container).fields.find((f) => f.label === 'Container')?.value;
    expect(value).toContain('--docker');

    // And says nothing once the lookup has run and found nothing to say.
    expect(
      beginnerBrief(container, { docker: true }).fields.some((f) => f.label === 'Container'),
    ).toBe(false);
  });
});

describe('explaining a row', () => {
  test('the headline names the thing and the kind of thing it is', () => {
    expect(headline(entry())).toBe('Next.js (shop) - a web server');
  });

  test('an unidentified row says so instead of repeating the process name', () => {
    expect(headline(entry({ label: null, category: 'unknown', processName: 'figma_agent' }))).toBe(
      'figma_agent - not identified',
    );
  });

  test('the verdict is one or two words, so the column stays a column', () => {
    expect(riskWord('safe')).toBe('Yes');
    expect(riskWord('protected')).toBe('No');
    expect(riskWord('blocked', 'linux')).toBe('Needs sudo');
    expect(riskWord('blocked', 'win32')).toBe('Not as you');
  });

  test('the beginner brief answers where to open it and whether to close it', () => {
    const brief = beginnerBrief(entry());
    const labels = brief.fields.map((field) => field.label);
    expect(labels).toContain('Open');
    expect(labels).toContain('Close it');
    expect(brief.fields.find((field) => field.label === 'Open')?.value).toBe(
      'http://localhost:3000',
    );
    // The way back gets its own line: it is the half of the answer a narrow
    // panel would otherwise truncate away.
    expect(brief.fields.find((field) => field.label === 'Afterwards')?.value).toContain(
      'npm run dev',
    );
  });

  test('a blocked row is told what would unblock it', () => {
    const brief = beginnerBrief(
      entry({ risk: 'blocked', riskReason: 'not yours to signal', elevation: 'it belongs to root' }),
    );
    expect(brief.fields.map((field) => field.label)).toContain('To signal it');
  });

  test('advanced fields carry the facts that tell two processes apart', () => {
    const fields = advancedFields(entry(), {
      parentPid: 42,
      parentName: 'zsh',
      cwd: '/home/dev/shop',
      uptimeSeconds: 7860,
      startedAt: '14:02',
      rssBytes: 431 * 1024 * 1024,
      established: 3,
    });
    const by = (label: string): string | undefined =>
      fields.find((field) => field.label === label)?.value;

    expect(by('Process')).toContain('parent 42 zsh');
    expect(by('Directory')).toBe('/home/dev/shop');
    expect(by('Running')).toBe('2h 11m (since 14:02)');
    expect(by('Clients')).toBe('3 connections open');
    expect(by('Identified')).toContain('command line');
  });

  test('advanced fields leave out what the platform could not answer', () => {
    const labels = advancedFields(entry(), {}).map((field) => field.label);
    expect(labels).not.toContain('Directory');
    expect(labels).not.toContain('Running');
  });

  test('durations and sizes read the way a person would say them', () => {
    expect(formatDuration(38)).toBe('38s');
    expect(formatDuration(7860)).toBe('2h 11m');
    expect(formatDuration(360000)).toBe('4d 4h');
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(1536)).toBe('1.5 KB');
    expect(formatBytes(431 * 1024 * 1024)).toBe('431 MB');
  });
});

describe('output shapes', () => {
  test('the plain table keeps its six columns in both modes and only appends', () => {
    const stable = ['PORT', 'PID', 'USER', 'PROCESS', 'ADDRESS', 'DESCRIPTION'];
    for (const mode of ['beginner', 'advanced'] as const) {
      const header = plainTable([entry()], mode).split('\n')[0]!;
      // A script that already splits this output has to keep working.
      expect(header.trim().split(/\s{2,}/).slice(0, 6)).toEqual(stable);
    }
    expect(plainTable([entry()], 'beginner').split('\n')[0]).toContain('CAN I CLOSE IT?');
    expect(plainTable([entry()], 'advanced').split('\n')[0]).toContain('COMMAND');
  });

  test('an unidentified row prints a dash, never the process name over again', () => {
    const table = plainTable([entry({ label: null, hint: null })], 'advanced');
    expect(table.split('\n')[1]).toMatch(/\snode\s+\*\s+-\s/);
  });

  test('JSON reports absence as absence and carries every mode at once', () => {
    const [row] = toJson([entry({ label: null, source: 'none' })]) as Array<Record<string, unknown>>;
    expect(row!['description']).toBeNull();
    expect(row!['descriptionSource']).toBe('none');
    expect(row!['category']).toBe('web');
    expect(row!['url']).toBe('http://localhost:3000');
    expect(row!['risk']).toBe('safe');
  });
});

describe('naming the container behind a port', () => {
  const containers = [
    {
      Names: ['/supabase_db_shop'],
      Image: 'public.ecr.aws/supabase/postgres:15.8',
      Labels: { 'com.docker.compose.project': 'shop', 'com.docker.compose.service': 'db' },
      Ports: [{ PublicPort: 54322, Type: 'tcp' }, { Type: 'tcp' }],
    },
    {
      Names: ['/lonely'],
      Image: 'redis:7-alpine',
      Ports: [{ PublicPort: 6379, Type: 'tcp' }],
    },
  ];

  test('an image is one word, whatever registry and tag it arrived with', () => {
    expect(imageName('public.ecr.aws/supabase/postgres:15.8')).toBe('postgres');
    expect(imageName('redis')).toBe('redis');
    expect(imageName('ghcr.io/org/api@sha256:abc123')).toBe('api');
  });

  test('only published ports are indexed, because only those can be matched', () => {
    const index = indexPorts(containers);
    expect([...index.keys()].sort((a, b) => a - b)).toEqual([6379, 54322]);
  });

  test('the image is read like a command line, so postgres:15 is a database', () => {
    const annotated = annotate(
      entry({ port: 54322, label: 'Docker Desktop', category: 'container' }),
      indexPorts(containers).get(54322)!,
    );
    expect(annotated.label).toBe('PostgreSQL in Docker');
    expect(annotated.category).toBe('database');
    expect(annotated.hint).toBe('shop');
    expect(annotated.source).toBe('docker');
    // Killing docker-proxy leaves the container running and the port
    // unpublished, which is a stranger state than either alternative.
    expect(annotated.riskReason).toContain('docker stop supabase_db_shop');
    expect(annotated.restart).toBe('Bring it back with `docker compose up -d db`.');
    // A database is not a web page, so no URL is offered for it.
    expect(annotated.url).toBeNull();
  });

  test('a compose service with no name does not leave a gap in the command', () => {
    const annotated = annotate(entry({ port: 5432, category: 'container' }), {
      name: 'db',
      image: 'postgres:16',
      project: 'shop',
      service: null,
    });
    expect(annotated.restart).toBe('Bring it back with `docker compose up -d`.');
  });

  test('a container with no compose project is named by the container', () => {
    const annotated = annotate(
      entry({ port: 6379, category: 'container' }),
      indexPorts(containers).get(6379)!,
    );
    expect(annotated.hint).toBe('lonely');
    expect(annotated.restart).toContain('docker start lonely');
  });

  test('a compose project that repeats the label gives way to the container name', () => {
    // A project called `docker` is Docker's own honest answer and still tells
    // nobody anything.
    const annotated = annotate(entry({ port: 6379, category: 'container' }), {
      name: 'gymops-redis',
      image: 'redis:7',
      project: 'docker',
      service: 'redis',
    });
    expect(annotated.hint).toBe('gymops-redis');
    expect(annotated.summary).not.toContain('compose project');
    // And the way back names the container, since the project name would not
    // help anyone find the directory to run compose in.
    expect(annotated.restart).toContain('docker start gymops-redis');
  });

  test('a Windows named pipe in DOCKER_HOST is understood', () => {
    // Docker Desktop on Windows sets exactly this, and reading only unix://
    // turned container naming off on the platform the pipe branch exists for.
    expect(socketCandidates({ DOCKER_HOST: 'npipe:////./pipe/docker_engine' }, 'win32', 'C:\\')).toEqual(
      ['\\\\.\\pipe\\docker_engine'],
    );
  });

  test('a TCP DOCKER_HOST is another machine, so no socket is offered at all', () => {
    // slash-port does not make network connections, and answering about the
    // wrong host would be worse than not answering.
    expect(socketCandidates({ DOCKER_HOST: 'tcp://10.0.0.5:2375' }, 'linux', '/home/dev')).toEqual([]);
    expect(socketCandidates({ DOCKER_HOST: 'unix:///tmp/d.sock' }, 'linux', '/home/dev')).toEqual([
      '/tmp/d.sock',
    ]);
  });

  test('the sockets Colima and Rancher use are looked for too', () => {
    const candidates = socketCandidates({}, 'darwin', '/home/dev');
    expect(candidates).toContain('/var/run/docker.sock');
    expect(candidates).toContain('/home/dev/.colima/default/docker.sock');
  });
});

describe('reading a process out of the system', () => {
  test('elapsed time is parsed in all three shapes ps writes it in', () => {
    expect(parseElapsed('05:30')).toBe(330);
    expect(parseElapsed('02:11:00')).toBe(7860);
    expect(parseElapsed('4-03:00:00')).toBe(356400);
    expect(parseElapsed('rubbish')).toBeNull();
  });

  test('a loopback connection is counted once, not once from each end', () => {
    // `lsof -iTCP:PORT` matches a socket whose local *or* remote port is the
    // one asked about, so every localhost connection is listed twice.
    const output = [
      'n127.0.0.1:53452->127.0.0.1:47311',
      'n127.0.0.1:53453->127.0.0.1:47311',
      'n127.0.0.1:47311->127.0.0.1:53452',
      'n127.0.0.1:47311->127.0.0.1:53453',
      'p1234',
      'n*:47311',
    ].join('\n');
    expect(countLsofEstablished(output, 47311)).toBe(2);
    expect(countLsofEstablished('', 47311)).toBe(0);
  });

  test('netstat rows are read by shape, so a translated state still counts', () => {
    // A German Windows writes HERGESTELLT. The scanner already decides what is
    // listening from the row's shape rather than its wording; this matches.
    const output = [
      '  TCP    127.0.0.1:3000         0.0.0.0:0              ABHOEREN         41822',
      '  TCP    127.0.0.1:3000         127.0.0.1:53452        HERGESTELLT      41822',
      '  TCP    127.0.0.1:3000         127.0.0.1:53453        HERGESTELLT      41822',
      '  TCP    127.0.0.1:5173         127.0.0.1:53454        HERGESTELLT      41905',
    ].join('\n');
    expect(countNetstatEstablished(output, 3000)).toBe(2);
    expect(countNetstatEstablished(output, 5173)).toBe(1);
    expect(countNetstatEstablished(output, 9999)).toBe(0);
  });

  test('/proc/[pid]/stat is counted from the last bracket, not split on spaces', () => {
    // A command name may contain spaces and brackets of its own.
    const stat = '4242 (my (odd) name) S 1204 4242 4242 0 -1 4194560 100 0 0 0 1 2 0 0 20 0 9 0 987654 0 0';
    expect(parseProcStat(stat)).toEqual({ ppid: 1204, startTicks: 987654 });
    expect(parseProcStat('nonsense')).toBeNull();
  });
});
