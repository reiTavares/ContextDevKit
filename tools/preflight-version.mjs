#!/usr/bin/env node
/**
 * Release preflight — refuse to release a version that is already on npm.
 *
 * Run via `npm run preflight-release` (which runs `npm run ci` first, then this).
 * Guards the two release mistakes we hit cutting v1.9.0/v1.10.0: tagging on a red
 * gate (the `ci` step before this catches that) and re-publishing an existing
 * version (this catches that). Zero-dep; cross-platform npm binary resolution.
 *
 * Exit 1 = blocked (already published); exit 0 = clear to release.
 */
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const { name, version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf-8'));
const npmBin = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const res = spawnSync(npmBin, ['view', `${name}@${version}`, 'version'], { encoding: 'utf-8', timeout: 20000 });
const published = (res.stdout || '').trim();

if (published === version) {
  console.error(`❌ ${name}@${version} is ALREADY published on npm. Bump the version in package.json before releasing.`);
  process.exit(1);
}
console.log(`✓ ${name}@${version} is not yet on npm — clear to tag & release.`);
