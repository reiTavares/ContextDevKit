#!/usr/bin/env node
/**
 * Integration test — registry-backed journey evidence (ADR-0127 Phase 2, first cut).
 *
 * Builds a throwaway contextkit/memory tree (work-context-registry + decision-registry
 * + an owner dir with/without a nested workflow) and asserts gatherRegistryEvidence
 * produces REAL checkpoint verdicts, with honest absence (unknown) vs positive false.
 *
 * Run:  node tools/integration-test-journey-evidence.mjs
 */
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { reporter } from './it-helpers.mjs';

const KIT = dirname(dirname(fileURLToPath(import.meta.url)));
const rep = reporter();
const { ok, bad } = rep;

const load = () => import('file:///' + resolve(KIT, 'templates/contextkit/runtime/work/journey-evidence-registry.mjs').replaceAll('\\', '/'));

function makeTree({ withNestedWorkflow, decisions }) {
  const root = mkdtempSync(join(tmpdir(), 'journey-ev-'));
  const mem = join(root, 'contextkit', 'memory');
  const opPath = 'operations/OP-0005-demo';
  mkdirSync(join(mem, opPath), { recursive: true });
  if (withNestedWorkflow) mkdirSync(join(mem, opPath, 'workflows', '0001-demo-wf'), { recursive: true });
  writeFileSync(join(mem, 'work-context-registry.json'), JSON.stringify({
    schemaVersion: 1, contexts: [{ id: 'OP-0005', type: 'operation', path: opPath, title: 'Demo' }],
  }));
  writeFileSync(join(mem, 'decision-registry.json'), JSON.stringify({ schemaVersion: 2, decisions }));
  return { root, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

async function main() {
  console.log('\n🌀 Integration test — registry-backed journey evidence (ADR-0127)\n');
  const { gatherRegistryEvidence } = await load();

  // A. Known owner + accepted governing ADR + nested workflow + unique ids.
  {
    const { root, cleanup } = makeTree({
      withNestedWorkflow: true,
      decisions: [
        { id: 'ADR-0125', status: 'accepted', governs: { operations: ['OP-0005'] }, primaryContext: null },
        { id: 'ADR-0126', status: 'accepted', governs: { operations: ['OP-0005'] }, primaryContext: null },
      ],
    });
    try {
      const ev = gatherRegistryEvidence(root, 'OP-0005');
      ev.ownerContextExists === true ? ok('A: ownerContextExists true for a registered id') : bad(`A: ownerContextExists wrong: ${JSON.stringify(ev)}`);
      ev.workflowExists === true && ev.workflowNestedUnderOwner === true ? ok('A: nested workflow → workflowExists + workflowNestedUnderOwner true') : bad('A: nested-workflow verdict wrong');
      ev.governingAdrAccepted === true ? ok('A: accepted ADR governing the owner → governingAdrAccepted true') : bad('A: governingAdrAccepted wrong');
      ev.adrNumberContiguous === true ? ok('A: unique ADR numbers → adrNumberContiguous true') : bad('A: adrNumberContiguous wrong');
    } finally { cleanup(); }
  }

  // B. Unknown id → ownerContextExists false; no governing ADR → false.
  {
    const { root, cleanup } = makeTree({ withNestedWorkflow: false, decisions: [{ id: 'ADR-0125', status: 'proposed', governs: { operations: ['OP-0005'] } }] });
    try {
      const ev = gatherRegistryEvidence(root, 'OP-9999');
      ev.ownerContextExists === false ? ok('B: ownerContextExists false for an unregistered id') : bad('B: ownerContextExists should be false');
      ev.governingAdrAccepted === false ? ok('B: only a PROPOSED ADR → governingAdrAccepted false') : bad('B: governingAdrAccepted should be false (proposed)');
      !('workflowNestedUnderOwner' in ev) ? ok('B: no nested workflow → workflowNestedUnderOwner ABSENT (unknown, not false)') : bad('B: absence should stay unknown, never false in first cut');
    } finally { cleanup(); }
  }

  // C. Duplicate ADR numbers (a forked "new wrong series") → adrNumberContiguous false.
  {
    const { root, cleanup } = makeTree({ withNestedWorkflow: false, decisions: [{ id: 'ADR-0001', status: 'accepted' }, { id: 'ADR-0001', status: 'accepted' }] });
    try {
      const ev = gatherRegistryEvidence(root, 'OP-0005');
      ev.adrNumberContiguous === false ? ok('C: duplicate ADR ids → adrNumberContiguous false (catches a forked series)') : bad('C: duplicate ids should fail contiguity');
    } finally { cleanup(); }
  }

  // D. Missing registries → fail-open empty evidence (all unknown).
  {
    const root = mkdtempSync(join(tmpdir(), 'journey-ev-bare-'));
    mkdirSync(join(root, 'contextkit', 'memory'), { recursive: true });
    try {
      const ev = gatherRegistryEvidence(root, 'OP-0005');
      Object.keys(ev).length === 0 ? ok('D: missing registries → empty evidence (fail-open, all unknown)') : bad(`D: expected empty; got ${JSON.stringify(ev)}`);
    } finally { rmSync(root, { recursive: true, force: true }); }
  }

  rep.finish('registry-backed journey evidence (ADR-0127)');
}

main();
