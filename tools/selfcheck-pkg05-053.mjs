#!/usr/bin/env node
/**
 * CDK-053 self-test — playbook-scope.mjs (PKG-05). Proves: (1) parsePlaybookMeta
 * extracts phases/squads from well-formed frontmatter; (2) missing/malformed
 * frontmatter degrades to empty arrays; (3) playbooksByPhase returns exactly the
 * matching subset and never throws on an unknown phase; (4) playbooksBySquad
 * behaves analogously; (5) all hold with real fixture files in a temp dir.
 * Zero deps; unique tmp dir, cleaned up on exit. Run:
 * `node tools/selfcheck-pkg05-053.mjs` (exit 0 = PASS).
 */
import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';

// ---------------------------------------------------------------------------
// Locate the module under test (relative to THIS file in tools/).
// ---------------------------------------------------------------------------
const __dirname = dirname(fileURLToPath(import.meta.url));
const MODULE_PATH = resolve(__dirname, '../templates/contextkit/tools/scripts/playbook-scope.mjs');

const { parsePlaybookMeta, playbooksByPhase, playbooksBySquad } =
  await import(pathToFileURL(MODULE_PATH).href);

// ---------------------------------------------------------------------------
// Micro-assertion harness (mirrors style of other selfcheck-*.mjs files).
// ---------------------------------------------------------------------------
let failures = 0;

const ok = (msg) => console.log(`  ok  ${msg}`);
const bad = (msg) => {
  console.error(`  FAIL ${msg}`);
  failures += 1;
};

/**
 * Asserts two arrays of strings are equal (order-insensitive).
 *
 * @param {string} label
 * @param {string[]} got
 * @param {string[]} expected
 */
function assertArr(label, got, expected) {
  const sortedGot = [...got].sort();
  const sortedExp = [...expected].sort();
  const equal =
    sortedGot.length === sortedExp.length &&
    sortedGot.every((v, i) => v === sortedExp[i]);
  equal
    ? ok(`${label} → [${sortedGot.join(', ')}]`)
    : bad(`${label} → got [${sortedGot.join(', ')}], want [${sortedExp.join(', ')}]`);
}

/**
 * Asserts a filtered playbook list contains exactly the expected file names.
 *
 * @param {string} label
 * @param {Array<{file:string}>} items
 * @param {string[]} expectedFiles
 */
function assertFiles(label, items, expectedFiles) {
  const gotFiles = items.map((i) => i.file).sort();
  const wantFiles = [...expectedFiles].sort();
  const equal =
    gotFiles.length === wantFiles.length &&
    gotFiles.every((f, i) => f === wantFiles[i]);
  equal
    ? ok(`${label} → [${gotFiles.join(', ')}]`)
    : bad(`${label} → got [${gotFiles.join(', ')}], want [${wantFiles.join(', ')}]`);
}

// ---------------------------------------------------------------------------
// Section 1 — parsePlaybookMeta unit tests (no filesystem).
// ---------------------------------------------------------------------------
console.log('\nSection 1: parsePlaybookMeta (unit, no filesystem)');

// 1a. Well-formed frontmatter with both keys.
{
  const text = `---
phases:
  - intake
  - spec
squads:
  - devteam
---
# My Playbook
`;
  const { phases, squads } = parsePlaybookMeta(text);
  assertArr('1a phases', phases, ['intake', 'spec']);
  assertArr('1a squads', squads, ['devteam']);
}

// 1b. Frontmatter with only phases (no squads key).
{
  const text = `---
phases:
  - conclusion
---
# No squads
`;
  const { phases, squads } = parsePlaybookMeta(text);
  assertArr('1b phases (only phases key)', phases, ['conclusion']);
  assertArr('1b squads (missing key → [])', squads, []);
}

// 1c. No frontmatter at all — plain heading.
{
  const text = `# Just a heading\n\nSome content.\n`;
  const { phases, squads } = parsePlaybookMeta(text);
  assertArr('1c phases (no frontmatter → [])', phases, []);
  assertArr('1c squads (no frontmatter → [])', squads, []);
}

// 1d. Opening delimiter present but no closing delimiter.
{
  const text = `---
phases:
  - ship
# heading never gets here`;
  const { phases, squads } = parsePlaybookMeta(text);
  assertArr('1d phases (unclosed block → [])', phases, []);
  assertArr('1d squads (unclosed block → [])', squads, []);
}

// 1e. Empty file string.
{
  const { phases, squads } = parsePlaybookMeta('');
  assertArr('1e phases (empty string → [])', phases, []);
  assertArr('1e squads (empty string → [])', squads, []);
}

// 1f. Non-string input — must not throw.
{
  try {
    const { phases, squads } = parsePlaybookMeta(null);
    assertArr('1f phases (null input → [])', phases, []);
    assertArr('1f squads (null input → [])', squads, []);
  } catch (err) {
    bad(`1f parsePlaybookMeta(null) threw: ${err?.message ?? err}`);
  }
}

