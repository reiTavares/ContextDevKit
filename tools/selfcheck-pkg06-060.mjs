#!/usr/bin/env node
/**
 * CDK-060 self-check — skill-runner.mjs (PKG-06, native skills + explicit runner for Claude).
 *
 * Verifies four invariants:
 *   (a) listSkills(DEFAULT_REGISTRY) returns >= 1 entry, every entry has a
 *       non-empty claudeInvocation and entrypoint, and the list is sorted by id.
 *   (b) resolveSkill('<known-id>', DEFAULT_REGISTRY) is non-null, has the full
 *       SkillEntry shape (id, claudeInvocation, entrypoint, minLevel, prerequisites).
 *   (c) resolveSkill('nonexistent', DEFAULT_REGISTRY) returns null (unknown id → null).
 *   (d) resolveSkill with bad inputs (empty string, null, undefined, number) returns null,
 *       never throws.
 *
 * Standalone runnable: node tools/selfcheck-pkg06-060.mjs
 * Exit 0 on all-pass, exit 1 on any failure.
 * Hermetic: uses DEFAULT_REGISTRY directly — no installed project config required.
 */
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SKILL_RUNNER_PATH = resolve(__dirname, '../templates/contextkit/tools/scripts/skill-runner.mjs');
const CAPABILITIES_PATH = resolve(__dirname, '../templates/contextkit/runtime/capabilities/resolve-capabilities.mjs');

let failures = 0;
const ok  = (msg) => console.log(`  ✓ ${msg}`);
const bad = (msg) => { console.error(`  ✗ ${msg}`); failures += 1; };

// ---------------------------------------------------------------------------
// Import modules under test
// ---------------------------------------------------------------------------
let listSkills, resolveSkill;
try {
  ({ listSkills, resolveSkill } = await import(pathToFileURL(SKILL_RUNNER_PATH).href));
} catch (importError) {
  console.error(`FATAL: cannot import skill-runner.mjs: ${importError?.message ?? importError}`);
  process.exit(1);
}

