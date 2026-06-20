/**
 * B4-T2 integration test — Installer propagation + updater-safety for the B4
 * decision-subtree seeds (BIZ-0001 / WF-0037, ADR-0102).
 *
 * Scenarios verified:
 *   A. FRESH INSTALL — the 7 new decision-subtree files are seeded into a fresh
 *      project (write-if-missing semantics, all paths under contextkit/memory/).
 *   B. UPDATER-SAFETY — re-running `--update` on an existing project where the
 *      user has edited one of the new seed files does NOT overwrite it; the
 *      user's edit survives (ADR-0099 P0-05 / writeIfMissing contract).
 *   C. LEGACY COEXISTENCE — after a fresh install, `buildDecisionRegistry` can
 *      still index a legacy NNNN-slug.md placed at the decisions/ root alongside
 *      the new subtree (dual-resolution, compatibility-plan §"Dual resolution").
 *   D. SEED IDEMPOTENCY — seeding the same project twice leaves the seed files
 *      byte-identical (content unchanged on second run).
 *
 * Runs against the REAL installer (`install.mjs --target <tmp>`). Exits 0 on
 * all-pass, 1 on any failure. Self-cleaning; no network.
 */
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { KIT, run, git, reporter } from './it-helpers.mjs';

const rep = reporter();
const read = (p) => readFileSync(p, 'utf-8');
const tmp = () => mkdtempSync(join(tmpdir(), 'contextkit-b4bdm-'));

/**
 * Install the kit into a throwaway git-init project at `proj`.
 * @param {string} proj absolute path to temp dir
 * @param {string[]} [extra] extra CLI flags
 * @returns {{ status: number, stdout: string, stderr: string }}
 */
function freshInstall(proj, extra = []) {
  git(['init', '-b', 'main'], proj);
  git(['config', 'user.email', 'it@example.com'], proj);
  git(['config', 'user.name', 'IT'], proj);
  return run([
    join(KIT, 'install.mjs'),
    '--target', proj,
    '--level', '5',
    '--name', 'B4TestApp',
    '--yes',
    ...extra,
  ]);
}

/** Run `--update` on an existing install. */
const update = (proj) =>
  run([join(KIT, 'install.mjs'), '--target', proj, '--update']);

// ---------------------------------------------------------------------------
// The 7 new seed paths (relative to <project>/contextkit/).
// These must all exist after a fresh install.
// ---------------------------------------------------------------------------
const NEW_SEEDS = [
  'memory/decisions/business/README.md',
  'memory/decisions/operations/README.md',
  'memory/decisions/legacy/README.md',
  'memory/decisions/_templates/adr-business.template.md',
  'memory/decisions/_templates/adr-operation.template.md',
  'memory/decisions/_templates/adr-routine-operation-governance.template.md',
  'memory/decisions/_templates/adr-emergency-governance.template.md',
];

// ===========================================================================
// A. FRESH INSTALL — all 7 new seeds present
// ===========================================================================
await (async () => {
  const proj = tmp();
  try {
    const inst = freshInstall(proj);
    inst.status === 0
      ? rep.ok('A: fresh install exits 0')
      : rep.bad(`A: install failed (status ${inst.status}): ${inst.stderr?.slice(0, 200)}`);

    for (const rel of NEW_SEEDS) {
      const abs = join(proj, 'contextkit', rel);
      existsSync(abs)
        ? rep.ok(`A: seeded contextkit/${rel}`)
        : rep.bad(`A: MISSING contextkit/${rel}`);
    }
  } finally {
    rmSync(proj, { recursive: true, force: true });
  }
})();

