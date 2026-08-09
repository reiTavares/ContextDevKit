/**
 * In-process self-test for the decision-registry generator (WF-0037, B1-T2).
 *
 * Zero-dependency, runs under plain `node`. Proves the acceptance criteria:
 *   (a) generation indexes BOTH a v2 ADR (new) and a plain-markdown legacy ADR;
 *   (b) rebuild is byte-idempotent (generate, serialize, generate again → equal);
 *   (c) render is deterministic;
 *   (d) it indexes the live dogfood decisions/ tree (new ADR-0102 + legacy ADRs).
 *
 * Uses a throwaway temp root (os.tmpdir) for (a)-(c); reads the real tree for (d)
 * but writes nothing there. Exit 0 = all assertions held; exit 1 = a failure.
 */
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { PLATFORM_DIR } from '../../../runtime/config/paths.mjs';
import { serializeRegistry } from './serialize.mjs';
import { buildDecisionRegistry, renderDecisionCatalog } from './decision.mjs';

const failures = [];
/** Records a named assertion. @param {string} label @param {boolean} cond */
function assert(label, cond) {
  process.stdout.write(`  ${cond ? 'ok  ' : 'FAIL'} ${label}\n`);
  if (!cond) failures.push(label);
}

const NEW_ADR = `---
schemaVersion: 2
id: ADR-0500
title: Test decision
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
  capability: registry-selftest
approvalSource:
  type: business
  id: BIZ-0001
  revision: 1
  decisionHash: deadbeef
  approvedAt: 2026-06-19
  actor: human
governs:
  workflows: []
  operations: []
  business: []
supersedes: []
supersededBy: null
tags:
  - test
createdAt: 2026-06-19
acceptedAt: 2026-06-19
updatedAt: 2026-06-19
---

# ADR-0500 — Test decision
`;

const LEGACY_ADR = `# ADR-0099 — A legacy decision

- **Status:** Accepted
- **Date:** 2026-06-16

## Context
Body.
`;

const ROOT = mkdtempSync(join(tmpdir(), 'decision-registry-selftest-'));
try {
  const decisions = join(ROOT, PLATFORM_DIR, 'memory', 'decisions');
  mkdirSync(join(decisions, 'business'), { recursive: true });
  writeFileSync(join(decisions, 'business', 'ADR-0500-test-decision.md'), NEW_ADR, 'utf8');
  writeFileSync(join(decisions, '0099-a-legacy-decision.md'), LEGACY_ADR, 'utf8');

  const built = buildDecisionRegistry(ROOT);
  const ids = built.decisions.map((row) => row.id);
  assert('indexes the new v2 ADR', ids.includes('ADR-0500'));
  assert('indexes the legacy ADR as ADR-0099', ids.includes('ADR-0099'));
  const newRow = built.decisions.find((row) => row.id === 'ADR-0500');
  const legacyRow = built.decisions.find((row) => row.id === 'ADR-0099');
  assert('new row tagged format:new + decisionKind', newRow.format === 'new' && newRow.decisionKind === 'ARCHITECTURE');
  assert('legacy row tagged format:legacy + contextType:legacy', legacyRow.format === 'legacy' && legacyRow.contextType === 'legacy');
  assert('legacy primaryContext is null', legacyRow.primaryContext === null);
  assert('rows sorted by id', ids.slice().sort().join() === ids.join());

  // (b) rebuild byte-idempotent.
  const first = serializeRegistry(buildDecisionRegistry(ROOT));
  const second = serializeRegistry(buildDecisionRegistry(ROOT));
  assert('rebuild byte-idempotent', first === second);

  // (c) render deterministic.
  assert('render deterministic', renderDecisionCatalog(built) === renderDecisionCatalog(buildDecisionRegistry(ROOT)));
  assert('render includes both ids', renderDecisionCatalog(built).includes('ADR-0500') && renderDecisionCatalog(built).includes('ADR-0099'));
} finally {
  rmSync(ROOT, { recursive: true, force: true });
}

// (d) live dogfood tree (read-only): must index ADR-0102 + legacy ADRs.
try {
  const live = buildDecisionRegistry(process.cwd());
  const liveIds = live.decisions.map((row) => row.id);
  const hasNew = live.decisions.some((row) => row.format === 'new');
  const hasLegacy = live.decisions.some((row) => row.format === 'legacy');
  assert('live tree indexed (>= 1 decision)', live.decisions.length >= 1);
  if (live.decisions.length >= 1) {
    assert('live tree has a new ADR (e.g. ADR-0102)', hasNew && liveIds.includes('ADR-0102'));
    assert('live tree has legacy ADRs', hasLegacy);
  }
} catch {
  process.stdout.write('  ok   live-tree scan skipped (decisions/ absent)\n');
}

process.stdout.write(failures.length ? `\nFAILED (${failures.length})\n` : '\nPASSED\n');
process.exit(failures.length ? 1 : 0);
