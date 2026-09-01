#!/usr/bin/env node
/**
 * Fail if `npm pack` would ship anything outside the allowlist.
 *
 * `package.json` declares `files`, but a stray `.npmignore`, a new top-level
 * file, or a build that writes outside `dist/` can all widen the tarball
 * without anyone noticing. npm versions are permanent, so this is checked
 * before publishing rather than discovered afterwards.
 */
import { execFileSync } from 'node:child_process';

const ALLOWED = [/^dist\//, /^README\.md$/, /^LICENSE$/, /^package\.json$/];

const output = execFileSync('npm', ['pack', '--dry-run', '--json'], {
  encoding: 'utf8',
  stdio: ['ignore', 'pipe', 'inherit'],
});

const [result] = JSON.parse(output);
const files = (result?.files ?? []).map((file) => file.path);

if (files.length === 0) {
  console.error('The tarball is empty. Did the build run?');
  process.exit(1);
}

const unexpected = files.filter((file) => !ALLOWED.some((pattern) => pattern.test(file)));

if (unexpected.length > 0) {
  console.error('These files would be published but are not on the allowlist:');
  for (const file of unexpected) console.error(`  ${file}`);
  console.error('\nEither add them to the allowlist in this script, or keep them out of `files`.');
  process.exit(1);
}

console.log(`Tarball contents are within the allowlist (${files.length} files, ${result.size} bytes):`);
for (const file of files) console.log(`  ${file}`);
