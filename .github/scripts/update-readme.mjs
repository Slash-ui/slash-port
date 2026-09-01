#!/usr/bin/env node
/**
 * Point the version-bearing parts of README.md at a given release.
 *
 * Most of the badges in the README are dynamic - shields.io reads the npm
 * registry and the Actions API when the image is requested, so they need no
 * commit to stay current. The two things that cannot work that way are a badge
 * that names the release this commit *is*, and a link to that release's tag,
 * and those are what this script writes.
 *
 * Keeping both kinds side by side is deliberate. The managed badge says what
 * the repository believes it released; the npm badge says what the registry
 * actually serves. When a publish fails halfway, the two disagree on the README
 * of the very commit that failed, which is the cheapest possible place to
 * notice.
 *
 * The regions are delimited by HTML comments so that everything around them
 * stays hand-written. A missing marker is an error rather than a silent
 * no-op: a release whose badge quietly did not update is exactly the failure
 * this exists to prevent.
 *
 * Usage:
 *   node .github/scripts/update-readme.mjs [version] [--check] [--file=README.md]
 *
 * With no version, the one in package.json is used - which is what the release
 * pull request wants, because `npm version` has already run by then. `--check`
 * writes nothing and exits non-zero if the file is not already correct.
 */
import { readFileSync, writeFileSync } from 'node:fs';

const args = process.argv.slice(2);
const check = args.includes('--check');
const file = args.find((argument) => argument.startsWith('--file='))?.slice('--file='.length) ?? 'README.md';
const given = args.find((argument) => !argument.startsWith('-'));

const manifest = JSON.parse(readFileSync('package.json', 'utf8'));
const version = given ?? manifest.version;

if (!/^\d+\.\d+\.\d+/.test(version)) {
  console.error(`Not a version: ${version}`);
  process.exit(2);
}

const name = manifest.name;
const repository = /github\.com[/:]([^/]+\/[^/.]+)/.exec(manifest.repository?.url ?? '')?.[1];

if (!repository) {
  console.error('package.json has no GitHub repository URL to build a release link from.');
  process.exit(2);
}

// The accent colour is the one the badge row and the documentation site already
// use, so a hand-written badge and a generated one are indistinguishable.
const ACCENT = '0f8b7d';

/**
 * The managed regions, by marker name. Each is rendered from the version alone,
 * so running this twice on the same version changes nothing.
 */
const BLOCKS = {
  // Links to the tag rather than to the releases list: a badge that names a
  // version should take you to that version.
  badge: () =>
    `[![github](https://img.shields.io/badge/github-v${version}-${ACCENT}?logo=github&logoColor=white)]` +
    `(https://github.com/${repository}/releases/tag/v${version})`,
  // For prose that has to name the version in the middle of a sentence.
  version: () => version,
};

const original = readFileSync(file, 'utf8');
let updated = original;

for (const [block, render] of Object.entries(BLOCKS)) {
  const open = `<!-- release:${block} -->`;
  const close = `<!-- /release:${block} -->`;
  const region = new RegExp(`${open}[\\s\\S]*?${close}`);

  if (!region.test(updated)) {
    console.error(`${file} has no ${open} ... ${close} region.`);
    console.error('Add the markers back, or drop the block from update-readme.mjs.');
    process.exit(1);
  }

  updated = updated.replace(region, `${open}${render()}${close}`);
}

if (updated === original) {
  console.log(`${file} already points at v${version}.`);
  process.exit(0);
}

if (check) {
  console.error(`${file} does not point at v${version}.`);
  console.error(`Run: node .github/scripts/update-readme.mjs ${version}`);
  process.exit(1);
}

writeFileSync(file, updated);
console.log(`Pointed ${file} at v${version} of ${name}.`);
