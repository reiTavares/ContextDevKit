/**
 * integration-test-enforcement-modes.mjs - CDK-023 / ADR-0072 — Enforcement mode tests (E-series).
 *
 * Table-driven end-to-end integration tests for enforcement-modes.mjs:
 * E1 resolveEnforcementMode | E2 advisory: all moments warn | E3 guarded: blocks at writes
 * E4 strict: blocks everywhere | E5 valid receipt -> allow + satisfied
 * E6 valid bypass -> allow + bypassed (anti-theatre) | E7 expired bypass -> deny
 * E8 grade-4 floor via decide() | E9/E10 scope isolation | E11 full matrix | E12 report
 *
 * B-series (bypass-store primitives) lives in integration-test-enforcement.mjs.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { reporter } from './it-helpers.mjs';

const KIT = dirname(dirname(fileURLToPath(import.meta.url)));
const BYPASS_PATH = resolve(KIT, 'templates/contextkit/runtime/execution/bypass-store.mjs');
const MODES_PATH = resolve(KIT, 'templates/contextkit/runtime/execution/enforcement-modes.mjs');
const RECEIPT_PATH = resolve(KIT, 'templates/contextkit/runtime/execution/receipt-store.mjs');

const rep = reporter();
const tmp = () => mkdtempSync(join(tmpdir(), 'ck-it-em-'));
const clean = (r) => rmSync(r, { recursive: true, force: true });

let writeBypass, readBypasses;
let resolveEnforcementMode, decide;
let writeReceipt;

try {
  const bMod = await import('file://' + BYPASS_PATH.replaceAll('\\', '/'));
  ({ writeBypass, readBypasses } = bMod);
  const eMod = await import('file://' + MODES_PATH.replaceAll('\\', '/'));
  ({ resolveEnforcementMode, decide } = eMod);
  const rMod = await import('file://' + RECEIPT_PATH.replaceAll('\\', '/'));
  ({ writeReceipt } = rMod);
} catch (err) {
  rep.bad(`Module import failed: ${err?.message ?? err}`);
  rep.finish('enforcement-modes (CDK-023)');
}

const baseBp = (overrides = {}) => ({
  capability: 'qa-signoff', taskId: 'task-42', branch: 'feat/x',
  reason: 'approved', actor: 'human-dev', approvedBy: 'alice', ...overrides,
});

const baseRcpt = (overrides = {}) => ({
  capability: 'qa-signoff', taskId: 'task-42', sessionId: 'sess-1',
  runId: 'run-1', command: '/qa-signoff', host: 'claude', result: 'passed',
  evidence: { exitCode: 0, summary: 'All green' },
  scope: { branch: 'feat/x', taskId: 'task-42', paths: [] }, ...overrides,
});

const contract = {
  requiredBeforeExploration: ['sim-impact'],
  requiredBeforeWrite: ['qa-signoff'],
  requiredBeforeCompletion: ['adr-review'],
};

// E1. resolveEnforcementMode: various config states.
{
  resolveEnforcementMode(null) === 'advisory' ? rep.ok('E1. mode: null -> advisory') : rep.bad('E1. mode: null not advisory');
  resolveEnforcementMode({}) === 'advisory' ? rep.ok('E1. mode: empty -> advisory') : rep.bad('E1. mode: empty not advisory');
  resolveEnforcementMode({ enforcement: { mode: 'junk' } }) === 'advisory' ? rep.ok('E1. mode: unknown -> advisory') : rep.bad('E1. mode: unknown not advisory');
  resolveEnforcementMode({ enforcement: { mode: 'guarded' } }) === 'guarded' ? rep.ok('E1. mode: guarded honored') : rep.bad('E1. mode: guarded not honored');
  resolveEnforcementMode({ enforcement: { mode: 'strict' } }) === 'strict' ? rep.ok('E1. mode: strict honored') : rep.bad('E1. mode: strict not honored');
}

// E2. Advisory: warn at all three moments when missing, never deny.
{
  const root = tmp();
  try {
    const scope = { branch: 'feat/x', taskId: 'task-e2', paths: [] };
    for (const moment of ['beforeExploration', 'beforeWrite', 'beforeCompletion']) {
      const r = decide({ mode: 'advisory', contract, moment, scope, root });
      r.decision === 'warn'
        ? rep.ok(`E2. advisory: missing at ${moment} -> warn`)
        : rep.bad(`E2. advisory: ${moment} got ${r.decision} (expected warn)`);
    }
  } finally { clean(root); }
}

// E3. Guarded: deny at beforeWrite/beforeCompletion; warn at beforeExploration.
{
  const root = tmp();
  try {
    const scope = { branch: 'feat/x', taskId: 'task-e3', paths: [] };
    const exploration = decide({ mode: 'guarded', contract, moment: 'beforeExploration', scope, root });
    exploration.decision === 'warn' ? rep.ok('E3. guarded: beforeExploration -> warn') : rep.bad(`E3. guarded: exploration got ${exploration.decision}`);
    const write = decide({ mode: 'guarded', contract, moment: 'beforeWrite', scope, root });
    write.decision === 'deny' ? rep.ok('E3. guarded: beforeWrite missing -> deny') : rep.bad(`E3. guarded: write got ${write.decision}`);
    const completion = decide({ mode: 'guarded', contract, moment: 'beforeCompletion', scope, root });
    completion.decision === 'deny' ? rep.ok('E3. guarded: beforeCompletion missing -> deny') : rep.bad(`E3. guarded: completion got ${completion.decision}`);
  } finally { clean(root); }
}

// E4. Strict: deny at all three moments when missing.
{
  const root = tmp();
  try {
    const scope = { branch: 'feat/x', taskId: 'task-e4', paths: [] };
    for (const moment of ['beforeExploration', 'beforeWrite', 'beforeCompletion']) {
      const r = decide({ mode: 'strict', contract, moment, scope, root });
      r.decision === 'deny'
        ? rep.ok(`E4. strict: missing at ${moment} -> deny`)
        : rep.bad(`E4. strict: ${moment} got ${r.decision} (expected deny)`);
    }
  } finally { clean(root); }
}

// E5. Valid receipt -> allow + capability in satisfied, not missing.
{
  const root = tmp();
  try {
    const scope = { branch: 'feat/x', taskId: 'task-e5', paths: [] };
    writeReceipt(root, baseRcpt({ taskId: 'task-e5', scope }));
    const r = decide({ mode: 'strict', contract, moment: 'beforeWrite', scope, root });
    r.decision === 'allow' ? rep.ok('E5. strict: valid receipt -> allow') : rep.bad(`E5. strict: expected allow with receipt, got ${r.decision}`);
    r.satisfied.includes('qa-signoff') ? rep.ok('E5. receipt: capability in satisfied') : rep.bad('E5. receipt not in satisfied');
    !r.missing.includes('qa-signoff') ? rep.ok('E5. receipt: capability not in missing') : rep.bad('E5. receipt wrongly in missing');
  } finally { clean(root); }
}

// E6. Valid bypass -> allow + capability in bypassed, NOT in satisfied (anti-theatre).
{
  const root = tmp();
  try {
    const scope = { branch: 'feat/x', taskId: 'task-e6', paths: [] };
    writeBypass(root, baseBp({ taskId: 'task-e6', branch: 'feat/x' }));
    const r = decide({ mode: 'guarded', contract, moment: 'beforeWrite', scope, root });
    r.decision === 'allow' ? rep.ok('E6. guarded: valid bypass -> allow') : rep.bad(`E6. guarded bypass: expected allow, got ${r.decision}`);
    r.bypassed.includes('qa-signoff') ? rep.ok('E6. bypass: capability in bypassed list') : rep.bad('E6. bypass not in bypassed list');
    !r.satisfied.includes('qa-signoff') ? rep.ok('E6. anti-theatre: bypassed != satisfied') : rep.bad('E6. anti-theatre: bypass wrongly in satisfied');
  } finally { clean(root); }
}

// E7. Expired bypass does not rescue (guarded + strict).
{
  const root = tmp();
  try {
    const scope = { branch: 'feat/x', taskId: 'task-e7', paths: [] };
    writeBypass(root, baseBp({ taskId: 'task-e7', branch: 'feat/x' }), { ttlMs: 0 });
    const futureNow = Date.now() + 999_999;
    const rG = decide({ mode: 'guarded', contract, moment: 'beforeWrite', scope, root, now: futureNow });
    rG.decision === 'deny' ? rep.ok('E7. guarded: expired bypass -> deny') : rep.bad(`E7. guarded expired: got ${rG.decision}`);
    const rS = decide({ mode: 'strict', contract, moment: 'beforeWrite', scope, root, now: futureNow });
    rS.decision === 'deny' ? rep.ok('E7. strict: expired bypass -> deny') : rep.bad(`E7. strict expired: got ${rS.decision}`);
  } finally { clean(root); }
}

// E8. Grade-4 floor: actor='auto' bypass with requiresHumanApproval -> deny.
{
  const root = tmp();
  try {
    const scope = { branch: 'feat/x', taskId: 'task-e8', paths: [] };
    writeBypass(root, baseBp({ taskId: 'task-e8', capability: 'sim-impact', actor: 'auto', approvedBy: 'self' }));
    const r = decide({ mode: 'strict', contract, moment: 'beforeExploration', scope, root, requiresHumanApproval: true });
    r.decision === 'deny' ? rep.ok('E8. grade-4 floor: auto bypass -> deny') : rep.bad(`E8. grade-4 floor: expected deny, got ${r.decision}`);
  } finally { clean(root); }
}

// E9. Scope isolation: bypass for task X does NOT rescue task Y.
{
  const root = tmp();
  try {
    writeBypass(root, baseBp({ taskId: 'task-X', branch: 'feat/x' }));
    const scope = { branch: 'feat/x', taskId: 'task-Y', paths: [] };
    const r = decide({ mode: 'guarded', contract, moment: 'beforeWrite', scope, root });
    r.decision === 'deny' ? rep.ok('E9. scope isolation: bypass for task-X does not rescue task-Y') : rep.bad(`E9. isolation: expected deny, got ${r.decision}`);
  } finally { clean(root); }
}

// E10. Scope isolation: bypass for cap A does NOT rescue cap B.
{
  const root = tmp();
  try {
    const scope = { branch: 'feat/x', taskId: 'task-e10', paths: [] };
    writeBypass(root, baseBp({ taskId: 'task-e10', capability: 'OTHER-CAP' }));
    const r = decide({ mode: 'guarded', contract, moment: 'beforeWrite', scope, root });
    r.decision === 'deny' ? rep.ok('E10. scope isolation: bypass for cap-A does not rescue cap-B') : rep.bad(`E10. cap isolation: expected deny, got ${r.decision}`);
  } finally { clean(root); }
}

// E11. Full contract: advisory vs guarded vs strict at all moments with no capabilities fulfilled.
{
  const root = tmp();
  try {
    const scope = { branch: 'feat/x', taskId: 'task-e11', paths: [] };
    const outcomes = [];
    for (const mode of ['advisory', 'guarded', 'strict']) {
      for (const moment of ['beforeExploration', 'beforeWrite', 'beforeCompletion']) {
        outcomes.push(`${mode}/${moment}=${decide({ mode, contract, moment, scope, root }).decision}`);
      }
    }
    const expected = [
      'advisory/beforeExploration=warn', 'advisory/beforeWrite=warn', 'advisory/beforeCompletion=warn',
      'guarded/beforeExploration=warn', 'guarded/beforeWrite=deny', 'guarded/beforeCompletion=deny',
      'strict/beforeExploration=deny', 'strict/beforeWrite=deny', 'strict/beforeCompletion=deny',
    ];
    const allMatch = expected.every((e, i) => outcomes[i] === e);
    allMatch ? rep.ok('E11. full matrix: advisory/guarded/strict x all moments correct') : rep.bad(`E11. matrix mismatch: got ${JSON.stringify(outcomes)}`);
  } finally { clean(root); }
}

// E12. readBypasses for a report: all bypasses readable.
{
  const root = tmp();
  try {
    const taskId = 'task-e12';
    writeBypass(root, baseBp({ taskId, capability: 'qa-signoff' }));
    writeBypass(root, baseBp({ taskId, capability: 'sim-impact' }));
    writeBypass(root, baseBp({ taskId, capability: 'adr-review' }));
    const all = readBypasses(root, taskId);
    all.length === 3
      ? rep.ok('E12. report: all three bypasses readable via readBypasses')
      : rep.bad(`E12. report: expected 3, got ${all.length}`);
  } finally { clean(root); }
}

rep.finish('enforcement-modes (CDK-023)');