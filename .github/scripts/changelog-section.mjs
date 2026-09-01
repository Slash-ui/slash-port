#!/usr/bin/env node
/**
 * Print one version's section of CHANGELOG.md.
 *
 * The GitHub release notes are the changelog entry, read back out rather than
 * regenerated, so the two can never disagree - and so what is published is
 * exactly the text that was reviewed in the release pull request.
 *
 * Usage:
 *   node .github/scripts/changelog-section.mjs <version>
 */
import { readFileSync } from 'node:fs';

const [version] = process.argv.slice(2);

if (!version) {
  console.error('Usage: changelog-section.mjs <version>');
  process.exit(2);
}

const changelog = readFileSync('CHANGELOG.md', 'utf8');
const lines = changelog.split('\n');

const escaped = version.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const start = lines.findIndex((line) => new RegExp(`^## \\[?${escaped}\\]?[ (]`).test(line));

if (start === -1) {
  console.error(`CHANGELOG.md has no section for ${version}.`);
  process.exit(1);
}

const rest = lines.slice(start + 1);
const end = rest.findIndex((line) => line.startsWith('## '));
const section = (end === -1 ? rest : rest.slice(0, end)).join('\n').trim();

if (!section) {
  console.error(`The section for ${version} in CHANGELOG.md is empty.`);
  process.exit(1);
}

console.log(section);
