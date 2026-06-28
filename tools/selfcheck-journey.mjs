#!/usr/bin/env node
/**
 * Selfcheck — methodology journey map + verifier (ADR-0127, Phase 2 first cut).
 *
 * Locks two things:
 *   1. policy/journey.json integrity — valid JSON, every branch stage resolves to a
 *      defined stage, every stage carries id/requires, enforcement block present.
 *   2. The pure verifier (journey-verifier.mjs) — branch selection + stage verdicts
 *      (satisfied / pending on unknown / blocked on false) + current-stage/next-command.
 *
 * Run:  node tools/selfcheck-journey.mjs
 */
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { reporter } from './it-helpers.mjs';

const KIT = dirname(dirname(fileURLToPath(import.meta.url)));
const rep = reporter();
const { ok, bad } = rep;

const load = (rel) => import('file:///' + resolve(KIT, rel).replaceAll('\\', '/'));

async function main() {
  console.log('\n🌀 Selfcheck — methodology journey map + verifier (ADR-0127)\n');

  // ── 1. journey.json integrity ──────────────────────────────────────────────
  let journey;
  try {
    journey = JSON.parse(readFileSync(resolve(KIT, 'templates/contextkit/policy/journey.json'), 'utf8'));
    ok('policy/journey.json is valid JSON');
  } catch (err) {
    bad(`journey.json unreadable/invalid: ${err?.message ?? err}`);
    rep.finish('methodology journey map + verifier');
    return;
  }

  const stageIds = new Set((journey.stages || []).map((s) => s.id));
  const branches = Object.entries(journey.branches || {});
  branches.length >= 3 ? ok(`journey defines ${branches.length} branches`) : bad('expected ≥3 branches');

  let danglingFound = false;
  for (const [branch, seq] of branches) {
    for (const stageId of seq) if (!stageIds.has(stageId)) { bad(`branch "${branch}" references missing stage "${stageId}"`); danglingFound = true; }
  }
  if (!danglingFound) ok('every branch stage resolves to a defined stage (referential integrity)');

  const wellFormed = (journey.stages || []).every((s) => s.id && Array.isArray(s.requires) && typeof s.checkpoint === 'string');
  wellFormed ? ok('every stage carries id + requires[] + checkpoint') : bad('a stage is missing id/requires/checkpoint');

  journey.enforcement && typeof journey.enforcement.mode === 'string'
    ? ok(`enforcement block present (first cut mode: ${journey.enforcement.mode})`)
    : bad('enforcement block missing');

  // ── 2. the pure verifier ───────────────────────────────────────────────────
  const { selectBranch, verifyJourney } = await load('templates/contextkit/runtime/work/journey-verifier.mjs');

  selectBranch({ nature: 'business' }) === 'business-decision'
    && selectBranch({ nature: 'operation', executionMode: 'workflow' }) === 'operation-workflow'
    && selectBranch({ nature: 'operation', executionMode: 'direct' }) === 'operation-direct'
    && selectBranch({}) === null
    ? ok('selectBranch maps nature+ceremony correctly (and null when unknown)')
    : bad('selectBranch mapping is wrong');

  // All-satisfied evidence → current stage advances to the end (null next).
  const allTrue = {};
  for (const s of journey.stages) for (const c of s.requires) allTrue[c] = true;
  const done = verifyJourney(journey, 'operation-direct', allTrue);
  done && done.currentStageId === null && done.blocked.length === 0
    ? ok('verifier: all-satisfied evidence → no current stage, no blocks')
    : bad(`verifier: expected complete journey; got ${JSON.stringify(done && { cur: done.currentStageId, blocked: done.blocked.length })}`);

  // Empty evidence → first stage is current (pending), nextCommand present.
  const fresh = verifyJourney(journey, 'operation-workflow', {});
  fresh && fresh.currentStageId === 'intake' && fresh.nextCommand
    ? ok('verifier: empty evidence → current stage is "intake" with a next command')
    : bad(`verifier: expected intake-as-current; got ${JSON.stringify(fresh && fresh.currentStageId)}`);

  // A false checkpoint → that stage is blocked.
  const blockedEv = { ...allTrue, workflowNestedUnderOwner: false };
  const blk = verifyJourney(journey, 'operation-workflow', blockedEv);
  blk && blk.blocked.some((s) => s.id === 'workflow-nested' && s.unmet.includes('workflowNestedUnderOwner'))
    ? ok('verifier: a false checkpoint blocks its stage (workflow-nested)')
    : bad('verifier: false checkpoint did not block the stage');

  // Unknown (null) checkpoint → pending, not satisfied, not blocked.
  const unknownEv = { ...allTrue, testsGreen: null };
  const unk = verifyJourney(journey, 'operation-workflow', unknownEv);
  const testsStage = unk && unk.stages.find((s) => s.id === 'tests');
  testsStage && testsStage.state === 'pending' && unk.blocked.every((s) => s.id !== 'tests')
    ? ok('verifier: an unknown checkpoint is pending (graceful degradation, never silently passed)')
    : bad('verifier: unknown checkpoint mishandled');

  verifyJourney(journey, 'no-such-branch', {}) === null
    ? ok('verifier: unknown branch → null (defensive)')
    : bad('verifier: unknown branch should return null');

  rep.finish('methodology journey map + verifier (ADR-0127)');
}

main();
