#!/usr/bin/env node
/**
 * Prepend a release to CHANGELOG.md.
 *
 * Takes the notes that `next-version.mjs` wrote, so the changelog and the
 * GitHub release say the same thing - they are the same text, not two
 * descriptions of the same release that drift apart.
 *
 * Usage:
 *   node .github/scripts/update-changelog.mjs <version> [notes-file]
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

const [version, notesFile = 'release-notes.md'] = process.argv.slice(2);

if (!version || !/^\d+\.\d+\.\d+/.test(version)) {
  console.error('Usage: update-changelog.mjs <version> [notes-file]');
  process.exit(2);
}

const HEADER = `# Changelog

Every release is listed here. Entries are generated from the
[Conventional Commit](https://www.conventionalcommits.org) messages in each
release, and versions follow [Semantic Versioning](https://semver.org).
`;

const notes = existsSync(notesFile) ? readFileSync(notesFile, 'utf8').trim() : '';
if (!notes) {
  console.error(`${notesFile} is empty; there is nothing to record.`);
  process.exit(1);
}

const manifest = JSON.parse(readFileSync('package.json', 'utf8'));
const repository = /github\.com[/:]([^/]+\/[^/.]+)/.exec(manifest.repository?.url ?? '')?.[1];

const date = new Date().toISOString().slice(0, 10);
const heading = repository
  ? `## [${version}](https://github.com/${repository}/releases/tag/v${version}) - ${date}`
  : `## ${version} - ${date}`;

const existing = existsSync('CHANGELOG.md') ? readFileSync('CHANGELOG.md', 'utf8') : HEADER;

// Split off the preamble so new releases go above the previous ones but below
// the explanation of what the file is.
const firstRelease = existing.indexOf('\n## ');
const preamble = firstRelease === -1 ? existing.trimEnd() : existing.slice(0, firstRelease).trimEnd();
const older = firstRelease === -1 ? '' : existing.slice(firstRelease + 1).trimEnd();

const entry = `${heading}\n\n${notes}`;
writeFileSync('CHANGELOG.md', `${[preamble, entry, older].filter(Boolean).join('\n\n')}\n`);

console.log(`Recorded ${version} in CHANGELOG.md.`);
