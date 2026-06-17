/**
 * Standalone integration test for the non-destructive legacy migration module
 * (WF0035 W3-T2, `templates/contextkit/tools/scripts/workflow/migrate.mjs`).
 *
 * Builds SYNTHETIC legacy packs in a throwaway temp dir — a Basic pack (a
 * tasks.md with no wave markers) and a wave-y Program pack (W0/W1/W2 headings +
 * task rows + a deliberate index-vs-narrative contradiction) — and proves the
 * acceptance contract (spec §22):
 *   - dry-run performs ZERO writes (full-dir content+mtime snapshot is byte-equal
 *     before/after);
 *   - a Basic pack migrates (plan inferred + validates);
 *   - a Program/wave pack infers multiple waves;
 *   - contradictions are surfaced (carried, not resolved);
 *   - apply inserts a managed `tasks` block while human prose outside is preserved;
 *   - a second apply is idempotent (no further change);
 *   - a receipt is written listing the changes.
 *
 * Deterministic: `now` is injected. Cross-platform, self-cleaning. Not registered
 * in `tools/test-suites.mjs` (W3-T2 ships standalone; the suite owner wires it).
 */
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { reporter } from './it-helpers.mjs';

const KIT = dirname(fileURLToPath(import.meta.url));
const MIGRATE = join(KIT, '..', 'templates', 'contextkit', 'tools', 'scripts', 'workflow', 'migrate.mjs');
const NOW = '2026-06-17T00:00:00.000Z';

/** Write a file, creating parent dirs as needed. */
function writeFile(path, content) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content, 'utf-8');
}

/**
 * Recursively snapshot every file under `root` as `relPath → "mtimeNs::content"`.
 * Used to prove a dry-run wrote nothing (content AND mtime must be unchanged).
 * @param {string} root
 * @returns {Map<string,string>}
 */
function snapshotTree(root) {
  const snapshot = new Map();
  const walk = (dir) => {
    for (const name of readdirSync(dir).sort()) {
      const full = join(dir, name);
      const stat = statSync(full);
      if (stat.isDirectory()) walk(full);
      else snapshot.set(full.slice(root.length), `${stat.mtimeMs}::${readFileSync(full, 'utf-8')}`);
    }
  };
  walk(root);
  return snapshot;
}

/** True when two tree snapshots are byte-identical (same keys + same values). */
function snapshotsEqual(left, right) {
  if (left.size !== right.size) return false;
  for (const [key, value] of left) {
    if (right.get(key) !== value) return false;
  }
  return true;
}

/** Build a Basic synthetic legacy pack (no wave markers). Returns its dir. */
function makeBasicPack(rootDir) {
  const packDir = join(rootDir, '0050-basic-legacy');
  writeFile(join(packDir, 'index.md'), '---\nslug: basic-legacy\nnumber: 0050\ncurrentPhase: spec\nspec: done\n---\n\n# Workflow - basic-legacy\n\n## History\n- spec drafted\n');
  writeFile(join(packDir, 'spec.md'), '# SPEC\n\nA small change. No waves.\n');
  writeFile(join(packDir, 'tasks.md'), '# Tasks - basic-legacy\n\nHuman-authored prose that MUST survive migration.\n\n| Card | Lane | Purpose |\n| --- | --- | --- |\n| 401 | backlog | Do the thing. |\n');
  return packDir;
}

/** Build a wave-y Program synthetic legacy pack with a contradiction. Returns its dir. */
function makeProgramPack(rootDir) {
  const packDir = join(rootDir, '0051-program-legacy');
  // Frontmatter says ship PENDING; tasks/memory claim it shipped → contradiction.
  writeFile(join(packDir, 'index.md'), '---\nslug: program-legacy\nnumber: 0051\ncurrentPhase: ship\nship: pending\n---\n\n# Workflow - program-legacy\n\n## History\n- planning done\n');
  writeFile(join(packDir, 'prd.md'), '# PRD\n');
  writeFile(join(packDir, 'risk-register.md'), '# Risks\n');
  writeFile(join(packDir, 'tasks.md'), [
    '# Tasks - program-legacy',
    '',
    'Important human notes. Keep this paragraph.',
    '',
    '### W0 — Governance · _done_',
    '',
    '| Task | Pri | Purpose |',
    '| --- | --- | --- |',
    '| **W0-T1** | P0 | Record the anchor decision. |',
    '',
    '### W1 — Build · _done_',
    '',
    '| **W1-T1** | P0 | Build the core. |',
    '| **W1-T2** | P1 | Build the projection. |',
    '',
    '### W2 — Integration',
    '',
    '| **W2-T1** | P0 | Wire it together. The ship phase is IMPLEMENTED and DONE. |',
    '',
  ].join('\n'));
  writeFile(join(packDir, 'memory.md'), '# Memory\n\nWAVE 2 ship is IMPLEMENTED and merged.\n');
  return packDir;
}

const rep = reporter();
const migrate = await import(pathToFileURL(MIGRATE).href);
const rootDir = mkdtempSync(join(tmpdir(), 'cdk-migrate-it-'));

