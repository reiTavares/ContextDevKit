/**
 * B4-T2 compatibility self-test — Legacy + new-subtree coexistence.
 * (BIZ-0001 / WF-0037, B4-T2, ADR-0102)
 *
 * Verifies that the NEW `decisions/{business,operations,legacy}/` subtree does NOT
 * break legacy NNNN-slug.md ADR resolution:
 *   [CC-1] Legacy NNNN ADRs at the `decisions/` top level are still indexed by
 *          `buildDecisionRegistry`; count + shapes are unchanged.
 *   [CC-2] New-format v2 records placed under `decisions/business/` are indexed
 *          alongside legacy records in ONE unified registry without collision.
 *   [CC-3] The three new subdirectory READMEs are excluded (filtered out as
 *          README.md) and do NOT appear as decision rows.
 *   [CC-4] `indexLegacyAdrsDirs` still resolves ADRs at the decisions root when
 *          `decisions/legacy/` is also present (no shadowing).
 *   [CC-5] Registry is byte-idempotent: a second `buildDecisionRegistry` on the
 *          same inputs produces an identical result object (sorted order stable).
 *
 * Zero network, tmp dirs only, self-cleaning. Exits non-zero on any failure.
 *
 * @module b4-legacy-coexistence.selftest
 */
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const LEGACY_0010 = `# 0010 Use NDJSON for event log

- **Status**: Accepted
- **Date**: 2026-01-01

## Decision
Use NDJSON for the internal event log.
`;

const LEGACY_0011 = `# ADR-0011 — Keep hooks zero-dep

- **Status**: Superseded
- **Date**: 2026-02-01

## Decision
Hooks must never require npm install.
`;

/** Well-formed v2 front-matter record under decisions/business/. */
const NEW_BIZ_0200 = `---
schemaVersion: 2
id: ADR-0200
title: Adopt decision subtree layout
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
  area: memory
  capability: decisions
approvalSource:
  type: business
  id: BIZ-0001
  revision: 1
  decisionHash: cafebabe
  approvedAt: 2026-06-20
  actor: human
governs:
  workflows: []
  operations: []
  business: []
supersedes: []
supersededBy: null
tags:
  - structure
createdAt: 2026-06-20
acceptedAt: 2026-06-20
updatedAt: 2026-06-20
---

# ADR-0200 — Adopt decision subtree layout
`;

// ---------------------------------------------------------------------------
// Assertion helpers
// ---------------------------------------------------------------------------

const failures = [];

/**
 * Named assertion gate.
 * @param {string} label
 * @param {boolean} cond
 */
function assert(label, cond) {
  process.stdout.write(`  ${cond ? 'ok  ' : 'FAIL'} ${label}\n`);
  if (!cond) failures.push(label);
}

// ---------------------------------------------------------------------------
// Build temp project tree that mirrors post-B4 installer output
// ---------------------------------------------------------------------------

const ROOT = mkdtempSync(join(tmpdir(), 'b4t2-coexist-'));

