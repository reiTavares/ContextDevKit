#!/usr/bin/env node
/** Focused regression tests for complete, changelog-backed GitHub Release notes. */
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  assertPackageVersion,
  extractReleaseNotes,
  renderReleaseNotesFile,
  validateReleaseVersion,
} from './release-notes.mjs';

const fixtureRoot = mkdtempSync(join(tmpdir(), 'contextdevkit-release-notes-'));

try {
  const changelog = [
    '\uFEFF# Changelog',
    '',
    '## [Unreleased]',
    '',
    '## [4.0.0] - 2026-08-09',
    '',
    '### Features (`feat`)',
    '',
    '- Complete canonical runtime.',
    '',
    '### Fixes (`fix`)',
    '',
    '- Full release notes.',
    '',
    '## [3.9.0] - 2026-08-02',
    '',
    '### Added',
    '- Previous release.',
    '',
  ].join('\r\n');
  const notes = extractReleaseNotes({ changelogText: changelog, version: '4.0.0' });
  assert.match(notes, /^## \[4\.0\.0] - 2026-08-09/);
  assert.match(notes, /Complete canonical runtime/);
  assert.match(notes, /Full release notes/);
  assert.doesNotMatch(notes, /Previous release/);
  assert.equal(validateReleaseVersion('4.0.0'), '4.0.0');
  assert.throws(() => validateReleaseVersion('v4.0.0'), /invalid release version/);
  assert.throws(() => extractReleaseNotes({ changelogText: changelog, version: '4.0.1' }), /found 0/);
  assert.throws(() => extractReleaseNotes({ changelogText: `${changelog}\n## [4.0.0]\n### Added\n- duplicate\n`, version: '4.0.0' }), /found 2/);
  assert.throws(() => extractReleaseNotes({ changelogText: '# Changelog\n\n## [4.0.0]\n\nNo categorized entries.\n', version: '4.0.0' }), /no categorized release entries/);
  assert.doesNotThrow(() => assertPackageVersion({ packageText: '{"version":"4.0.0"}', version: '4.0.0' }));
  assert.throws(() => assertPackageVersion({ packageText: '{"version":"3.9.0"}', version: '4.0.0' }), /does not match package version/);

  const changelogPath = join(fixtureRoot, 'CHANGELOG.md');
  const packagePath = join(fixtureRoot, 'package.json');
  const outputPath = join(fixtureRoot, 'release-notes.md');
  writeFileSync(changelogPath, changelog, 'utf8');
  writeFileSync(packagePath, '{"version":"4.0.0"}\n', 'utf8');
  const receipt = renderReleaseNotesFile({ changelogPath, packagePath, outputPath, version: '4.0.0' });
  assert.equal(receipt.version, '4.0.0');
  assert.equal(receipt.bytes, Buffer.byteLength(notes));
  assert.equal(readFileSync(outputPath, 'utf8'), notes);

  const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
  const workflow = readFileSync(join(repositoryRoot, '.github', 'workflows', 'release.yml'), 'utf8');
  assert.match(workflow, /release-notes\.mjs/);
  assert.match(workflow, /--notes-file/);
  assert.doesNotMatch(workflow, /--generate-notes/);
  console.log('release-notes: complete changelog extraction and workflow wiring passed');
} finally {
  rmSync(fixtureRoot, { recursive: true, force: true });
}