// 1g. Multiple squads.
{
  const text = `---
phases:
  - pipeline
squads:
  - design-team
  - security-team
---
# Multi-squad
`;
  const { phases, squads } = parsePlaybookMeta(text);
  assertArr('1g phases (single phase)', phases, ['pipeline']);
  assertArr('1g squads (two squads)', squads, ['design-team', 'security-team']);
}

// ---------------------------------------------------------------------------
// Section 2 — filesystem-based filtering tests.
// Build a temp directory with three fixture playbooks.
// ---------------------------------------------------------------------------
console.log('\nSection 2: playbooksByPhase / playbooksBySquad (filesystem fixtures)');

const tmpRoot = mkdtempSync(join(tmpdir(), 'cdk053-'));

/** @type {Array<{name: string, content: string}>} */
const FIXTURES = [
  {
    name: 'alpha.md',
    content: `---
phases:
  - intake
  - spec
squads:
  - devteam
---
# Alpha playbook
`,
  },
  {
    name: 'beta.md',
    content: `---
phases:
  - ship
squads:
  - security-team
  - devteam
---
# Beta playbook
`,
  },
  {
    name: 'gamma.md',
    // No frontmatter — should degrade to empty phases and squads.
    content: `# Gamma playbook\n\nNo frontmatter here.\n`,
  },
];

// Write fixtures.
for (const { name, content } of FIXTURES) {
  writeFileSync(join(tmpRoot, name), content, 'utf-8');
}

// 2a. Filter by phase "intake" → only alpha.
assertFiles('2a phase=intake', playbooksByPhase(tmpRoot, 'intake'), ['alpha.md']);

// 2b. Filter by phase "spec" → only alpha.
assertFiles('2b phase=spec', playbooksByPhase(tmpRoot, 'spec'), ['alpha.md']);

// 2c. Filter by phase "ship" → only beta.
assertFiles('2c phase=ship', playbooksByPhase(tmpRoot, 'ship'), ['beta.md']);

// 2d. Unknown phase → empty array (no throw).
{
  let result;
  try {
    result = playbooksByPhase(tmpRoot, 'nonexistent-phase');
  } catch (err) {
    bad(`2d playbooksByPhase(unknown) threw: ${err?.message ?? err}`);
    result = [];
  }
  assertFiles('2d unknown phase → []', result, []);
}

// 2e. No-frontmatter file is not returned for any phase.
{
  const inIntake = playbooksByPhase(tmpRoot, 'intake').map((i) => i.file);
  !inIntake.includes('gamma.md')
    ? ok('2e gamma (no frontmatter) not in phase=intake')
    : bad('2e gamma (no frontmatter) incorrectly appeared in phase=intake');
}

// 2f. Filter by squad "devteam" → alpha and beta.
assertFiles('2f squad=devteam', playbooksBySquad(tmpRoot, 'devteam'), [
  'alpha.md',
  'beta.md',
]);

// 2g. Filter by squad "security-team" → only beta.
assertFiles('2g squad=security-team', playbooksBySquad(tmpRoot, 'security-team'), [
  'beta.md',
]);

// 2h. Unknown squad → empty array (no throw).
{
  let result;
  try {
    result = playbooksBySquad(tmpRoot, 'no-such-squad');
  } catch (err) {
    bad(`2h playbooksBySquad(unknown) threw: ${err?.message ?? err}`);
    result = [];
  }
  assertFiles('2h unknown squad → []', result, []);
}

// 2i. Empty string phase → empty array.
assertFiles('2i empty string phase → []', playbooksByPhase(tmpRoot, ''), []);

// 2j. Non-existent directory → empty array (fail-open, no throw).
{
  let result;
  try {
    result = playbooksByPhase('/this/path/does/not/exist', 'intake');
  } catch (err) {
    bad(`2j non-existent dir threw: ${err?.message ?? err}`);
    result = [];
  }
  Array.isArray(result) && result.length === 0
    ? ok('2j non-existent dir → []')
    : bad(`2j non-existent dir → unexpected result [${result?.map?.((i) => i.file).join(', ')}]`);
}

// 2k. The `title` field in returned entries is populated from the heading.
{
  const entries = playbooksByPhase(tmpRoot, 'intake');
  const entry = entries.find((e) => e.file === 'alpha.md');
  entry?.title === 'Alpha playbook'
    ? ok('2k title extracted from heading')
    : bad(`2k title wrong: ${entry?.title}`);
}

// ---------------------------------------------------------------------------
// Cleanup temp directory.
// ---------------------------------------------------------------------------
try {
  rmSync(tmpRoot, { recursive: true, force: true });
} catch {
  // Best-effort cleanup; leaving a small tmpdir behind is not a test failure.
}

// ---------------------------------------------------------------------------
// Result.
// ---------------------------------------------------------------------------
console.log(
  failures === 0
    ? '\nPASS — selfcheck-pkg05-053 all checks green.\n'
    : `\nFAIL — ${failures} check(s) failed.\n`
);
process.exit(failures === 0 ? 0 : 1);