try {
  const basicPack = makeBasicPack(rootDir);
  const programPack = makeProgramPack(rootDir);

  // --- dry-run performs ZERO writes (full-tree snapshot byte-equal) ---
  const before = snapshotTree(rootDir);
  const dryProgram = migrate.migrateDryRun(programPack);
  migrate.migrateDryRun(basicPack);
  const after = snapshotTree(rootDir);
  snapshotsEqual(before, after)
    ? rep.ok('dry-run performed zero writes (tree snapshot byte-identical)')
    : rep.bad('dry-run mutated the pack tree (snapshot changed)');
  dryProgram.preview.includes('dry-run wrote nothing')
    ? rep.ok('dry-run preview is explicit about writing nothing')
    : rep.bad('dry-run preview missing the no-write note');

  // --- Basic pack migrates: plan inferred + validates on apply ---
  const basicResult = migrate.migrateApply(basicPack, { now: NOW, force: true });
  basicResult.applied ? rep.ok('Basic pack apply succeeded (plan inferred + validated)') : rep.bad(`Basic apply failed: ${basicResult.reason}`);
  const basicPlanRaw = JSON.parse(readFileSync(join(basicPack, 'workflow-plan.json'), 'utf-8'));
  basicPlanRaw.profile === 'basic' && basicPlanRaw.waves.length === 1
    ? rep.ok('Basic plan: single synthesized wave, basic profile')
    : rep.bad(`Basic plan unexpected: profile=${basicPlanRaw.profile} waves=${basicPlanRaw.waves.length}`);

  // --- Program/wave pack infers MULTIPLE waves ---
  const programPlan = migrate.migrationPlan(programPack);
  const programWaveIds = programPlan.inferredWaves.map((wave) => wave.id);
  programWaveIds.length >= 3 && programWaveIds.includes('W0') && programWaveIds.includes('W2')
    ? rep.ok(`Program pack inferred multiple waves: ${programWaveIds.join(', ')}`)
    : rep.bad(`Program pack waves wrong: ${programWaveIds.join(', ')}`);
  programPlan.inferredProfile === 'program'
    ? rep.ok('Program pack inferred the "program" profile')
    : rep.bad(`Program profile wrong: ${programPlan.inferredProfile}`);
  programPlan.extractedTasks.length >= 4
    ? rep.ok(`Program pack extracted ${programPlan.extractedTasks.length} wave-y tasks`)
    : rep.bad(`Program pack extracted too few tasks: ${programPlan.extractedTasks.length}`);

  // --- contradiction surfaced (carried, not resolved) ---
  programPlan.ambiguities.length > 0
    ? rep.ok(`contradiction surfaced as ${programPlan.ambiguities.length} carried ambiguity(ies)`)
    : rep.bad('expected the index-vs-narrative contradiction to be surfaced');

  // --- apply inserts a managed block + preserves human prose ---
  const programApply = migrate.migrateApply(programPack, { now: NOW, force: true });
  const programTasks = readFileSync(join(programPack, 'tasks.md'), 'utf-8');
  programTasks.includes('contextdevkit:generated:tasks:start') && programTasks.includes('Migrated task projection')
    ? rep.ok('apply inserted the managed tasks block')
    : rep.bad('managed tasks block was not inserted');
  programTasks.includes('Important human notes. Keep this paragraph.')
    ? rep.ok('human prose outside the managed block was preserved')
    : rep.bad('human prose was lost during apply');

  // --- second apply is idempotent (no further change) ---
  const treeAfterFirst = snapshotTree(programPack);
  const secondApply = migrate.migrateApply(programPack, { now: NOW, force: true });
  const treeAfterSecond = snapshotTree(programPack);
  secondApply.applied && snapshotsEqual(treeAfterFirst, treeAfterSecond)
    ? rep.ok('second apply is idempotent (no further change)')
    : rep.bad('second apply changed the pack (not idempotent)');

  // --- receipt present + lists changes ---
  const receiptPath = join(programPack, 'reports', 'migration-receipt.json');
  const receipt = JSON.parse(readFileSync(receiptPath, 'utf-8'));
  receipt.appliedAt === NOW && Array.isArray(receipt.changes) && receipt.waveCount >= 3
    ? rep.ok('migration receipt written with injected timestamp + change list')
    : rep.bad(`receipt malformed: ${JSON.stringify(receipt).slice(0, 120)}`);
  Array.isArray(receipt.carriedAmbiguities) && receipt.carriedAmbiguities.length > 0
    ? rep.ok('receipt records the carried ambiguities')
    : rep.bad('receipt did not record carried ambiguities');
  void programApply;

  // --- non-destructive default: apply without force refuses + writes nothing ---
  const cleanPack = makeBasicPack(join(rootDir, 'noforce'));
  const beforeNoForce = snapshotTree(cleanPack);
  const refused = migrate.migrateApply(cleanPack, { now: NOW });
  const afterNoForce = snapshotTree(cleanPack);
  !refused.applied && snapshotsEqual(beforeNoForce, afterNoForce)
    ? rep.ok('apply without force refuses and writes nothing (non-destructive default)')
    : rep.bad('apply without force was not refused / wrote files');
} finally {
  rmSync(rootDir, { recursive: true, force: true });
}

rep.finish('workflow-migrate');