let DEFAULT_REGISTRY;
try {
  ({ DEFAULT_REGISTRY } = await import(pathToFileURL(CAPABILITIES_PATH).href));
} catch (importError) {
  console.error(`FATAL: cannot import resolve-capabilities.mjs: ${importError?.message ?? importError}`);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// (a) listSkills — shape, content, and sort-order
// ---------------------------------------------------------------------------
console.log('\n(a) listSkills(DEFAULT_REGISTRY) — presence, shape, and sort order\n');

const skills = listSkills(DEFAULT_REGISTRY);

Array.isArray(skills)
  ? ok('listSkills returns an array')
  : bad('listSkills did not return an array');

skills.length >= 1
  ? ok(`listSkills returned ${skills.length} skill(s) (≥ 1 required)`)
  : bad(`listSkills returned 0 entries — expected ≥ 1 from DEFAULT_REGISTRY`);

// Every entry must have non-empty claudeInvocation and entrypoint.
let shapeFailures = 0;
for (const skill of skills) {
  const hasId = typeof skill.id === 'string' && skill.id.length > 0;
  const hasAlias = typeof skill.claudeInvocation === 'string' && skill.claudeInvocation.length > 0;
  const hasEntry = typeof skill.entrypoint === 'string' && skill.entrypoint.length > 0;
  const hasLevel = typeof skill.minLevel === 'number';
  if (!hasId || !hasAlias || !hasEntry || !hasLevel) {
    bad(`skill '${skill.id ?? '(no id)'}' missing required fields (id/claudeInvocation/entrypoint/minLevel)`);
    shapeFailures++;
  }
}
if (shapeFailures === 0 && skills.length > 0) ok('every skill entry has id, claudeInvocation, entrypoint, and minLevel');

// List must be sorted by id (stable/deterministic).
const sortedIds = skills.map((s) => s.id);
const expectedSorted = [...sortedIds].sort((a, b) => a.localeCompare(b));
JSON.stringify(sortedIds) === JSON.stringify(expectedSorted)
  ? ok('skills are sorted by id (deterministic order)')
  : bad(`skills are NOT sorted by id — got [${sortedIds.join(', ')}], expected [${expectedSorted.join(', ')}]`);

// No duplicates.
const idSet = new Set(sortedIds);
idSet.size === sortedIds.length
  ? ok('no duplicate skill ids')
  : bad(`duplicate skill ids found in listSkills output`);

// ---------------------------------------------------------------------------
// (b) resolveSkill with a known id — full SkillEntry shape
// ---------------------------------------------------------------------------
console.log('\n(b) resolveSkill(<known-id>, DEFAULT_REGISTRY) — full shape\n');

// Pick the first skill from the list — guaranteed present if (a) passed.
const knownId = skills.length > 0 ? skills[0].id : 'state';
const resolved = resolveSkill(knownId, DEFAULT_REGISTRY);

resolved !== null
  ? ok(`resolveSkill('${knownId}') is non-null`)
  : bad(`resolveSkill('${knownId}') returned null — expected a SkillEntry`);

if (resolved !== null) {
  typeof resolved.id === 'string' && resolved.id === knownId
    ? ok(`resolved.id === '${knownId}'`)
    : bad(`resolved.id mismatch: got '${resolved.id}', expected '${knownId}'`);

  typeof resolved.claudeInvocation === 'string' && resolved.claudeInvocation.length > 0
    ? ok(`resolved.claudeInvocation is non-empty: '${resolved.claudeInvocation}'`)
    : bad(`resolved.claudeInvocation is empty or wrong type`);

  typeof resolved.entrypoint === 'string' && resolved.entrypoint.length > 0
    ? ok(`resolved.entrypoint is non-empty: '${resolved.entrypoint}'`)
    : bad(`resolved.entrypoint is empty or wrong type`);

  typeof resolved.minLevel === 'number'
    ? ok(`resolved.minLevel is a number: ${resolved.minLevel}`)
    : bad(`resolved.minLevel is not a number (got ${typeof resolved.minLevel})`);

  Array.isArray(resolved.prerequisites)
    ? ok(`resolved.prerequisites is an array (${resolved.prerequisites.length} item(s))`)
    : bad(`resolved.prerequisites is not an array`);
}

// Spot-check 'state' which is always in DEFAULT_REGISTRY.
const stateSkill = resolveSkill('state', DEFAULT_REGISTRY);
stateSkill !== null && stateSkill.claudeInvocation === '/state'
  ? ok("resolveSkill('state') → claudeInvocation === '/state'")
  : bad(`resolveSkill('state') → unexpected: ${JSON.stringify(stateSkill)}`);

// ---------------------------------------------------------------------------
// (c) resolveSkill with unknown id returns null
// ---------------------------------------------------------------------------
console.log('\n(c) resolveSkill(\'nonexistent\', ...) — unknown id returns null\n');

const unknownResult = resolveSkill('nonexistent-skill-id-xyzzy', DEFAULT_REGISTRY);
unknownResult === null
  ? ok("resolveSkill('nonexistent-skill-id-xyzzy') returned null (unknown id)")
  : bad(`resolveSkill('nonexistent-skill-id-xyzzy') returned non-null: ${JSON.stringify(unknownResult)}`);

const emptyStringResult = resolveSkill('', DEFAULT_REGISTRY);
emptyStringResult === null
  ? ok("resolveSkill('') returned null (empty id)")
  : bad(`resolveSkill('') returned non-null: ${JSON.stringify(emptyStringResult)}`);

// ---------------------------------------------------------------------------
// (d) resolveSkill with bad inputs — no throws, always null
// ---------------------------------------------------------------------------
console.log('\n(d) resolveSkill with bad inputs — fail-open (null, no throw)\n');

const badInputs = [
  [null,      'null'],
  [undefined, 'undefined'],
  [42,        'number 42'],
  [{},        'object {}'],
  [[],        'empty array'],
];

for (const [input, label] of badInputs) {
  try {
    // @ts-ignore intentional bad input
    const badResult = resolveSkill(input, DEFAULT_REGISTRY);
    badResult === null
      ? ok(`resolveSkill(${label}) → null, no throw`)
      : bad(`resolveSkill(${label}) → non-null: ${JSON.stringify(badResult)}`);
  } catch (thrownError) {
    bad(`resolveSkill(${label}) threw instead of returning null: ${thrownError?.message ?? thrownError}`);
  }
}

// resolveSkill with null registry should also not throw.
try {
  // @ts-ignore intentional bad registry
  const nullRegResult = resolveSkill('state', null);
  nullRegResult === null
    ? ok('resolveSkill(known-id, null-registry) → null, no throw')
    : bad(`resolveSkill(known-id, null-registry) → non-null: ${JSON.stringify(nullRegResult)}`);
} catch (thrownError) {
  bad(`resolveSkill(known-id, null-registry) threw: ${thrownError?.message ?? thrownError}`);
}

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------
console.log(
  failures === 0
    ? '\n  PASS — CDK-060 skill-runner self-check: all checks passed.\n'
    : `\n  FAIL — CDK-060 skill-runner self-check: ${failures} check(s) failed.\n`,
);
process.exit(failures === 0 ? 0 : 1);
