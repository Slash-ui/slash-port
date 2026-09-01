# Contributing to slash-port

Thanks for taking the time. This is a small tool with a narrow purpose, so the
bar for a change is that it makes the tool better at reading the socket table,
explaining what it found, or killing something safely.

## Setup

```sh
git clone https://github.com/Slash-ui/slash-port.git
cd slash-port
npm install
git config core.hooksPath .githooks   # required, see below
```

### Enabling the hooks is a requirement, not a suggestion

Git does not share hooks through a clone; `core.hooksPath` is what activates the
ones committed in `.githooks/`. Without that line you are committing with no
local secret scanning at all.

- `pre-commit` refuses credential filenames, local tooling configuration, and
  secret-shaped strings in the staged diff, then runs `gitleaks` when it is
  installed.
- `commit-msg` enforces [Conventional Commits](https://www.conventionalcommits.org),
  which the release pipeline reads to choose version numbers, and refuses
  tooling metadata in commit messages.

CI scans the whole history regardless, so a secret pushed without the hooks is
caught — but it is caught *after* it is public, which is far worse. See
[SECURITY.md](SECURITY.md) for what to do then.

## Working on it

```sh
npm test          # the test suite
npm run test:watch
npm run typecheck
npm run build     # compile to dist/
node dist/cli.js  # run what you built
```

The layout:

```
src/
  cli.tsx        argument parsing, TTY detection, exit codes
  scan/
    index.ts     platform dispatch, socket collapsing, sorting
    linux.ts     /proc/net parsing, inode to pid mapping
    darwin.ts    lsof field-output parsing
    win32.ts     netstat and tasklist parsing
    shared.ts    address formatting, subprocess helper
  describe.ts    port registry, command signatures, protection rules
  format.ts      plain-text and JSON output
  ports.ts       port selectors: one port, a 3xxx pattern, a 3000:3005 range
  kill.ts        signal escalation, guardrails, outcome types
  ui/
    App.tsx      list, filter, confirmation dialog
    theme.ts     colour roles, truncation, column widths
```

Parsing is deliberately separated from the I/O that feeds it —
`parseProcNet`, `parseLsof`, `parseNetstat`, and `parseTasklist` are all pure
functions over a string. That is what makes them testable against captured
fixtures rather than against whatever the host machine happens to be running,
which is not reproducible.

## Things to know before changing something

**The safety rules are not configurable.** Nothing is killed without a
confirmation naming it; the protected list is refused before any dialog; SIGTERM
comes before SIGKILL and escalation is always a separate action. A change that
adds a way round any of those will not be merged, however convenient it is.

**Colour must never be the only signal.** A protected row is labelled
`[protected]` as well as coloured, because a red-green colour blind user and a
`NO_COLOR` user both have to be able to read the list.

**Output that is not a terminal is plain text.** No control codes ever reach a
pipe or a redirect.

**No network access.** The tool reads local state and nothing else. A change
that adds a fetch — an update check, telemetry, an IP lookup — changes what the
tool is.

**Adding a description signature.** Put it in `SIGNATURES` in `src/describe.ts`,
above the runtime it would otherwise be attributed to. Order in that array is
the priority. Keep patterns narrow: a bare `\bserve\b` matches half the daemons
on a machine.

## Tests

Every change to parsing, describing, or killing needs a test.

- `test/scan.test.ts` — parsers against captured fixtures, address decoding,
  socket collapsing, description heuristics, protection rules.
- `test/kill.test.ts` — the guardrails, and real SIGTERM and SIGKILL escalation
  against spawned child processes.
- `test/ui.test.tsx` — rendering, empty states, truncation, column widths at 60
  and 200 columns, resize, and the confirmation dialog.
- `test/ports.test.ts` — port selectors, and what the filter box makes of them.

CI runs all of it on Linux, macOS, and Windows, and additionally smoke tests the
built binary on each, because the macOS and Windows scanners shell out to tools
that unit tests cannot exercise.

## Commits

Commit messages follow [Conventional Commits](https://www.conventionalcommits.org),
and this is not a style preference: the release pipeline reads the type of every
commit since the last tag to decide whether the next version is a major, a
minor, or a patch. A malformed subject is a version number nobody chose.

```
<type>[optional scope][!]: <description>

[optional body]

[optional footers]
```

| Type | Use | Effect on the version |
| --- | --- | --- |
| `feat` | A new capability | minor |
| `fix` | A bug fix | patch |
| `perf` | Faster or lighter, same behaviour | patch |
| `revert` | Undoes an earlier commit | patch |
| `docs` `test` `refactor` `style` `build` `ci` `chore` | Everything else | none |

A `!` after the type, or a `BREAKING CHANGE:` footer, is a major — except
before 1.0.0, where it is a minor, because there is no compatibility promise to
break yet.

```
feat(scan): read UDP sockets on Windows
fix(kill): report EPERM as denied rather than gone
perf(scan): map inodes concurrently
feat(cli)!: rename --plain to --table
```

Scopes are the part of the tool the change touches: `scan`, `describe`, `kill`,
`ui`, `cli`, `format`, or a platform — `scan/linux`. They are optional.

The `commit-msg` hook enforces all of this, and CI runs that same file against
every commit in a pull request and against the pull request title. There is one
implementation, so the two cannot drift.

Beyond the format: write the message for someone reading `git log` in a year.
No tooling metadata — no generated-with lines, and no co-author trailers naming
an editor or an assistant. To be explicit about where that line sits: removing
a trailer that advertises a tool is a formatting preference and is fine; adding
a trailer that credits a person who did not write the change is falsifying
authorship and is not.

## Pull requests

`main` is protected. Every change arrives by pull request, CI has to be green,
and the maintainer's review is the only one that can approve it — `CODEOWNERS`
covers every file.

Pull requests are squash-merged, and the title becomes the commit subject on
`main`, so **the title must be a Conventional Commit too**. CI checks it.

Before opening one:

```sh
npm run typecheck && npm test && npm run build
```

## Releasing

Nobody types a version number. `package.json` sits at `0.0.0` between
releases precisely so that it cannot be edited by hand and quietly disagree
with what was published — the pipeline works the version out, and the
maintainer approves it twice.

1. **A push to `main`** runs `.github/scripts/next-version.mjs`, which reads the
   Conventional Commits since the last tag and decides the level. If a release
   is warranted, it opens a `chore(release): vX.Y.Z` pull request that bumps
   `package.json` and writes the changelog entry. Nothing is published.
2. **Merging that pull request** is the first approval. It leaves `main` with a
   version that has a changelog entry and no tag.
3. **That state triggers the publish job**, which waits in the `npm-publish`
   environment for the maintainer's review — the second approval. Only then is
   the npm token readable. It re-runs the whole suite on that exact commit,
   checks the tarball contents, tags, publishes with provenance, and creates
   the GitHub release from the changelog entry.

To force a level — a documentation-only release, say — run the Release workflow
by hand with the `level` input.

You can see what the next release would be, without doing anything:

```sh
node .github/scripts/next-version.mjs
```

The branch protection, the environment reviewer, and the Pages source are all
GitHub settings rather than files. `.github/scripts/setup-repo.sh` applies them,
and is safe to re-run. It also explains the two secrets it cannot set for you:
`NPM_TOKEN`, scoped to the `npm-publish` environment, and the optional
`RELEASE_TOKEN` — GitHub does not start workflows for events raised by the
default token, so without it the release pull request gets no CI run of its own
and has to be merged past its pending checks.
