#!/usr/bin/env node
/**
 * integration-test-changelog.mjs — WF-0096 / OP-0010 (ADR-0153)
 *
 * Behavioral assertions for the changelog rotation boundary. Rotation is a
 * filesystem operation over historical data, so every assertion runs against a
 * SYNTHETIC fixture in a temp dir — never the repository's real CHANGELOG.md.
 * That separation keeps "the script works" distinct from "the history is right".
 *
 * Assertions:
 *   1. REGRESSION: --check EXITS 1 on the duplicated-entry pattern that exists
 *      in the real changelog today (nothing detects it before this gate).
 *   2. --write REFUSES while a duplicate stands, and writes nothing.
 *   3. dry-run (default) writes nothing and reports the plan.
 *   4. --write rotates: head keeps [Unreleased] + the current major; closed
 *      majors land in docs/changelog/vN.md; the index lists every version.
 *   5. CONSERVATION: every non-blank content line and every version heading
 *      survives the rotation (no historical data loss).
 *   6. IDEMPOTENCE: a second --write is byte-identical to the first.
 *   7. REENTRANCY: no temp artifact is left behind by a completed run.
 *   8. --check EXITS 0 on an already-rotated tree.
 *   9. ADVERSARIAL: BOM + CRLF parse; a version heading inside a code fence is
 *      NOT a version; a pre-release buckets with its own major.
 *  10. SINGLE-SOURCE: the templates/ script and the dogfood mirror agree.
 *
 * Zero runtime deps — node:* only. Exits 0 on all-pass, 1 on any failure.
 * Standalone: node tools/integration-test-changelog.mjs
 */

import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const KIT = dirname(dirname(fileURLToPath(import.meta.url)));
const SOURCE_SCRIPT = resolve(KIT, 'templates/contextkit/tools/scripts/changelog-rotate.mjs');
const MIRROR_SCRIPT = resolve(KIT, 'contextkit/tools/scripts/changelog-rotate.mjs');
const node = process.execPath;

let failures = 0;
let passes = 0;
const ok = (msg) => { passes++; console.log(`  ✓ ${msg}`); };
const bad = (msg) => { failures++; console.error(`  ✗ ${msg}`); };

/** @type {string[]} temp dirs registered for cleanup. */
const tempDirs = [];
const makeTempDir = () => {
  const dir = mkdtempSync(join(tmpdir(), 'cdk-changelog-it-'));
  tempDirs.push(dir);
  return dir;
};
const cleanup = () => {
  for (const dir of tempDirs) {
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* best-effort */ }
  }
};

