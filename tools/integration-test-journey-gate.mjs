#!/usr/bin/env node
/**
 * Integration test — journey BLOCKING gate (ADR-0127 Phase 2, second cut).
 *
 * Drives the REAL hook (`journey-gate.mjs`) as a subprocess against hand-built
 * throwaway project trees and asserts the over-block contract HARD: it blocks
 * ONLY a positively-false checkpoint it can evaluate (a loose/central owned
 * workflow, a forked ADR series) and degrades to silence everywhere else
 * (unknown evidence, no entity, fresh install, exempt path, bypass, advisory
 * mode). Over-blocking is the headline risk — most cases here prove NON-block.
 *
 * Run:  node tools/integration-test-journey-gate.mjs
 */
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, copyFileSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { reporter } from './it-helpers.mjs';

const KIT = dirname(dirname(fileURLToPath(import.meta.url)));
const HOOK = resolve(KIT, 'templates/contextkit/runtime/hooks/journey-gate.mjs');
const JOURNEY_SRC = resolve(KIT, 'templates/contextkit/policy/journey.json');
const rep = reporter();
const { ok, bad } = rep;

const TASK = 'task-it-1';
const SID = 'gateit';

/**
 * Materializes a minimal project tree the gate reads (config + journey + the
 * three registries + a saved contract + a session ledger). Every piece is
 * overridable so each case sets exactly the deviation under test.
 */
