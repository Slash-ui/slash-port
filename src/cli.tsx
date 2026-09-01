#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { plainTable, toJson } from './format.js';
import { killEntry } from './kill.js';
import { scan } from './scan/index.js';
import { ScanError } from './types.js';
import type { PortEntry } from './types.js';

/** 0 success · 1 the action could not be completed · 2 invalid usage. */
const EXIT_OK = 0;
const EXIT_FAILED = 1;
const EXIT_USAGE = 2;

interface Options {
  port: number | null;
  udp: boolean;
  json: boolean;
  plain: boolean;
  kill: boolean;
  force: boolean;
  yes: boolean;
  graceMs: number;
  color: boolean;
  help: boolean;
  version: boolean;
}

class UsageError extends Error {}

function parseArgs(argv: readonly string[]): Options {
  const options: Options = {
    port: null,
    udp: false,
    json: false,
    plain: false,
    kill: false,
    force: false,
    yes: false,
    graceMs: 3000,
    color: true,
    help: false,
    version: false,
  };

  const value = (flag: string, next: string | undefined): string => {
    if (next === undefined || next.startsWith('-')) throw new UsageError(`${flag} needs a value.`);
    return next;
  };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]!;
    switch (argument) {
      case '-p':
      case '--port': {
        const raw = value(argument, argv[++index]);
        const port = Number.parseInt(raw, 10);
        if (!Number.isInteger(port) || port < 1 || port > 65535) {
          throw new UsageError(`${raw} is not a port number between 1 and 65535.`);
        }
        options.port = port;
        break;
      }
      case '-u':
      case '--udp':
        options.udp = true;
        break;
      case '--json':
        options.json = true;
        break;
      case '--plain':
        options.plain = true;
        break;
      case '--kill':
        options.kill = true;
        break;
      case '--force':
        options.force = true;
        break;
      case '-y':
      case '--yes':
        options.yes = true;
        break;
      case '--grace': {
        const raw = value(argument, argv[++index]);
        const ms = Number.parseInt(raw, 10);
        if (!Number.isInteger(ms) || ms < 0) throw new UsageError(`${raw} is not a number of milliseconds.`);
        options.graceMs = ms;
        break;
      }
      case '--no-color':
      case '--no-colour':
        options.color = false;
        break;
      case '-h':
      case '--help':
        options.help = true;
        break;
      case '-v':
      case '--version':
        options.version = true;
        break;
      default:
        if (/^\d+$/.test(argument) && options.port === null) {
          // `slash-port 3000` is what everyone tries first.
          const port = Number.parseInt(argument, 10);
          if (port < 1 || port > 65535) throw new UsageError(`${argument} is not a port number.`);
          options.port = port;
          break;
        }
        throw new UsageError(`Unknown option: ${argument}`);
    }
  }

  if (options.json && options.plain) throw new UsageError('--json and --plain cannot both be used.');

  // The one rule that matters: nothing is ever killed without being named and
  // confirmed, and no flag combination gets round it.
  if (options.kill) {
    if (options.port === null) throw new UsageError('--kill needs --port, so the target is named.');
    if (!options.yes) throw new UsageError('--kill needs --yes, so the kill is confirmed.');
  }
  if (options.force && !options.kill) throw new UsageError('--force only means something with --kill.');

  return options;
}

const HELP = `slash-port — see what is listening on your ports, and kill it safely.

Usage
  slash-port [port] [options]

Options
  -p, --port <number>  Only this port
  -u, --udp            Include UDP sockets as well as TCP
      --json           Print JSON to stdout and exit
      --plain          Print a plain table and exit
      --kill           Kill the process on --port. Requires --yes
      --force          Escalate to SIGKILL instead of SIGTERM
  -y, --yes            Confirm a kill made from the command line
      --grace <ms>     Wait this long for a graceful exit (default 3000)
      --no-color       Disable colour
  -h, --help           Show this help
  -v, --version        Show the version

Keys
  up/down or j/k  move          /  filter      x or Enter  kill
  PgUp/PgDn       page          r  rescan      u           toggle UDP
  g / G           first / last  q  quit        y/f/n       confirm dialog

Exit codes
  0  success
  1  the requested action could not be completed
  2  invalid usage

slash-port never kills without confirmation; never kills init, sshd, your
session, or the shell that launched it; sends SIGTERM before SIGKILL; and
never touches the network.`;