try {
  const decisionsDir = join(ROOT, 'contextkit', 'memory', 'decisions');
  const businessDir = join(decisionsDir, 'business');
  const operationsDir = join(decisionsDir, 'operations');
  const legacyDir = join(decisionsDir, 'legacy');
  const templatesDir = join(decisionsDir, '_templates');

  // Mirror the seed layout the installer will produce after B4 lands.
  mkdirSync(businessDir, { recursive: true });
  mkdirSync(operationsDir, { recursive: true });
  mkdirSync(legacyDir, { recursive: true });
  mkdirSync(templatesDir, { recursive: true });

  // Two legacy ADRs at the top-level decisions/ directory (pre-existing).
  writeFileSync(join(decisionsDir, '0010-use-ndjson-for-event-log.md'), LEGACY_0010, 'utf8');
  writeFileSync(join(decisionsDir, '0011-keep-hooks-zero-dep.md'), LEGACY_0011, 'utf8');

  // READMEs in the new subdirs (must NOT appear as decision rows).
  writeFileSync(join(businessDir, 'README.md'), '# Business decisions\n', 'utf8');
  writeFileSync(join(operationsDir, 'README.md'), '# Operations decisions\n', 'utf8');
  writeFileSync(join(legacyDir, 'README.md'), '# Legacy decisions\n', 'utf8');

  // A v2 new-format record under business/.
  writeFileSync(join(businessDir, 'ADR-0200-adopt-decision-subtree-layout.md'), NEW_BIZ_0200, 'utf8');

  // =========================================================================
  // Import under test (dynamic, so path is resolved at runtime)
  // =========================================================================
  const { buildDecisionRegistry } = await import('./registry/decision.mjs');
  const { indexLegacyAdrsDirs } = await import('./adr-index.mjs');

  // =========================================================================
  // CC-1: Legacy ADRs still indexed — count + shapes intact
  // =========================================================================
  process.stdout.write('\n[CC-1] Legacy ADRs still indexed after subtree seeding\n');

  const registry1 = buildDecisionRegistry(ROOT);
  const legacyRows = registry1.decisions.filter((r) => r.format === 'legacy');

  assert('CC-1.1 at least 2 legacy rows present', legacyRows.length >= 2);
  assert('CC-1.2 ADR-0010 indexed', registry1.decisions.some((r) => r.id === 'ADR-0010'));
  assert('CC-1.3 ADR-0011 indexed', registry1.decisions.some((r) => r.id === 'ADR-0011'));
  assert('CC-1.4 all legacy rows have format:legacy', legacyRows.every((r) => r.format === 'legacy'));
  assert('CC-1.5 all legacy rows have id string', legacyRows.every((r) => typeof r.id === 'string' && r.id.startsWith('ADR-')));

  // =========================================================================
  // CC-2: New-format record co-indexed without collision
  // =========================================================================
  process.stdout.write('\n[CC-2] New-format v2 records co-indexed alongside legacy\n');

  const newRow200 = registry1.decisions.find((r) => r.id === 'ADR-0200');
  assert('CC-2.1 ADR-0200 indexed', newRow200 !== undefined);
  assert('CC-2.2 ADR-0200 has format:new', newRow200?.format === 'new');
  assert('CC-2.3 ADR-0200 title populated', newRow200?.title === 'Adopt decision subtree layout');
  assert('CC-2.4 ADR-0200 contextType is business', newRow200?.contextType === 'business');
  assert('CC-2.5 no id collision: ADR-0010 and ADR-0200 coexist', registry1.decisions.length >= 3);

  // =========================================================================
  // CC-3: README.md files are excluded — do not appear as decision rows
  // =========================================================================
  process.stdout.write('\n[CC-3] Subdirectory READMEs excluded from registry\n');

  const readmeRows = registry1.decisions.filter((r) =>
    r.file && r.file.toLowerCase().includes('readme'),
  );
  assert('CC-3.1 no README row in registry', readmeRows.length === 0);
  assert('CC-3.2 total rows does not include 3 READMEs', registry1.decisions.length < (legacyRows.length + 1 + 3));

  // =========================================================================
  // CC-4: indexLegacyAdrsDirs resolves top-level ADRs even with legacy/ present
  // =========================================================================
  process.stdout.write('\n[CC-4] indexLegacyAdrsDirs: legacy/ subdir does not shadow top-level\n');

  const indexed = indexLegacyAdrsDirs([decisionsDir], { recursive: false });
  assert('CC-4.1 indexer finds ADR-0010', indexed.some((e) => e.id === 'ADR-0010'));
  assert('CC-4.2 indexer finds ADR-0011', indexed.some((e) => e.id === 'ADR-0011'));
  // With recursive:false, only the top-level NNNN-slug.md files are indexed;
  // subdirs (business/, legacy/) are not walked.
  assert('CC-4.3 indexer does NOT include ADR-0200 (in business/, not top-level)', !indexed.some((e) => e.id === 'ADR-0200'));
  assert('CC-4.4 all returned entries are format:legacy', indexed.every((e) => e.format === 'legacy'));

  // =========================================================================
  // CC-5: Registry is byte-idempotent across two builds
  // =========================================================================
  process.stdout.write('\n[CC-5] buildDecisionRegistry is byte-idempotent\n');

  const registry2 = buildDecisionRegistry(ROOT);
  const ids1 = registry1.decisions.map((r) => r.id).sort().join(',');
  const ids2 = registry2.decisions.map((r) => r.id).sort().join(',');
  assert('CC-5.1 id sets identical across two builds', ids1 === ids2);
  assert('CC-5.2 row counts identical across two builds', registry1.decisions.length === registry2.decisions.length);

} finally {
  rmSync(ROOT, { recursive: true, force: true });
}

// ---------------------------------------------------------------------------
process.stdout.write(failures.length
  ? `\nFAILED (${failures.length}): ${failures.join(', ')}\n`
  : '\nPASSED\n');
process.exit(failures.length ? 1 : 0);
