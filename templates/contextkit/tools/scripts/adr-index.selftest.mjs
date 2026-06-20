/**
 * Self-test for B4-T1 ADR tooling (BIZ-0001 / WF-0037).
 *
 * Acceptance criteria verified:
 *  [AC-1] Legacy NNNN ADRs resolve unchanged — indexer reads; files stay intact.
 *  [AC-2] Migration dry-run produces a receipt and applies NOTHING by default.
 *  [AC-3] ref-impact + collision are reported in the pipeline result.
 *  [AC-4] Anti-redundancy flags duplicates; never modifies files.
 *  [AC-5] newRow enrichment: title + valueIntents populated from front-matter.
 *
 * Runs in-process, no network, temp dirs only. Exits non-zero on any failure.
 */
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';

// --- helpers ----------------------------------------------------------------

const failures = [];
/**
 * Named assertion.
 * @param {string}  label
 * @param {boolean} cond
 */
function assert(label, cond) {
  process.stdout.write(`  ${cond ? 'ok  ' : 'FAIL'} ${label}\n`);
  if (!cond) failures.push(label);
}

/** Hash a file's contents; cheap byte-equality check without reading back. */
function hashFile(filePath) {
  try {
    return createHash('sha256').update(readFileSync(filePath)).digest('hex');
  } catch {
    return null;
  }
}

// --- fixtures ---------------------------------------------------------------

const LEGACY_ADR_0099 = `# ADR-0099 — A legacy test decision

- **Status**: Accepted
- **Date**: 2026-06-20

## Context
Legacy plain-markdown ADR with no front matter.

## Decision
Use legacy format.
`;

const LEGACY_ADR_0001 = `# ADR-0001 — Another legacy ADR

- **Status:** Proposed
- **Date:** 2026-06-19

## Decision
Duplicate of another ADR to test redundancy detection.
`;

const LEGACY_ADR_0002 = `# ADR-0002 — Another legacy ADR duplicate test

- **Status:** Proposed
- **Date:** 2026-06-19

## Decision
Very similar title to trigger Jaccard overlap.
`;

const NEW_ADR_0500 = `---
schemaVersion: 2
id: ADR-0500
title: Test Decision Platform
status: accepted
contextType: business
primaryContext:
  type: business
  id: BIZ-0001
relatedContexts: []
decisionKind: ARCHITECTURE
decisionScope: platform
valueIntents:
  primary: ENABLE
  secondary: []
product:
  productId: contextdevkit
  area: test
  capability: selftest
approvalSource:
  type: business
  id: BIZ-0001
  revision: 1
  decisionHash: deadbeef
  approvedAt: 2026-06-20
  actor: human
governs:
  workflows: []
  operations: []
  business: []
supersedes: []
supersededBy: null
tags:
  - test
createdAt: 2026-06-20
acceptedAt: 2026-06-20
updatedAt: 2026-06-20
---

# ADR-0500 — Test Decision Platform
`;

// --- build temp project root ------------------------------------------------

const ROOT = mkdtempSync(join(tmpdir(), 'b4-t1-selftest-'));

