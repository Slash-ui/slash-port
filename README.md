# slash-port

<!-- release:badge -->
[![github](https://img.shields.io/badge/github-v0.3.0-0f8b7d?logo=github&logoColor=white)](https://github.com/Slash-ui/slash-port/releases/tag/v0.3.0)<!-- /release:badge -->
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
slash-port                                                    8/8 tcp · beginner
PORT        WHAT IT IS                       OPEN AT                 CLOSE IT?
22/tcp      OpenSSH server [protected]       -                       No
3000/tcp    Next.js (shop)                   http://localhost:3000   Yes
5173/tcp    Vite dev server (admin)          http://localhost:5173   Yes
5432/tcp    Docker Desktop                   -                       Probably
6379/tcp    Redis                            -                       Probably
8025/tcp    Docker Desktop                   http://localhost:8025   Probably
49470/tcp   Visual Studio Code (Node.js)     -                       Probably
51061/tcp   macOS Handoff                    -                       Better not
╭──────────────────────────────────────────────────────────────────────────────╮
│ Port 3000 · Next.js (shop) - a web server                                    │
│ Point a browser at it - that is what it is there for.                        │
│ Project    shop                                                              │
│ Open       http://localhost:3000                                             │
│ Started by you (slashui) · node · pid 41822                                  │
│ Close it   Yes - yours, and as easy to start again as it was to start        │
│ Afterwards Start it again with your dev command, usually `npm run dev`.      │
╰──────────────────────────────────────────────────────────────────────────────╯
↑↓ move · / find · x close it · r refresh · u udp · d details · m advanced · q …
```

Every row says something the process name does not. The process behind
`Visual Studio Code` is called `Code Helper`, and the one behind `macOS
Handoff` is called `rapportd`. Neither name would have told you anything, which
is the point: when nothing at all can be worked out, the column says `-` rather
than repeating the process name back at you.

Press `m` for advanced mode, which trades the explanations for the facts that
tell two identical-looking dev servers apart:

```
slash-port                                                                        8/8 tcp · advanced
PORT        PID     USER       PROCESS            ADDRESS           DESCRIPTION
22/tcp      947     root       sshd               *                 OpenSSH server [protected]
3000/tcp    41822   slashui    node               *                 Next.js (shop)
5173/tcp    41905   slashui    node               *                 Vite dev server (admin)
5432/tcp    39044   slashui    com.docker.backend *                 Docker Desktop
6379/tcp    788     slashui    redis-server       127.0.0.1         Redis
8025/tcp    39044   slashui    com.docker.backend *                 Docker Desktop
49470/tcp   1737    slashui    Code Helper        127.0.0.1         Visual Studio Code (Node.js)
51061/tcp   694     slashui    rapportd           *                 macOS Handoff
╭──────────────────────────────────────────────────────────────────────────────────────────────────╮
│ Process   node · pid 41822 · parent 1204 zsh                                                     │
│ User      slashui                                                                                │
│ Listening * · TCP · IPv4                                                                         │
│ Clients   3 connections open                                                                     │
│ Running   2h 11m (since 14:02)                                                                   │
│ Memory    431 MB · 0.4% CPU                                                                      │
│ Directory /Users/slashui/code/shop                                                               │
│ Command   node /Users/slashui/code/shop/node_modules/.bin/next dev                               │
│ Kill      Yes - yours, and as easy to start again as it was to start. Start it again with your … │
╰──────────────────────────────────────────────────────────────────────────────────────────────────╯
↑↓/jk move · PgUp/PgDn/g/G jump · / filter · x kill · r rescan · u udp · d detail · m beginner · q …
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

### Updating

The current release is <!-- release:version -->0.3.0<!-- /release:version -->. To
see what you have, and what is published:

```sh
slash-port --version        # the one you are running
npm view slash-port version # the one on npm
```

To move to the latest:

```sh
npm install -g slash-port@latest
```

`npm install -g …@latest` rather than `npm update -g slash-port`, because
`update` will not cross a major version - and before 1.0.0 it will not cross a
minor one either, which is every release this tool has had so far. Naming
`@latest` always gets you the newest published version.

`npx` caches the version it first downloaded, so ask it for the latest
explicitly:

```sh
npx slash-port@latest
```

There is no automatic update check. `slash-port` makes no network connections
at all, which means it will never tell you a new version exists - you find out
here, or from npm. Upgrading is safe: there is no state, no configuration file,
and nothing to migrate. To go the other way, name the version you want -
`npm install -g slash-port@0.1.0` - and to remove it entirely:

```sh
npm uninstall -g slash-port
```

Breaking changes are listed under **Breaking changes** in the
[changelog](CHANGELOG.md), so a major - or, before 1.0.0, a minor - is worth
reading before you take it.

## Use

```sh
slash-port              # the interactive list, in beginner mode
slash-port --advanced   # the same list, with the full detail
slash-port 3000         # open on port 3000
slash-port 3xxx         # every port from 3000 to 3999
slash-port 3000:3005    # every port in that range
slash-port --plain      # a plain table, for a pipe or a script
slash-port --json       # the same data as JSON
slash-port --udp        # include UDP as well as TCP
slash-port --docker     # name the container behind a published port
```

### Beginner and advanced

There are two modes, and **beginner is the default**. The person who does not
know what took port 3000 is the person who went looking for a tool that would
tell them; anyone who already knows can say `--advanced` once, or set
`SLASH_PORT_MODE=advanced` and never say it again. `m` switches between them
at any time, and `d` hides the panel in either.

| | Beginner | Advanced |
| --- | --- | --- |
| Columns | Port, what it is, where to open it, whether to close it | Port, pid, user, process, address, description |
| Narrow terminals | Keeps the verdict down to forty-two columns; the URL column stands down first, and stands down entirely when no row has one | Drops address, user, process, pid, in that order |
| Panel | What kind of thing it is, which project, who started it, whether closing it is a good idea, and how to start it again | Parent process, open connections, uptime, memory, working directory, full command line, and how the description was arrived at |
| Confirmation | Says what closing it costs and how to undo it | Names the signal |
| Cost | One scan | One scan, plus a lookup for the row under the cursor |

Advanced mode's extra facts are fetched for the selected row only. A machine
with four hundred listening sockets would otherwise pay four hundred times over
for facts you are reading one row at a time.

### Docker

A published container port shows as `Docker Desktop`, which is true and no help
at all - and the beginner panel says so rather than leaving you to wonder where
the name went:

```
╭──────────────────────────────────────────────────────────────────────────────╮
│ Port 5432 · Docker Desktop - a container port                                │
│ Publishing a port on behalf of a container.                                  │
│ Container  not looked up - re-run with --docker to name it                   │
│ Started by you (slashui) · com.docker.backend · pid 39044                    │
│ Close it   Probably - yours, but something may be relying on it              │
│ Afterwards Stopping the container that owns the port is the change you prob… │
╰──────────────────────────────────────────────────────────────────────────────╯
```

`--docker` asks the local engine which container is behind the port. The image
is read the same way a command line is, so `postgres:16` reports PostgreSQL and
is treated with the care a database deserves, and the compose project becomes
the hint - which is how two Supabase stacks on 5432 and 54322 stop being
interchangeable:

```
╭──────────────────────────────────────────────────────────────────────────────╮
│ Port 5432 · PostgreSQL in Docker (shop) - a database                         │
│ The container shop-db, from the shop compose project, running postgres:16-a… │
│ Container  shop                                                              │
│ Started by you (slashui) · com.docker.backend · pid 39044                    │
│ Close it   Probably - stop the container instead: `docker stop shop-db`      │
│ Afterwards Bring it back with `docker compose up -d db`.                     │
╰──────────────────────────────────────────────────────────────────────────────╯
```

It stays off until you ask for it. Reading two local tables and stopping is the
property this tool is built around, and a nicer default is not worth trading it
for. `SLASH_PORT_DOCKER=1` turns it on for good if you would rather not type
it, and `--no-docker` overrules that for one run.

### Naming ports

`--port` and the interactive filter take the same three forms:

| Form | Means |
| --- | --- |
| `3000` | One port |
| `3xxx` | Every port from 3000 to 3999. `x` is any digit, in any position: `8x80` is 8080, 8180, and so on to 8980 |
| `3000:3005` | Every port from 3000 to 3005, both ends included |

A pattern is read as digits, not as a number, so `3xxx` is the four-digit ports
beginning with 3 and does not include 300. Ports above 65535 do not exist, so a
pattern that can only match them - `7xxxx` - is a usage error rather than an
empty list.

To kill something from a script, name it and confirm it:

```sh
slash-port --kill --port 3000 --yes
```

A pattern or a range can match several ports, and the same command matches more
of them tomorrow than it does today, so killing with one takes `--all` as well:

```sh
slash-port --kill --port 3000:3005 --yes --all
```

There is no flag combination that kills something without naming it first.

### Keys

| Key | Does |
| --- | --- |
| `↑` `↓` or `j` `k` | Move |
| `PgUp` `PgDn` | Page |
| `g` `G` | First, last |
| `/` | Filter on anything in the row, or on ports with `3xxx` and `3000:3005`; `Enter` keeps it, `Esc` clears it |
| `x` or `Enter` | Kill the selected port |
| `r` | Rescan |
| `u` | Show UDP as well as TCP |
| `m` | Switch between beginner and advanced |
| `d` | Show or hide the detail panel |
| `q` | Quit |

In the confirmation dialog: `y` sends SIGTERM, `f` forces with SIGKILL, `n`
cancels. The kill key is deliberately not next to a navigation key.

### Options

| Option | Does |
| --- | --- |
| `-p`, `--port <ports>` | Only these ports: `3000`, `3xxx`, or `3000:3005` |
| `--beginner` | Explain each port in plain language. The default |
| `--advanced` | Show the full detail instead of the explanations |
| `--mode <name>` | `beginner` or `advanced`. `SLASH_PORT_MODE` sets the default |
| `-u`, `--udp` | Include UDP sockets |
| `--docker` | Ask the local Docker socket which container holds a port. Off by default; `SLASH_PORT_DOCKER=1` sets the default |
| `--json` | Print JSON and exit |
| `--plain` | Print a plain table and exit |
| `--kill` | Kill the process on `--port`. Requires `--yes` |
| `--force` | Escalate to SIGKILL instead of SIGTERM |
| `-y`, `--yes` | Confirm a kill made from the command line |
| `--all` | Kill every port a pattern or a range matches. Requires `--kill` |
| `--grace <ms>` | Wait this long for a graceful exit (default 3000) |
| `--no-color` | Disable colour. `NO_COLOR` is honoured too |
| `-h`, `--help` | Show help |
| `-v`, `--version` | Show the version |

### Output for scripts

`--json` is the stable machine surface. Fields are added over time and never
repurposed, so a `jq` expression written against an old version keeps working.
`description` is `null` rather than a copy of `process` when nothing could be
identified, which is the one thing worth knowing before parsing it: absence is
reported as absence.

`--plain` keeps the same six columns in both modes and always will, so anything
already splitting that output keeps working. A mode only ever appends a column
on the end - what closing it would mean in beginner mode, the full command line
in advanced.

### Exit codes

The same codes across every `slash-*` tool, so a script that wraps one can wrap
any of them:

| Code | Means |
| --- | --- |
| `0` | Success |
| `1` | Invalid arguments or usage |
| `2` | Nothing is listening on the ports asked about |
| `3` | Refused: a confirmation was missing, or a guardrail tripped |
| `4` | The operation was attempted and failed |

Asking about a port is a question with a yes-or-no answer, so
`slash-port --port 3000 --plain` exits `2` when nothing is listening there, and
so does `--port 3xxx` when nothing matches. Listing every port exits `0` even
when the list is empty.

The distinction between `1` and `3` is whether the command made sense:
`--kill` with no `--port` did not name a target and exits `1`, while `--kill`
with a target but no `--yes` named one and did not confirm it, and exits `3`.
The standard reserves `5` for an integrity failure, which this tool has nothing
to verify and never returns.

## Safety

Killing the wrong process at a terminal is easy and unrecoverable, so the rules
are fixed rather than configurable:

- **Nothing is killed without a confirmation that names it.** Not in the
  interactive list, and not with flags.
- **A pattern or a range never kills on its own.** `--kill --port 3xxx --yes`
  is refused without `--all`, because what a pattern matches depends on what
  happens to be running when the command is run.
- **A signal that will bounce is flagged before you decide, not after.** A row
  owned by somebody else is marked `[locked]`, and the confirmation says what
  it would take to signal it - rather than letting you confirm a kill that was
  never going to land.
- **Some processes are refused outright**, before any dialog is offered: the
  init process, `sshd` - killing it locks you out of a remote machine - macOS
  and Windows session processes, `slash-port` itself, and the shell that
  launched it.
- **Whether closing it is a good idea is settled before you decide.** Every row
  carries a verdict - `Yes`, `Probably`, `Better not`, `No`, `Needs sudo` -
  worked out from what it is, who owns it, and whether a guardrail already
  refuses it. The verdict is a word in a column, never a colour alone.
- **The confirmation is never the thing that gets truncated.** On a terminal
  too short to show it and the list behind it, the list gives way; a question
  you cannot read is a question you cannot answer.
- **SIGTERM before SIGKILL.** A process that ignores SIGTERM is reported as
  having survived. Escalating is a second, deliberate action, never automatic.
- **A process that has already exited is never signalled**, because by then its
  pid may belong to something else.

On Windows there is no signal delivery: SIGTERM becomes `TerminateProcess`,
which a process cannot catch or ignore, so nothing there gets the chance to
shut down cleanly. The confirmation still applies - but "terminate" and "force"
do the same thing.

## Privacy

`slash-port` makes no network connections at any point. By default it reads
the local socket table and the local process table, and asks nothing else on
the machine anything either. There is no telemetry, no update check, and no
configuration file.

`--docker` is the single exception, and it is off until you ask for it. It
reads the local Docker socket - a file on this machine, the same as
`/proc/net/tcp` is - to name the container behind a published port. A
`DOCKER_HOST` pointing at another machine over TCP is ignored rather than
connected to. `SLASH_PORT_DOCKER=1` turns it on for good if you would rather
not type it; `--no-docker` still overrules that for one run.

## Terminal behaviour

- Only the sixteen named terminal colours, so the display inherits your theme
  rather than fighting it.
- Colour never carries meaning on its own - a protected row is labelled
  `[protected]` and one you cannot signal is labelled `[locked]`, as well as
  being coloured.
- `NO_COLOR` and `--no-color` are honoured.
- Redirected or piped output is plain text with no control codes, and the
  interactive interface never starts unless both streams are a terminal.
- The list is windowed to the visible rows, so a machine with four hundred
  listening sockets renders a screenful, not four hundred lines.
- Columns are dropped in order of how little they carry as the window narrows,
  and values that are cut are marked with an ellipsis. Beginner mode keeps all
  four of its columns down to eighty, because the fourth is the answer.
- A column that has nothing to show stands down rather than printing a column
  of dashes: `OPEN AT` appears when the rows on screen have URLs.

## How it identifies a process

The description column exists to say something the process column did not. So
the first rule is that it never repeats the process name: when nothing could be
worked out, it says `-`, because "slash-port has no idea" is a fact and
`figma_agent` beside `figma_agent` is a column doing nothing.

What it consults, in priority order:

1. **The command line.** Specific frameworks are matched before the runtimes
   that host them, so `node …/vite` reports Vite rather than Node.js.
2. **The container**, if you passed `--docker`. The local engine is asked which
   container publishes the port, and the image is then read like a command
   line, so `postgres:16` reports "PostgreSQL in Docker" and is treated with
   the care a database deserves. The compose project - or the container name
   when there is no project - becomes the hint, which is how `5432` and `54322`
   stop being interchangeable. Without the flag a published port reports
   `Docker Desktop`, and beginner mode says so rather than leaving you to
   wonder why the name is missing.
3. **The application.** The bundle or install directory the binary sits in,
   so `Code Helper` reports Visual Studio Code and `figma_agent` reports Figma.
   The outermost bundle wins, and a vendor directory beats the bundle inside it.
4. **The project.** The directory above `node_modules` in the command line, so
   two Vite servers on 5173 and 5174 can be told apart. A directory that only
   names a convention - `lib`, `src`, `bin` - is passed over for the script
   itself, which is why `…/google-cloud-sdk/lib/gcloud.py` reads as `gcloud`.
5. **A well-known port registry**, for processes that could not be identified
   at all - mostly other users'. Generic entries are demoted rather than
   suppressed: "dev server" loses to anything specific, and beats saying
   nothing.
6. **The shape of the path.** A binary under `/usr/libexec` is a system service
   whoever wrote it, which is worth more than its own name repeated back.

Beginner mode adds one more question on top of all that: whether closing it is
a good idea. That answer folds together what kind of thing it is, whether you
own it, and whether a guardrail already refuses it - and the last two win,
because they are facts about this machine rather than guesses about software. A
Postgres you do not own is `Needs sudo` whatever anyone thinks of closing
databases.

Per platform:

- **Linux** reads `/proc/net/tcp` and maps socket inodes through
  `/proc/[pid]/fd`. No `lsof`, which many container images do not have, and no
  subprocess. Descriptors belonging to other users are not readable without
  privileges, so those rows show no owner rather than failing the scan - run
  with `sudo` to resolve them.
- **macOS** uses `lsof` in field-output mode, plus `ps` for full command lines.
- **Windows** uses `netstat -ano` and `tasklist`, which exist on every edition
  and avoid PowerShell's startup cost.

Advanced mode's per-row lookups follow the same rule of asking the cheapest
thing that can answer: `/proc` on Linux with no subprocess at all, `ps` and
`lsof` on macOS, and on Windows only what `tasklist` and `netstat` already
know. Parents, working directories, and start times need WMI or PowerShell
there, which cost about a second each, so those lines are left out rather than
paid for. A platform that cannot answer omits the line; it never guesses.

## Not built yet

Deliberate omissions, listed so you know they are choices rather than
oversights:

- **Docker awareness by default.** `--docker` names the container behind a
  published port, and it stays opt-in. Reading two local tables and stopping is
  the property this tool is built around, and it is not worth trading for a
  nicer default.
- **Process trees.** Killing a dev server sometimes leaves children behind. A
  `--tree` option would signal the whole group.
- **Watch mode.** The list rescans on `r`, not on a timer.
- **Port history.** "What was on 3000 an hour ago" needs persistent state, and
  this tool currently has none - which is worth keeping.

## Versioning and releases

Versions follow [Semantic Versioning](https://semver.org) and are chosen by the
pipeline rather than by hand: every commit on `main` is a
[Conventional Commit](https://www.conventionalcommits.org), and the release
workflow reads the types since the last tag to decide between a major, a minor,
and a patch. Every release is published with npm
[provenance](https://docs.npmjs.com/generating-provenance-statements), so the
tarball can be traced to the exact commit and workflow that built it.

One commit does the whole bump: `package.json`, the changelog entry, and the
version badge at the top of this file are written together, so the three cannot
name different versions. The badges either side of it are read live - npm and
the download count from the registry, CI and Release from the Actions API - so
the `github` badge and the `npm` badge agreeing means the publish landed, and
them disagreeing means it did not.

See the [changelog](CHANGELOG.md) for what changed when.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). The one step that is a requirement
rather than a suggestion is enabling the repository's git hooks:

```sh
git config core.hooksPath .githooks
```

## Licence

MIT © Amin Shariati
