#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { plainTable, toJson } from './format.js';
import { killEntry } from './kill.js';
import { isMode, resolveDocker, resolveMode } from './mode.js';
import { describePortSelector, looksLikePort, matchesPort, parsePortSelector } from './ports.js';
import { scan } from './scan/index.js';
import { ScanError } from './types.js';
import type { PortSelector } from './ports.js';
import type { Mode, PortEntry } from './types.js';

/**
 * The exit codes every slash-* tool shares, so a script that wraps one can
 * wrap any of them:
 *
 *   0  success
 *   1  invalid arguments or usage
 *   2  the thing asked about was not found
 *   3  refused - a confirmation was missing, or a guardrail tripped
 *   4  the operation was attempted and failed
 *
 * The standard reserves 5 for an integrity failure, which this tool has
 * nothing to verify and so never returns.
 */
const EXIT_OK = 0;
const EXIT_USAGE = 1;
const EXIT_NOT_FOUND = 2;
const EXIT_REFUSED = 3;
const EXIT_FAILED = 4;

interface Options {
  port: PortSelector | null;
  /** `null` means nothing on the command line said, so the environment decides. */
  mode: Mode | null;
  udp: boolean;
  /** `null` means nothing on the command line said, so the environment decides. */
  docker: boolean | null;
  json: boolean;
  plain: boolean;
  kill: boolean;
  force: boolean;
  yes: boolean;
  all: boolean;
  graceMs: number;
  color: boolean;
  help: boolean;
  version: boolean;
}

/**
 * A command line that cannot be run. Most of these are malformed and exit 1,
 * but a missing confirmation is a refusal rather than a mistake, so the code
 * travels with the message.
 */
class UsageError extends Error {
  readonly code: number;

  constructor(message: string, code: number = EXIT_USAGE) {
    super(message);
    this.code = code;
  }
}

function parseArgs(argv: readonly string[]): Options {
  const options: Options = {
    port: null,
    mode: null,
    udp: false,
    docker: null,
    json: false,
    plain: false,
    kill: false,
    force: false,
    yes: false,
    all: false,
    graceMs: 3000,
    color: true,
    help: false,
    version: false,
  };

  const value = (flag: string, next: string | undefined): string => {
    if (next === undefined || next.startsWith('-')) throw new UsageError(`${flag} needs a value.`);
    return next;
  };

  // A bad port is a usage error like any other, so it exits 2 with the same
  // shape of message rather than as an unhandled failure.
  const selector = (raw: string): PortSelector => {
    try {
      return parsePortSelector(raw);
    } catch (error) {
      throw new UsageError((error as Error).message);
    }
  };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]!;
    switch (argument) {
      case '-p':
      case '--port':
        options.port = selector(value(argument, argv[++index]));
        break;
      case '--beginner':
        options.mode = 'beginner';
        break;
      case '--advanced':
        options.mode = 'advanced';
        break;
      case '--mode': {
        const raw = value(argument, argv[++index]).toLowerCase();
        if (!isMode(raw)) throw new UsageError(`${raw} is not a mode. Use beginner or advanced.`);
        options.mode = raw;
        break;
      }
      case '-u':
      case '--udp':
        options.udp = true;
        break;
      case '--docker':
        options.docker = true;
        break;
      case '--no-docker':
        options.docker = false;
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
      case '--all':
        options.all = true;
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
        if (looksLikePort(argument) && options.port === null) {
          // `slash-port 3000` is what everyone tries first.
          options.port = selector(argument);
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
    if (!options.yes) {
      throw new UsageError('--kill needs --yes, so the kill is confirmed.', EXIT_REFUSED);
    }
    // Whether a pattern happens to match one port today is not the point: the
    // same command matches more tomorrow, so the plural is confirmed up front.
    if (options.port.kind !== 'exact' && !options.all) {
      throw new UsageError(
        `--kill needs --all to use ${options.port.text}, so killing every match is deliberate.`,
        EXIT_REFUSED,
      );
    }
  }
  if (options.force && !options.kill) throw new UsageError('--force only means something with --kill.');
  if (options.all && !options.kill) throw new UsageError('--all only means something with --kill.');

  return options;
}