function makeTree(opts = {}) {
  const {
    work = { nature: 'operation', executionMode: 'workflow', id: 'OP-0005' },
    tier = 'feature',
    decisions = [{ id: 'ADR-0125', status: 'accepted', governs: { operations: ['OP-0005'] } }],
    workflows = [],
    contexts = [{ id: 'OP-0005', type: 'operation', path: 'operations/OP-0005-demo' }],
    enforcementMode = null, // null = keep the shipped journey.json (guarded)
    withJourney = true,
    withContract = true,
    activeTask = TASK,
    simulations = [],
  } = opts;

  const root = mkdtempSync(join(tmpdir(), 'journey-gate-'));
  const mem = join(root, 'contextkit', 'memory');
  mkdirSync(mem, { recursive: true });
  mkdirSync(join(root, 'contextkit', 'policy'), { recursive: true });
  writeFileSync(join(root, 'contextkit', 'config.json'), JSON.stringify({ level: 7 }));

  if (withJourney) {
    if (enforcementMode) {
      const journey = JSON.parse(readFileSync(JOURNEY_SRC, 'utf8'));
      journey.enforcement = { mode: enforcementMode };
      writeFileSync(join(root, 'contextkit', 'policy', 'journey.json'), JSON.stringify(journey));
    } else {
      copyFileSync(JOURNEY_SRC, join(root, 'contextkit', 'policy', 'journey.json'));
    }
  }

  writeFileSync(join(mem, 'work-context-registry.json'), JSON.stringify({ schemaVersion: 1, contexts }));
  writeFileSync(join(mem, 'decision-registry.json'), JSON.stringify({ schemaVersion: 2, decisions }));
  writeFileSync(join(mem, 'workflow-registry.json'), JSON.stringify({ schemaVersion: 1, workflows }));

  if (withContract) {
    const stateDir = join(root, 'contextkit', 'pipeline', 'state', activeTask);
    mkdirSync(stateDir, { recursive: true });
    writeFileSync(join(stateDir, 'execution-contract.json'), JSON.stringify({ version: 1, taskId: activeTask, signals: { work, tier } }));
  }

  const sessDir = join(root, '.claude', '.sessions');
  mkdirSync(sessDir, { recursive: true });
  writeFileSync(join(sessDir, `${SID}.json`), JSON.stringify({ sessionId: SID, activeTask, simulations }));

  return { root, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

/** Runs the gate hook against `root`, returns trimmed stdout. */
function runGate(root, filePath, { sid = SID } = {}) {
  const payload = JSON.stringify({ session_id: sid, tool_name: 'Write', tool_input: { file_path: filePath } });
  const res = spawnSync(process.execPath, [HOOK], { cwd: root, input: payload, encoding: 'utf8' });
  return (res.stdout || '').trim();
}

const isBlock = (out) => out.includes('"decision":"block"');

async function main() {
  console.log('\n🌀 Integration test — journey BLOCKING gate (ADR-0127 second cut)\n');

  // E. Central/loose owned workflow → BLOCK with the corrective command.
  {
    const { root, cleanup } = makeTree({ workflows: [{ id: 'WF-0099', origin: 'OP-0005', owner: null, path: 'workflows/0099-loose' }] });
    try {
      const out = runGate(root, 'src/app.js');
      isBlock(out) && out.includes('workflowNestedUnderOwner') && /workflows\//.test(out)
        ? ok('E: a loose/central owned workflow blocks the write with the corrective command')
        : bad(`E: expected a block naming workflowNestedUnderOwner; got ${JSON.stringify(out).slice(0, 200)}`);
    } finally { cleanup(); }
  }

  // F. Forked/duplicate ADR series → BLOCK on adrNumberContiguous.
  {
    const { root, cleanup } = makeTree({ decisions: [{ id: 'ADR-0125', status: 'accepted', governs: { operations: ['OP-0005'] } }, { id: 'ADR-0125', status: 'accepted' }] });
    try {
      const out = runGate(root, 'src/app.js');
      isBlock(out) && out.includes('adrNumberContiguous')
        ? ok('F: a duplicate/forked ADR series blocks on adrNumberContiguous')
        : bad(`F: expected a block on adrNumberContiguous; got ${JSON.stringify(out).slice(0, 200)}`);
    } finally { cleanup(); }
  }

  // A. Clean entity, unknown downstream checkpoints → NO block (the over-block guard).
  {
    const { root, cleanup } = makeTree({}); // no misplaced wf, unique ADR, govAdr accepted
    try {
      runGate(root, 'src/app.js') === ''
        ? ok('A: clean entity with only pending/unknown downstream checkpoints → NO block')
        : bad('A: over-blocked on a clean entity (unknown evidence must never block)');
    } finally { cleanup(); }
  }

  // A2. Missing governing ADR (govAdr=false) is NOT blockable here → NO block.
  {
    const { root, cleanup } = makeTree({ decisions: [{ id: 'ADR-0125', status: 'proposed', governs: { operations: ['OP-0005'] } }] });
    try {
      runGate(root, 'src/app.js') === ''
        ? ok('A2: a missing/proposed governing ADR degrades to advisory (not double-blocked by the journey gate)')
        : bad('A2: journey gate over-blocked on a not-yet-accepted governing ADR');
    } finally { cleanup(); }
  }

  // B. No active entity (no contract, no activeTask) → NO block.
  {
    const { root, cleanup } = makeTree({ withContract: false, activeTask: null });
    try {
      runGate(root, 'src/app.js') === ''
        ? ok('B: no active entity / no contract → NO block (degrades silently)')
        : bad('B: blocked without an active entity');
    } finally { cleanup(); }
  }

  // C. Fresh install (no journey.json) → NO block even with a real deviation present.
  {
    const { root, cleanup } = makeTree({ withJourney: false, workflows: [{ id: 'WF-0099', origin: 'OP-0005', owner: null }] });
    try {
      runGate(root, 'src/app.js') === ''
        ? ok('C: fresh install (no journey map) → NO block (fail-open)')
        : bad('C: blocked with no journey map present');
    } finally { cleanup(); }
  }

  // D. Unrelated branch (operation-direct has no workflow-nested stage) → NO block.
  {
    const { root, cleanup } = makeTree({ work: { nature: 'operation', executionMode: 'direct', id: 'OP-0005' }, workflows: [{ id: 'WF-0099', origin: 'OP-0005', owner: null }] });
    try {
      runGate(root, 'src/app.js') === ''
        ? ok('D: operation-direct branch (no workflow stage) → a misplaced wf is out of scope, NO block')
        : bad('D: blocked on a stage the active branch does not include');
    } finally { cleanup(); }
  }

  // G. Exempt path (.md / memory) → never blocked, even with a real deviation.
  {
    const { root, cleanup } = makeTree({ workflows: [{ id: 'WF-0099', origin: 'OP-0005', owner: null }] });
    try {
      runGate(root, 'docs/notes.md') === '' && runGate(root, 'contextkit/memory/x.json') === ''
        ? ok('G: exempt paths (.md, memory/) are never blocked, even with a live deviation')
        : bad('G: an exempt path was blocked');
    } finally { cleanup(); }
  }

  // H. BYPASS / covering simulation → unblocks the same deviation.
  {
    const { root, cleanup } = makeTree({
      workflows: [{ id: 'WF-0099', origin: 'OP-0005', owner: null }],
      simulations: [{ objective: 'BYPASS: unrelated edit', coveredPaths: ['src/app.js'], at: 1 }],
    });
    try {
      runGate(root, 'src/app.js') === ''
        ? ok('H: a covering BYPASS: simulation record unblocks the deviation (audited escape hatch)')
        : bad('H: BYPASS record did not unblock');
    } finally { cleanup(); }
  }

  // I. Advisory mode → warn, never block (same deviation as E).
  {
    const { root, cleanup } = makeTree({ enforcementMode: 'advisory', workflows: [{ id: 'WF-0099', origin: 'OP-0005', owner: null }] });
    try {
      const out = runGate(root, 'src/app.js');
      !isBlock(out) && out.includes('workflowNestedUnderOwner')
        ? ok('I: enforcement.mode=advisory → warns about the deviation but NEVER blocks')
        : bad(`I: advisory mode should warn-not-block; got ${JSON.stringify(out).slice(0, 200)}`);
    } finally { cleanup(); }
  }

  rep.finish('journey BLOCKING gate (ADR-0127 second cut)');
}

main();