// ===========================================================================
// B. UPDATER-SAFETY — user edits survive --update
// ===========================================================================
await (async () => {
  const proj = tmp();
  try {
    const inst = freshInstall(proj);
    if (inst.status !== 0) {
      rep.bad(`B: initial install failed — cannot test updater-safety: ${inst.stderr?.slice(0, 200)}`);
      return;
    }

    // Pick one of the new seeds and simulate user customisation.
    const targetRel = 'memory/decisions/business/README.md';
    const targetAbs = join(proj, 'contextkit', targetRel);
    const USER_EDIT = '# My custom business decisions index\n\nUser-authored content.\n';

    if (!existsSync(targetAbs)) {
      // Seed absent — means MEMORY_SEEDS proposal not yet applied by orchestrator.
      // Create the file manually so updater-safety can still be tested in isolation.
      mkdirSync(dirname(targetAbs), { recursive: true });
    }
    writeFileSync(targetAbs, USER_EDIT, 'utf-8');

    const upd = update(proj);
    upd.status === 0
      ? rep.ok('B: --update exits 0')
      : rep.bad(`B: --update failed (status ${upd.status}): ${upd.stderr?.slice(0, 200)}`);

    const afterUpdate = read(targetAbs);
    afterUpdate === USER_EDIT
      ? rep.ok('B: user edit preserved across --update (writeIfMissing holds)')
      : rep.bad('B: --update overwrote user edit in business/README.md (writeIfMissing broken)');
  } finally {
    rmSync(proj, { recursive: true, force: true });
  }
})();

// ===========================================================================
// C. LEGACY COEXISTENCE — registry indexes legacy ADR alongside new subtree
// ===========================================================================
await (async () => {
  const proj = tmp();
  try {
    const inst = freshInstall(proj);
    if (inst.status !== 0) {
      rep.bad(`C: initial install failed — cannot test coexistence: ${inst.stderr?.slice(0, 200)}`);
      return;
    }

    // Place a legacy-format ADR at the decisions/ top level.
    const legacyAdr = join(proj, 'contextkit', 'memory', 'decisions', '0042-my-legacy-decision.md');
    mkdirSync(dirname(legacyAdr), { recursive: true });
    writeFileSync(legacyAdr, `# ADR-0042 — My legacy decision\n\n- **Status**: Accepted\n- **Date**: 2026-06-20\n\n## Decision\nLegacy plain-markdown, no front-matter.\n`, 'utf-8');

    // Import decision registry from the kit source (not installed copy) so this
    // test has no dependency on the install having put scripts in place.
    const { buildDecisionRegistry } = await import(
      '../templates/contextkit/tools/scripts/registry/decision.mjs'
    );
    const registry = buildDecisionRegistry(proj);
    const legacyRow = registry.decisions.find((r) => r.id === 'ADR-0042');

    legacyRow !== undefined
      ? rep.ok('C: legacy ADR-0042 indexed by buildDecisionRegistry')
      : rep.bad('C: legacy ADR-0042 NOT found in registry (coexistence broken)');

    legacyRow?.format === 'legacy'
      ? rep.ok('C: ADR-0042 row has format:legacy')
      : rep.bad(`C: ADR-0042 row format is ${legacyRow?.format} (expected legacy)`);

    // Confirm new-subdirectory READMEs are NOT mistaken for decision rows.
    const readmeRows = registry.decisions.filter(
      (r) => r.file && r.file.toLowerCase().includes('readme'),
    );
    readmeRows.length === 0
      ? rep.ok('C: README.md files not indexed as decision rows')
      : rep.bad(`C: ${readmeRows.length} README row(s) leaked into registry`);
  } finally {
    rmSync(proj, { recursive: true, force: true });
  }
})();

// ===========================================================================
// D. SEED IDEMPOTENCY — second install leaves seeds byte-identical
// ===========================================================================
await (async () => {
  const proj = tmp();
  try {
    const inst1 = freshInstall(proj);
    if (inst1.status !== 0) {
      rep.bad(`D: initial install failed: ${inst1.stderr?.slice(0, 200)}`);
      return;
    }

    // Capture content of one seed before second run.
    const sampleRel = 'memory/decisions/_templates/adr-business.template.md';
    const sampleAbs = join(proj, 'contextkit', sampleRel);
    const before = existsSync(sampleAbs) ? read(sampleAbs) : null;

    if (before === null) {
      rep.bad('D: sample seed absent before second install — cannot test idempotency');
      return;
    }

    const upd = update(proj);
    upd.status === 0
      ? rep.ok('D: second install (--update) exits 0')
      : rep.bad(`D: second install failed (status ${upd.status}): ${upd.stderr?.slice(0, 200)}`);

    const after = read(sampleAbs);
    after === before
      ? rep.ok('D: adr-business.template.md byte-identical after second install')
      : rep.bad('D: seed content changed on second install (idempotency violation)');
  } finally {
    rmSync(proj, { recursive: true, force: true });
  }
})();

// ---------------------------------------------------------------------------
rep.finish('B4-T2 installer-propagation + updater-safety');