try {
  const decisionsDir = join(ROOT, 'contextkit', 'memory', 'decisions');
  const businessDir = join(decisionsDir, 'business');
  mkdirSync(businessDir, { recursive: true });

  const legacy0099 = join(decisionsDir, '0099-a-legacy-decision.md');
  const legacy0001 = join(decisionsDir, '0001-another-legacy-adr.md');
  const legacy0002 = join(decisionsDir, '0002-another-legacy-adr-duplicate.md');
  const newAdr0500 = join(businessDir, 'ADR-0500-test-decision-platform.md');

  writeFileSync(legacy0099, LEGACY_ADR_0099, 'utf8');
  writeFileSync(legacy0001, LEGACY_ADR_0001, 'utf8');
  writeFileSync(legacy0002, LEGACY_ADR_0002, 'utf8');
  writeFileSync(newAdr0500, NEW_ADR_0500, 'utf8');

  // Record byte hashes BEFORE any tool runs (for tamper-detect assertions).
  const hashBefore0099 = hashFile(legacy0099);
  const hashBefore0001 = hashFile(legacy0001);
  const hashBefore0002 = hashFile(legacy0002);

  // =========================================================================
  // AC-1: Legacy ADRs resolve unchanged (index reads, files never written)
  // =========================================================================
  process.stdout.write('\n[AC-1] Legacy ADR indexing — files untouched\n');

  const { indexLegacyAdrsDirs } = await import('./adr-index.mjs');
  const entries = indexLegacyAdrsDirs([decisionsDir], { recursive: false });

  assert('AC-1.1 indexes ADR-0099', entries.some((e) => e.id === 'ADR-0099'));
  assert('AC-1.2 indexes ADR-0001', entries.some((e) => e.id === 'ADR-0001'));
  assert('AC-1.3 format:legacy on every entry', entries.every((e) => e.format === 'legacy'));
  assert('AC-1.4 title extracted from 0099', entries.find((e) => e.id === 'ADR-0099')?.title === 'A legacy test decision');
  assert('AC-1.5 status extracted from 0099', entries.find((e) => e.id === 'ADR-0099')?.status === 'Accepted');

  // Byte-equality: files must be IDENTICAL to before the index run.
  assert('AC-1.6 0099 bytes unchanged after index', hashFile(legacy0099) === hashBefore0099);
  assert('AC-1.7 0001 bytes unchanged after index', hashFile(legacy0001) === hashBefore0001);
  assert('AC-1.8 0002 bytes unchanged after index', hashFile(legacy0002) === hashBefore0002);

  // =========================================================================
  // AC-2: Migration dry-run produces a receipt, applies NOTHING by default
  // =========================================================================
  process.stdout.write('\n[AC-2] Migration dry-run — receipt issued, no writes\n');

  const { planAdrMigration } = await import('./adr-migrate.mjs');

  // Run without opts — default dry-run.
  const dryResult = await planAdrMigration(ROOT, {
    now: '2026-06-20T00:00:00.000Z', // injected for determinism
  });

  assert('AC-2.1 all ADR_PIPELINE_STEPS completed', dryResult.stepsCompleted.length === 9);
  assert('AC-2.2 applied === false', dryResult.applied === false);
  assert('AC-2.3 refused === null (dry-run, not refused)', dryResult.refused === null);
  assert('AC-2.4 receipt object present', dryResult.receipt && typeof dryResult.receipt === 'object');
  assert('AC-2.5 receipt has checksum', typeof dryResult.receipt.checksum === 'string' && dryResult.receipt.checksum.length === 16);
  assert('AC-2.6 receipt.appliedCount === 0', dryResult.receipt.appliedCount === 0);
  assert('AC-2.7 receipt.timestamp injected deterministically', dryResult.receipt.timestamp === '2026-06-20T00:00:00.000Z');

  // Confirm legacy files still untouched after dry-run.
  assert('AC-2.8 0099 bytes unchanged after dry-run', hashFile(legacy0099) === hashBefore0099);
  assert('AC-2.9 0001 bytes unchanged after dry-run', hashFile(legacy0001) === hashBefore0001);

  // Run WITH apply but WITHOUT humanApproved → must be refused, not applied.
  const refusedResult = await planAdrMigration(ROOT, {
    apply: true,
    humanApproved: false,
    moves: [{ from: legacy0099, to: join(ROOT, 'would-move.md'), reason: 'test' }],
    now: '2026-06-20T00:00:00.000Z',
  });
  assert('AC-2.10 refused when humanApproved=false', refusedResult.refused !== null);
  assert('AC-2.11 applied === false when refused', refusedResult.applied === false);
  assert('AC-2.12 source file still exists after refusal', hashFile(legacy0099) === hashBefore0099);

  // =========================================================================
  // AC-3: ref-impact + collision detection reported
  // =========================================================================
  process.stdout.write('\n[AC-3] ref-impact + collision detection\n');

  // Build a move with a source file and verify refImpact is computed.
  const refResult = await planAdrMigration(ROOT, {
    moves: [{ from: legacy0099, to: join(ROOT, 'placeholder-never-written.md'), reason: 'test-ref' }],
    now: '2026-06-20T00:00:00.000Z',
  });

  assert('AC-3.1 refImpact array present', Array.isArray(refResult.refImpact));
  assert('AC-3.2 refImpact has one entry per proposed move', refResult.refImpact.length === refResult.proposed.length);
  assert('AC-3.3 refImpact entry has referenceCount', typeof refResult.refImpact[0]?.referenceCount === 'number');
  assert('AC-3.4 collisions array present', Array.isArray(refResult.collisions));
  assert('AC-3.5 collision step completed', refResult.stepsCompleted.includes('collision'));
  assert('AC-3.6 ref-impact step completed', refResult.stepsCompleted.includes('ref-impact'));

  // =========================================================================
  // AC-4: Anti-redundancy flags duplicates; never modifies files
  // =========================================================================
  process.stdout.write('\n[AC-4] Anti-redundancy — flags duplicates, no file changes\n');

  const { checkAdrRedundancy } = await import('./adr-redundancy.mjs');
  const report = await checkAdrRedundancy(ROOT, { titleThreshold: 0.3 });

  assert('AC-4.1 report has totalRows', typeof report.totalRows === 'number');
  assert('AC-4.2 report has findingCount', typeof report.findingCount === 'number');
  assert('AC-4.3 report has hasRedundancies', typeof report.hasRedundancies === 'boolean');
  assert('AC-4.4 findings is an array', Array.isArray(report.findings));
  // 0001 and 0002 have similar titles ("Another legacy ADR") → should flag title overlap
  assert('AC-4.5 title-overlap detected for 0001/0002', report.findings.some((f) => f.kind === 'title-overlap'));
  assert('AC-4.6 legacyCount >= 3', report.legacyCount >= 3);

  // Files must be unchanged after redundancy scan.
  assert('AC-4.7 0099 bytes unchanged after redundancy check', hashFile(legacy0099) === hashBefore0099);
  assert('AC-4.8 0001 bytes unchanged after redundancy check', hashFile(legacy0001) === hashBefore0001);

  // =========================================================================
  // AC-5: newRow enrichment — title + valueIntents from front-matter
  // =========================================================================
  process.stdout.write('\n[AC-5] newRow enrichment — title + valueIntents populated\n');

  const { buildDecisionRegistry } = await import('./registry/decision.mjs');
  const registry = buildDecisionRegistry(ROOT);
  const newRow500 = registry.decisions.find((r) => r.id === 'ADR-0500');

  assert('AC-5.1 ADR-0500 indexed', newRow500 !== undefined);
  assert('AC-5.2 format:new', newRow500?.format === 'new');
  assert('AC-5.3 title populated from front-matter', newRow500?.title === 'Test Decision Platform');
  assert('AC-5.4 valueIntents populated from front-matter', newRow500?.valueIntents !== null && typeof newRow500?.valueIntents === 'object');
  assert('AC-5.5 valueIntents.primary is ENABLE', newRow500?.valueIntents?.primary === 'ENABLE');
  assert('AC-5.6 valueIntents.secondary is array', Array.isArray(newRow500?.valueIntents?.secondary));

  // Verify legacy rows do NOT get a valueIntents field from newRow path
  // (they go through legacyRow, which is unchanged — title is set there separately).
  const legacyRow = registry.decisions.find((r) => r.id === 'ADR-0099');
  assert('AC-5.7 legacy row still indexed correctly', legacyRow?.format === 'legacy');
  assert('AC-5.8 legacy row has title from parseAdr', typeof legacyRow?.title === 'string');
  assert('AC-5.9 legacy row has no valueIntents field from newRow', !('valueIntents' in (legacyRow ?? {})) || legacyRow?.valueIntents === undefined);

} finally {
  rmSync(ROOT, { recursive: true, force: true });
}

// ---------------------------------------------------------------------------
process.stdout.write(failures.length ? `\nFAILED (${failures.length}): ${failures.join(', ')}\n` : '\nPASSED\n');
process.exit(failures.length ? 1 : 0);
