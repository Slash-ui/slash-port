# slash-port

[![npm](https://img.shields.io/npm/v/slash-port?logo=npm&logoColor=white&color=0f8b7d)](https://www.npmjs.com/package/slash-port)
[![downloads](https://img.shields.io/npm/dm/slash-port?color=0f8b7d)](https://www.npmjs.com/package/slash-port)
[![CI](https://github.com/Slash-ui/slash-port/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/Slash-ui/slash-port/actions/workflows/ci.yml)
[![Release](https://github.com/Slash-ui/slash-port/actions/workflows/release.yml/badge.svg?branch=main)](https://github.com/Slash-ui/slash-port/actions/workflows/release.yml)
[![node](https://img.shields.io/node/v/slash-port?color=5a6a78)](https://nodejs.org)
[![licence](https://img.shields.io/npm/l/slash-port?color=5a6a78)](LICENSE)
[![Conventional Commits](https://img.shields.io/badge/commits-conventional-0f8b7d)](https://www.conventionalcommits.org)

See what is listening on your ports, understand what it is, and kill it safely.

**[slash-ui.github.io/slash-port](https://slash-ui.github.io/slash-port/)**

`EADDRINUSE: address already in use :::3000` tells you a port is taken. It does
not tell you what took it, which project it belongs to, or whether killing it is
a good idea. `slash-port` answers all three, then kills the process for you
after a confirmation that names it.

```
slash-port                                                               6/6 tcp
PORT        PID     USER       PROCESS            DESCRIPTION
3000/tcp    41822   amin       node               Next.js (shop)
5173/tcp    41905   amin       node               Vite dev server (admin)
5432/tcp    612     postgres   postgres           PostgreSQL
6379/tcp    788     redis      redis-server       Redis
8080/tcp    39044   amin       docker-proxy       Docker published port
22/tcp      1       root       sshd               OpenSSH server [protected]
↑↓/jk move · PgUp/PgDn/g/G jump · / filter · x kill · r rescan · u udp · q quit
```

## Install

```sh
npm install -g slash-port
```

Or run it once, without installing:

```sh
npx slash-port
```

Requires Node 22 or newer. Works on Linux, macOS, and Windows.

## Use

```sh
slash-port              # the interactive list
slash-port 3000         # open on port 3000
slash-port --plain      # a plain table, for a pipe or a script
slash-port --json       # the same data as JSON
slash-port --udp        # include UDP as well as TCP
```

To kill something from a script, name it and confirm it:

```sh
slash-port --kill --port 3000 --yes
```

There is no flag combination that kills something without naming it first.

### Keys

| Key | Does |
| --- | --- |
| `↑` `↓` or `j` `k` | Move |
| `PgUp` `PgDn` | Page |
| `g` `G` | First, last |
| `/` | Filter; `Enter` keeps it, `Esc` clears it |
| `x` or `Enter` | Kill the selected port |
| `r` | Rescan |
| `u` | Show UDP as well as TCP |
| `q` | Quit |

In the confirmation dialog: `y` sends SIGTERM, `f` forces with SIGKILL, `n`
cancels. The kill key is deliberately not next to a navigation key.

### Options

| Option | Does |
| --- | --- |
| `-p`, `--port <number>` | Only this port |
| `-u`, `--udp` | Include UDP sockets |
| `--json` | Print JSON and exit |
| `--plain` | Print a plain table and exit |
| `--kill` | Kill the process on `--port`. Requires `--yes` |
| `--force` | Escalate to SIGKILL instead of SIGTERM |
| `-y`, `--yes` | Confirm a kill made from the command line |
| `--grace <ms>` | Wait this long for a graceful exit (default 3000) |
| `--no-color` | Disable colour. `NO_COLOR` is honoured too |
| `-h`, `--help` | Show help |
| `-v`, `--version` | Show the version |

### Exit codes

| Code | Means |
| --- | --- |
| `0` | Success |
| `1` | The requested action could not be completed |
| `2` | Invalid usage |

Asking about one port is a question with a yes-or-no answer, so
`slash-port --port 3000 --plain` exits `1` when nothing is listening there.
Listing every port exits `0` even when the list is empty.

## Safety

Killing the wrong process at a terminal is easy and unrecoverable, so the rules
are fixed rather than configurable:

- **Nothing is killed without a confirmation that names it.** Not in the
  interactive list, and not with flags.
- **Some processes are refused outright**, before any dialog is offered: the
  init process, `sshd` — killing it locks you out of a remote machine — macOS
  and Windows session processes, `slash-port` itself, and the shell that
  launched it.
- **SIGTERM before SIGKILL.** A process that ignores SIGTERM is reported as
  having survived. Escalating is a second, deliberate action, never automatic.
- **A process that has already exited is never signalled**, because by then its
  pid may belong to something else.

On Windows there is no signal delivery: SIGTERM becomes `TerminateProcess`,
which a process cannot catch or ignore, so nothing there gets the chance to
shut down cleanly. The confirmation still applies — but "terminate" and "force"
do the same thing.

## Privacy

`slash-port` makes no network connections at any point. It reads the local
socket table and the local process table, and that is all it does. There is no
telemetry, no update check, and no configuration file.

## Terminal behaviour

- Only the sixteen named terminal colours, so the display inherits your theme
  rather than fighting it.
- Colour never carries meaning on its own — a protected row is labelled
  `[protected]` as well as coloured.
- `NO_COLOR` and `--no-color` are honoured.
- Redirected or piped output is plain text with no control codes, and the
  interactive interface never starts unless both streams are a terminal.
- The list is windowed to the visible rows, so a machine with four hundred
  listening sockets renders a screenful, not four hundred lines.
- Columns are dropped in order of how little they carry as the window narrows,
  and values that are cut are marked with an ellipsis.

## How it identifies a process

Three sources, in priority order:

1. **The command line.** Specific frameworks are matched before the runtimes
   that host them, so `node …/vite` reports Vite rather than Node.js.
2. **The project.** The directory above `node_modules` in the command line, so
   two Vite servers on 5173 and 5174 can be told apart.
3. **A well-known port registry**, used only when the process itself could not
   be identified — mostly other users' processes. Entries that would add
   nothing are suppressed: "dev server" on port 3000 is not information.

Per platform:

- **Linux** reads `/proc/net/tcp` and maps socket inodes through
  `/proc/[pid]/fd`. No `lsof`, which many container images do not have, and no
  subprocess. Descriptors belonging to other users are not readable without
  privileges, so those rows show no owner rather than failing the scan — run
  with `sudo` to resolve them.
- **macOS** uses `lsof` in field-output mode, plus `ps` for full command lines.
- **Windows** uses `netstat -ano` and `tasklist`, which exist on every edition
  and avoid PowerShell's startup cost.

## Not built yet

Deliberate omissions, listed so you know they are choices rather than
oversights:

- **Docker awareness.** A published port shows `docker-proxy` rather than the
  container behind it. Resolving that means talking to the Docker socket, which
  is a real dependency and belongs behind a flag.
- **Process trees.** Killing a dev server sometimes leaves children behind. A
  `--tree` option would signal the whole group.
- **Watch mode.** The list rescans on `r`, not on a timer.
- **Port history.** "What was on 3000 an hour ago" needs persistent state, and
  this tool currently has none — which is worth keeping.

## Versioning and releases

Versions follow [Semantic Versioning](https://semver.org) and are chosen by the
pipeline rather than by hand: every commit on `main` is a
[Conventional Commit](https://www.conventionalcommits.org), and the release
workflow reads the types since the last tag to decide between a major, a minor,
and a patch. Every release is published with npm
[provenance](https://docs.npmjs.com/generating-provenance-statements), so the
tarball can be traced to the exact commit and workflow that built it.

See the [changelog](CHANGELOG.md) for what changed when.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). The one step that is a requirement
rather than a suggestion is enabling the repository's git hooks:

```sh
git config core.hooksPath .githooks
```

## Licence

MIT © Amin Shariati
