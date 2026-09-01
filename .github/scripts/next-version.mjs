#!/usr/bin/env node
/**
 * Decide the next version from the Conventional Commits since the last tag.
 *
 * This is the only thing that chooses a version number, which is why the
 * commit-msg hook is strict: a commit whose type cannot be read is a release
 * that silently does not happen, or happens at the wrong level.
 *
 *   BREAKING CHANGE, or a `!` after the type  major
 *   feat                                      minor
 *   fix, perf, revert                         patch
 *   anything else                             no release
 *
 * Before 1.0.0 a breaking change is a minor rather than a major, which is the
 * usual reading of semver's "anything may change at any time" for 0.x. That
 * stops the moment the major reaches 1.
 *
 * Usage:
 *   node .github/scripts/next-version.mjs [--level=major|minor|patch]
 *
 * Prints a JSON plan on stdout, writes the release notes to release-notes.md,
 * and appends `version`, `level`, and `should-release` to GITHUB_OUTPUT when
 * running in Actions.
 */
import { execFileSync } from 'node:child_process';
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';

// ASCII record and unit separators: git emits them with %x1e and %x1f, and
// no commit message contains them, so the log parses unambiguously.
const RECORD = '\u001E';
const FIELD = '\u001F';

const TYPE_PATTERN =
  /^(?<type>build|chore|ci|docs|feat|fix|perf|refactor|revert|style|test)(?:\((?<scope>[^)]*)\))?(?<breaking>!)?: (?<description>.+)$/;

/** Sections of the changelog, in the order they are written. */
const SECTIONS = [
  { key: 'breaking', title: 'Breaking changes' },
  { key: 'feat', title: 'Features' },
  { key: 'fix', title: 'Bug fixes' },
  { key: 'perf', title: 'Performance' },
  { key: 'revert', title: 'Reverts' },
];

const git = (args, { quiet = false } = {}) =>
  execFileSync('git', args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', quiet ? 'ignore' : 'inherit'],
  }).trim();

function lastTag() {
  try {
    // Quiet, because "no names found" on a repository with no tags yet is the
    // expected answer for a first release, not a failure worth printing.
    return git(['describe', '--tags', '--match', 'v[0-9]*', '--abbrev=0'], { quiet: true });
  } catch {
    return null;
  }
}

function commitsSince(tag) {
  const range = tag ? `${tag}..HEAD` : 'HEAD';
  const log = git(['log', range, '--format=%H%x1f%B%x1e']);
  if (!log) return [];

  return log
    .split(RECORD)
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const [sha, ...rest] = entry.split(FIELD);
      const message = rest.join(FIELD).trim();
      const [header = '', ...bodyLines] = message.split('\n');
      return { sha, header, body: bodyLines.join('\n') };
    });
}

function classify(commit) {
  const match = TYPE_PATTERN.exec(commit.header);
  if (!match?.groups) return null;

  const { type, scope, breaking, description } = match.groups;
  // A footer counts as well as the `!`, because that is what the specification
  // says and what people actually write in a body.
  const declared = Boolean(breaking) || /^BREAKING[ -]CHANGE:/m.test(commit.body);

  return { type, scope: scope || null, breaking: declared, description, sha: commit.sha };
}

function bump(version, level) {
  const [major, minor, patch] = version.split('.').map(Number);
  if (level === 'major') return `${major + 1}.0.0`;
  if (level === 'minor') return `${major}.${minor + 1}.0`;
  return `${major}.${minor}.${patch + 1}`;
}

function notesFor(changes, { version, previous, repository }) {
  const link = (sha) =>
    repository ? ` ([${sha.slice(0, 7)}](https://github.com/${repository}/commit/${sha}))` : '';

  const line = (change) =>
    `- ${change.scope ? `**${change.scope}:** ` : ''}${change.description}${link(change.sha)}`;

  const grouped = {
    breaking: changes.filter((change) => change.breaking),
    feat: changes.filter((change) => change.type === 'feat' && !change.breaking),
    fix: changes.filter((change) => change.type === 'fix' && !change.breaking),
    perf: changes.filter((change) => change.type === 'perf' && !change.breaking),
    revert: changes.filter((change) => change.type === 'revert' && !change.breaking),
  };

  const body = SECTIONS.filter((section) => grouped[section.key].length > 0)
    .map((section) => `### ${section.title}\n\n${grouped[section.key].map(line).join('\n')}`)
    .join('\n\n');

  const compare =
    repository && previous
      ? `\n\n[Compare with ${previous}](https://github.com/${repository}/compare/${previous}...v${version})`
      : '';

  return `${body || '_No user-facing changes._'}${compare}`;
}

const forced = process.argv
  .find((argument) => argument.startsWith('--level='))
  ?.slice('--level='.length);

if (forced && !['major', 'minor', 'patch'].includes(forced)) {
  console.error(`--level must be major, minor, or patch; got ${forced}.`);
  process.exit(2);
}

const manifest = JSON.parse(readFileSync('package.json', 'utf8'));
const current = manifest.version;
const repository =
  process.env.GITHUB_REPOSITORY ??
  /github\.com[/:]([^/]+\/[^/.]+)/.exec(manifest.repository?.url ?? '')?.[1] ??
  null;

const previous = lastTag();
const commits = commitsSince(previous);
const changes = commits.map(classify).filter(Boolean);
const unconventional = commits.length - changes.length;

let level = null;
if (changes.some((change) => change.breaking)) level = 'major';
else if (changes.some((change) => change.type === 'feat')) level = 'minor';
else if (changes.some((change) => ['fix', 'perf', 'revert'].includes(change.type))) level = 'patch';

// Pre-1.0, a breaking change is a minor. There is no compatibility promise to
// break yet, and burning 1.0.0 on the first rename helps nobody.
if (level === 'major' && current.startsWith('0.')) level = 'minor';

if (forced) level = forced;

const plan = {
  current,
  previous,
  level,
  version: level ? bump(current, level) : current,
  shouldRelease: Boolean(level),
  commits: commits.length,
  releasable: changes.length,
  unconventional,
};

const notes = plan.shouldRelease
  ? notesFor(changes, { version: plan.version, previous, repository })
  : '';

writeFileSync('release-notes.md', notes ? `${notes}\n` : '');

if (process.env.GITHUB_OUTPUT) {
  appendFileSync(
    process.env.GITHUB_OUTPUT,
    [
      `version=${plan.version}`,
      `previous=${previous ?? ''}`,
      `level=${plan.level ?? 'none'}`,
      `should-release=${plan.shouldRelease}`,
      '',
    ].join('\n'),
  );
}

console.log(JSON.stringify(plan, null, 2));

if (unconventional > 0) {
  console.error(
    `\nNote: ${unconventional} of ${commits.length} commits since ${previous ?? 'the beginning'} ` +
      'are not Conventional Commits and were ignored when choosing the level.',
  );
}