function readVersion(): string {
  try {
    const manifest = readFileSync(new URL('../package.json', import.meta.url), 'utf8');
    return (JSON.parse(manifest) as { version?: string }).version ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
}

function selectPort(entries: readonly PortEntry[], options: Options): PortEntry[] {
  if (options.port === null) return [...entries];
  return entries.filter(
    (entry) => entry.port === options.port && (options.udp || entry.protocol === 'tcp'),
  );
}

async function killFromCli(entries: readonly PortEntry[], options: Options): Promise<number> {
  const targets = selectPort(entries, options);

  if (targets.length === 0) {
    process.stderr.write(`Nothing is listening on port ${options.port}.\n`);
    return EXIT_FAILED;
  }

  let failures = 0;
  for (const target of targets) {
    const result = await killEntry(target, {
      signal: options.force ? 'SIGKILL' : 'SIGTERM',
      graceMs: options.graceMs,
    });
    const ok = result.status === 'terminated' || result.status === 'gone';
    (ok ? process.stdout : process.stderr).write(`${result.message}\n`);
    if (!ok) failures += 1;
  }

  return failures === 0 ? EXIT_OK : EXIT_FAILED;
}

async function main(argv: readonly string[]): Promise<number> {
  let options: Options;
  try {
    options = parseArgs(argv);
  } catch (error) {
    process.stderr.write(`${(error as Error).message}\n\nRun slash-port --help for usage.\n`);
    return EXIT_USAGE;
  }

  if (options.help) {
    process.stdout.write(`${HELP}\n`);
    return EXIT_OK;
  }
  if (options.version) {
    process.stdout.write(`${readVersion()}\n`);
    return EXIT_OK;
  }

  // Set before Ink or chalk is loaded, because both decide colour support at
  // import time. This is why the UI is imported lazily further down.
  if (!options.color) process.env['NO_COLOR'] = '1';

  let entries: PortEntry[];
  try {
    entries = await scan({ udp: options.udp });
  } catch (error) {
    if (error instanceof ScanError) {
      process.stderr.write(`${error.message}\n`);
      if (error.hint) process.stderr.write(`${error.hint}\n`);
      return EXIT_FAILED;
    }
    throw error;
  }

  if (options.kill) return killFromCli(entries, options);

  // A pipe or a redirect gets plain text, never control codes, and the TUI is
  // never started when either stream is not a terminal.
  const interactive =
    !options.json && !options.plain && Boolean(process.stdout.isTTY) && Boolean(process.stdin.isTTY);

  if (!interactive) {
    const selected = selectPort(entries, options);
    if (options.json) {
      process.stdout.write(`${JSON.stringify(toJson(selected), null, 2)}\n`);
    } else {
      process.stdout.write(`${plainTable(selected)}\n`);
    }
    // Asking about one port is a question with a yes-or-no answer, so an empty
    // result is a failure. Asking for the whole list is not.
    return options.port !== null && selected.length === 0 ? EXIT_FAILED : EXIT_OK;
  }

  const [{ render }, { App }] = await Promise.all([import('ink'), import('./ui/App.js')]);
  const instance = render(
    <App
      initialEntries={entries}
      initialFilter={options.port === null ? '' : String(options.port)}
      udp={options.udp}
    />,
  );
  await instance.waitUntilExit();
  return EXIT_OK;
}

main(process.argv.slice(2)).then(
  (code) => {
    // Set rather than exit, so piped stdout is flushed before the process ends.
    process.exitCode = code;
  },
  (error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = EXIT_FAILED;
  },
);