const HELP = `slash-port - see what is listening on your ports, and kill it safely.

Usage
  slash-port [ports] [options]

Ports
  3000                 one port
  3xxx                 every port from 3000 to 3999; x is any digit
  3000:3005            every port in the range, both ends included

Options
  -p, --port <ports>   Only these ports, in any of the forms above
      --beginner       Explain each port in plain language (the default)
      --advanced       Show the full detail instead of the explanations
      --mode <name>    beginner or advanced. SLASH_PORT_MODE sets the default
  -u, --udp            Include UDP sockets as well as TCP
      --docker         Ask the local Docker socket which container holds a port
      --json           Print JSON to stdout and exit
      --plain          Print a plain table and exit
      --kill           Kill the process on --port. Requires --yes
      --force          Escalate to SIGKILL instead of SIGTERM
  -y, --yes            Confirm a kill made from the command line
      --all            Kill every port a pattern or a range matches
      --grace <ms>     Wait this long for a graceful exit (default 3000)
      --no-color       Disable colour
  -h, --help           Show this help
  -v, --version        Show the version

Keys
  up/down or j/k  move          /  filter      x or Enter  kill
  PgUp/PgDn       page          r  rescan      u           toggle UDP
  g / G           first / last  q  quit        y/f/n       confirm dialog
  m  switch mode                d  show or hide the detail panel

Modes
  Beginner mode is the default. It says what each port is in plain language,
  where to open it, and whether closing it is a good idea. Advanced mode shows
  pids, users, bind addresses, command lines, working directories, uptime, and
  how many connections are open. Press m to switch, or set SLASH_PORT_MODE.

Exit codes
  0  success
  1  invalid arguments or usage
  2  nothing is listening on the ports asked about
  3  refused: a confirmation was missing, or a guardrail tripped
  4  the operation was attempted and failed

slash-port never kills without confirmation; never kills init, sshd, your
session, or the shell that launched it; and sends SIGTERM before SIGKILL.

It makes no network connections, and asks nothing else on the machine anything
either. --docker is the single exception: it reads the local Docker socket - a
file on this machine - for the name of the container behind a published port.
SLASH_PORT_DOCKER=1 turns that on for good.`;

function readVersion(): string {
  try {
    const manifest = readFileSync(new URL('../package.json', import.meta.url), 'utf8');
    return (JSON.parse(manifest) as { version?: string }).version ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
}

function selectPort(entries: readonly PortEntry[], options: Options): PortEntry[] {
  const selector = options.port;
  if (selector === null) return [...entries];
  return entries.filter(
    (entry) => matchesPort(selector, entry.port) && (options.udp || entry.protocol === 'tcp'),
  );
}

async function killFromCli(entries: readonly PortEntry[], options: Options): Promise<number> {
  // parseArgs refuses --kill without --port, so there is always a selector here.
  const selector = options.port!;
  const targets = selectPort(entries, options);

  if (targets.length === 0) {
    process.stderr.write(`Nothing is listening on ${describePortSelector(selector)}.\n`);
    return EXIT_NOT_FOUND;
  }

  let refusals = 0;
  let failures = 0;

  for (const target of targets) {
    const result = await killEntry(target, {
      signal: options.force ? 'SIGKILL' : 'SIGTERM',
      graceMs: options.graceMs,
    });
    const ok = result.status === 'terminated' || result.status === 'gone';
    (ok ? process.stdout : process.stderr).write(`${result.message}\n`);
    if (!ok) {
      if (result.status === 'refused') refusals += 1;
      else failures += 1;
    }
  }

  // A guardrail that stopped a kill is a refusal; a signal that was sent and
  // did not work is a failure, and outranks it when one command did both.
  if (failures > 0) return EXIT_FAILED;
  if (refusals > 0) return EXIT_REFUSED;
  return EXIT_OK;
}

async function main(argv: readonly string[]): Promise<number> {
  let options: Options;
  try {
    options = parseArgs(argv);
  } catch (error) {
    const code = error instanceof UsageError ? error.code : EXIT_USAGE;
    process.stderr.write(`${(error as Error).message}\n`);
    // A refusal names the flag that answers it, so the help pointer would be
    // noise. A malformed command line is the case that needs pointing.
    if (code === EXIT_USAGE) process.stderr.write('\nRun slash-port --help for usage.\n');
    return code;
  }

  const mode = resolveMode(options.mode);
  const docker = resolveDocker(options.docker);

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
    entries = await scan({ udp: options.udp, docker });
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
      process.stdout.write(`${plainTable(selected, mode)}\n`);
    }
    // Asking about a port is a question with a yes-or-no answer, so an empty
    // result means not found. Asking for the whole list is not a question.
    return options.port !== null && selected.length === 0 ? EXIT_NOT_FOUND : EXIT_OK;
  }

  const [{ render }, { App }] = await Promise.all([import('ink'), import('./ui/App.js')]);
  const instance = render(
    <App
      initialEntries={entries}
      initialFilter={options.port === null ? '' : options.port.text}
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