/** Runs the rotation CLI against a fixture root. */
function rotate(root, ...args) {
  const result = spawnSync(node, [SOURCE_SCRIPT, root, ...args], { encoding: 'utf-8', cwd: KIT });
  return { status: result.status ?? 1, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
}

const read = (path) => (existsSync(path) ? readFileSync(path, 'utf-8') : '');

/** Non-blank content lines, for the conservation invariant. */
function contentLines(text) {
  return text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
}

/** Version headings found outside code fences. */
function versionHeadings(text) {
  const found = [];
  let inFence = false;
  for (const raw of text.split(/\r?\n/)) {
    if (/^\s*(```|~~~)/.test(raw)) { inFence = !inFence; continue; }
    if (inFence) continue;
    const match = /^##\s+\[([^\]]+)\]/.exec(raw);
    if (match && !/^unreleased$/i.test(match[1])) found.push(match[1]);
  }
  return found;
}

// ---------------------------------------------------------------------------
// Fixtures — small, synthetic, and deliberately NOT the real changelog.
// ---------------------------------------------------------------------------

/** The literal shape of the duplication that exists in the real changelog. */
const DUPLICATED_ENTRY = '- **WF-0082 Business create implemented.** Dry-run, atomic apply and QA coverage shipped.';

function cleanFixture() {
  return [
    '# Changelog',
    '',
    'All notable changes are documented here.',
    '',
    '## [Unreleased]',
    '',
    '### Added',
    '- Rotation gate for the release history.',
    '',
    '## [2.1.0] - 2026-06-02',
    '',
    '### Added',
    '- Second-major feature.',
    '',
    '### Fixed',
    '- A second-major defect.',
    '',
    '## [2.0.0] - 2026-06-01',
    '',
    '### Changed',
    '- Breaking rename in the second major.',
    '',
    '## [1.5.0] - 2026-05-20',
    '',
    '### Added',
    '- First-major feature.',
    '',
    '## [1.0.0] - 2026-05-01',
    '',
    '### Added',
    '- Initial release.',
    '',
  ].join('\n');
}

function duplicatedFixture() {
  return cleanFixture().replace(
    '- Rotation gate for the release history.',
    [DUPLICATED_ENTRY, DUPLICATED_ENTRY].join('\n'),
  );
}

/** BOM + CRLF + a version heading buried in a fence + a pre-release. */
function adversarialFixture() {
  const body = [
    '# Changelog',
    '',
    '## [Unreleased]',
    '',
    '- Pending work.',
    '',
    '## [2.0.0-rc.1] - 2026-06-05',
    '',
    '### Added',
    '- Release candidate of the second major.',
    '',
    '## [2.0.0] - 2026-06-01',
    '',
    '### Added',
    '- Second major.',
    '',
    '## [1.0.0] - 2026-05-01',
    '',
    'A fenced block that only LOOKS like history:',
    '',
    '```markdown',
    '## [9.9.9] - 1999-01-01',
    '```',
    '',
    '### Added',
    '- Initial release.',
    '',
  ].join('\r\n');
  return `﻿${body}`;
}

/** Writes a fixture root and returns its useful paths. */
function seed(text) {
  const root = makeTempDir();
  writeFileSync(join(root, 'CHANGELOG.md'), text, 'utf-8');
  mkdirSync(join(root, 'docs'), { recursive: true });
  return {
    root,
    head: join(root, 'CHANGELOG.md'),
    archiveDir: join(root, 'docs', 'changelog'),
    index: join(root, 'docs', 'changelog', 'README.md'),
    v1: join(root, 'docs', 'changelog', 'v1.md'),
  };
}

// ---------------------------------------------------------------------------
// Assertions
// ---------------------------------------------------------------------------

/** 1 + 2 — the duplicate is detected and blocks the write. */
function assertDuplicateBlocks() {
  const fixture = seed(duplicatedFixture());
  const before = read(fixture.head);

  const check = rotate(fixture.root, '--check');
  if (check.status === 1) ok('--check exits 1 on the real duplicated-entry pattern');
  else bad(`--check should exit 1 on a duplicated entry (got ${check.status})`);

  const output = `${check.stdout}${check.stderr}`;
  if (/duplicat/i.test(output)) ok('--check names the duplication in its report');
  else bad('--check must name the duplication, not fail opaquely');

  const write = rotate(fixture.root, '--write');
  if (write.status !== 0) ok('--write refuses while a duplicate stands');
  else bad('--write must refuse while a duplicate stands');

  if (read(fixture.head) === before) ok('refused --write left CHANGELOG.md untouched');
  else bad('refused --write must not modify CHANGELOG.md');

  if (!existsSync(fixture.archiveDir)) ok('refused --write created no archive directory');
  else bad('refused --write must not create the archive directory');
}

/** 3 — dry-run is the default and never writes. */
function assertDryRunWritesNothing() {
  const fixture = seed(cleanFixture());
  const before = read(fixture.head);

  const result = rotate(fixture.root);
  if (result.status === 0) ok('dry-run exits 0 on a healthy changelog');
  else bad(`dry-run should exit 0 (got ${result.status}): ${result.stderr.trim()}`);

  if (read(fixture.head) === before) ok('dry-run left CHANGELOG.md untouched');
  else bad('dry-run must not modify CHANGELOG.md');

  if (!existsSync(fixture.v1)) ok('dry-run wrote no archive file');
  else bad('dry-run must not write an archive file');
}

/** 4 + 5 + 6 + 7 + 8 — rotation, conservation, idempotence, reentrancy, sync. */
function assertRotation() {
  const fixture = seed(cleanFixture());
  const original = read(fixture.head);

  const first = rotate(fixture.root, '--write');
  if (first.status === 0) ok('--write rotates a healthy changelog');
  else { bad(`--write failed (${first.status}): ${first.stderr.trim()}`); return; }

  const head = read(fixture.head);
  if (/##\s+\[Unreleased\]/.test(head)) ok('head keeps the [Unreleased] block');
  else bad('head must keep [Unreleased]');

  const headVersions = versionHeadings(head);
  if (headVersions.length > 0 && headVersions.every((version) => version.startsWith('2.'))) {
    ok('head keeps only the current major');
  } else bad(`head must keep only the current major (found ${headVersions.join(', ') || 'none'})`);

  if (existsSync(fixture.v1)) ok('closed major archived to docs/changelog/v1.md');
  else bad('closed major must be archived to docs/changelog/v1.md');

  const archived = versionHeadings(read(fixture.v1));
  if (archived.includes('1.5.0') && archived.includes('1.0.0')) ok('archive holds every version of the closed major');
  else bad(`archive must hold the closed major's versions (found ${archived.join(', ') || 'none'})`);

  const index = read(fixture.index);
  if (['2.1.0', '2.0.0', '1.5.0', '1.0.0'].every((version) => index.includes(version))) {
    ok('index lists every version across head and archive');
  } else bad('index must list every version');

  // Conservation — nothing historical is lost or invented.
  const rotatedLines = contentLines([head, read(fixture.v1)].join('\n'));
  const lost = contentLines(original).filter((line) => !rotatedLines.includes(line));
  if (lost.length === 0) ok('conservation: every content line survived the rotation');
  else bad(`conservation broken — ${lost.length} line(s) lost, first: ${lost[0]}`);

  const beforeCount = versionHeadings(original).length;
  const afterCount = versionHeadings(head).length + versionHeadings(read(fixture.v1)).length;
  if (beforeCount === afterCount) ok(`conservation: version count preserved (${beforeCount})`);
  else bad(`conservation broken — ${beforeCount} versions before, ${afterCount} after`);

  // Idempotence — a second write changes nothing.
  const snapshot = { head, v1: read(fixture.v1), index };
  const second = rotate(fixture.root, '--write');
  if (second.status === 0) ok('a second --write still exits 0');
  else bad(`second --write should exit 0 (got ${second.status})`);

  const stable = read(fixture.head) === snapshot.head
    && read(fixture.v1) === snapshot.v1
    && read(fixture.index) === snapshot.index;
  if (stable) ok('idempotence: the second --write is byte-identical');
  else bad('idempotence broken — the second --write changed bytes');

  // Reentrancy — no temp artifact survives a completed run.
  const strays = readdirSync(fixture.root).filter((name) => /\.tmp|\.new$|~$/.test(name));
  if (strays.length === 0) ok('reentrancy: no temp artifact left in the root');
  else bad(`reentrancy: temp artifact(s) left behind — ${strays.join(', ')}`);

  const recheck = rotate(fixture.root, '--check');
  if (recheck.status === 0) ok('--check exits 0 on an already-rotated tree');
  else bad(`--check should exit 0 once rotated (got ${recheck.status}): ${recheck.stderr.trim()}`);
}

/** 9 — adversarial input parses without silent loss. */
function assertAdversarialInput() {
  const fixture = seed(adversarialFixture());

  const check = rotate(fixture.root, '--check');
  if (check.status !== 2) ok('BOM + CRLF input parses without an unusable-input verdict');
  else bad(`BOM + CRLF input was rejected as unusable: ${check.stderr.trim()}`);

  const write = rotate(fixture.root, '--write');
  if (write.status === 0) ok('--write handles BOM + CRLF + fenced-heading input');
  else { bad(`--write failed on adversarial input (${write.status}): ${write.stderr.trim()}`); return; }

  const rotated = [read(fixture.head), read(fixture.v1)].join('\n');
  if (!read(fixture.index).includes('9.9.9')) ok('a version heading inside a code fence is not a version');
  else bad('a fenced heading must never be treated as a version');

  if (rotated.includes('## [9.9.9] - 1999-01-01')) ok('the fenced block survived verbatim');
  else bad('the fenced block must survive verbatim');

  const head = read(fixture.head);
  if (/##\s+\[2\.0\.0-rc\.1\]/.test(head)) ok('a pre-release buckets with its own major');
  else bad('a pre-release must bucket with its own major');
}

/** 10 — single-source: the mirror must not drift from the template. */
function assertSingleSource() {
  if (!existsSync(SOURCE_SCRIPT)) { bad(`source script missing: ${SOURCE_SCRIPT}`); return; }
  if (!existsSync(MIRROR_SCRIPT)) { bad(`dogfood mirror missing: ${MIRROR_SCRIPT}`); return; }
  if (readFileSync(SOURCE_SCRIPT, 'utf-8') === readFileSync(MIRROR_SCRIPT, 'utf-8')) {
    ok('templates/ source and dogfood mirror are identical');
  } else bad('templates/ source and dogfood mirror have drifted');
}

/** Pure-function contract — the units the CLI is built from must be importable. */
async function assertPureFunctions() {
  if (!existsSync(SOURCE_SCRIPT)) { bad('cannot check pure exports — source script missing'); return; }
  let mod;
  try { mod = await import(pathToFileURL(SOURCE_SCRIPT).href); } catch (err) { bad(`import failed: ${err?.message}`); return; }

  for (const name of ['parseChangelogSections', 'detectDuplicateEntries', 'splitByMajor', 'compareSemVer']) {
    if (typeof mod[name] === 'function') ok(`exports pure ${name}()`);
    else bad(`must export pure ${name}() for unit-level testing`);
  }

  if (typeof mod.compareSemVer === 'function') {
    if (mod.compareSemVer('3.7.0', '3.7.0-rc.1') > 0) ok('compareSemVer orders a release above its pre-release');
    else bad('compareSemVer must order 3.7.0 above 3.7.0-rc.1');
    if (mod.compareSemVer('1.10.0', '1.9.0') > 0) ok('compareSemVer compares numerically, not lexically');
    else bad('compareSemVer must order 1.10.0 above 1.9.0');
  }

  if (typeof mod.detectDuplicateEntries === 'function' && typeof mod.parseChangelogSections === 'function') {
    const findings = mod.detectDuplicateEntries(mod.parseChangelogSections(duplicatedFixture()));
    if (Array.isArray(findings) && findings.length > 0) ok('detectDuplicateEntries surfaces the duplicate, never normalizes it');
    else bad('detectDuplicateEntries must surface the duplicated entry');
  }

  if (typeof mod.splitByMajor === 'function' && typeof mod.parseChangelogSections === 'function') {
    const buckets = mod.splitByMajor(mod.parseChangelogSections(cleanFixture()));
    const majors = [...buckets.keys()].map(String).sort();
    if (majors.join(',') === '1,2') ok('splitByMajor buckets by major version');
    else bad(`splitByMajor must bucket by major (got ${majors.join(',') || 'none'})`);
  }
}

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

async function main() {
  console.log('integration-test-changelog: rotation boundary (WF-0096 / ADR-0153)');
  try {
    await assertPureFunctions();
    assertSingleSource();
    assertDuplicateBlocks();
    assertDryRunWritesNothing();
    assertRotation();
    assertAdversarialInput();
  } finally {
    cleanup();
  }
  console.log(`\n${failures === 0 ? '✅' : '❌'} changelog rotation: ${passes} passed, ${failures} failed`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  cleanup();
  console.error(`integration-test-changelog: ${err?.message}`);
  process.exit(1);
});
