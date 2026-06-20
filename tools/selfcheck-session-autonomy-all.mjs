/**
 * selfcheck-session-autonomy-all.mjs — aggregate self-check for the Session
 * Autonomy Receipt feature. Runs the five workstream slices (estimator, usage,
 * financial, integrity, render) plus an assembler + fail-open finalization smoke.
 * Wired into selfcheck-economy-all.mjs so selfcheck.mjs stays under budget.
 *
 * Export signature mirrors the EACP convention: run…Checks({ ok, bad }, { KIT }).
 * Zero runtime dependencies — node:* + relative imports only.
 */

import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { runSessionAutonomyEstimatorChecks } from './selfcheck-session-autonomy-estimator.mjs';
import { runSessionAutonomyUsageChecks }     from './selfcheck-session-autonomy-usage.mjs';
import { runSessionAutonomyFinancialChecks }  from './selfcheck-session-autonomy-financial.mjs';
import { runSessionAutonomyIntegrityChecks }  from './selfcheck-session-autonomy-integrity.mjs';
import { runSessionAutonomyRenderChecks }     from './selfcheck-session-autonomy-render.mjs';

/** Dynamic import of a source module by repo-relative path (KIT-rooted). */
async function load(KIT, relPath) {
  return import(pathToFileURL(join(KIT, relPath)).href);
}

/**
 * Assembler + finalization smoke: a subscription session with a matching
 * calibration profile produces an `estimated` receipt with no invented financial
 * savings; an estimator throw is swallowed fail-open.
 */
async function runAssemblerChecks({ ok, bad }, { KIT }) {
  const base = 'templates/contextkit/tools/scripts/economics/session-autonomy';
  const { buildReceipt } = await load(KIT, `${base}/receipt-build.mjs`);
  const { finalizeReceipt } = await load(KIT, `${base}/finalize-receipt.mjs`);

  const receipt = buildReceipt({
    sessionId: 'smoke-1', generatedAt: '2026-06-20T00:00:00Z', consumptionMode: 'subscription',
    observedUsage: { observedTokens: 223453, total: 223453 },
    sessionProfile: { language: 'go', taskType: 'bug-fix', repoSizeLoc: 200000 },
    sessionOutcome: { tasksAttempted: 8, tasksAccepted: 8, qaStatus: 'green' },
    acceptance: { accepted: 8 }, basis: ['qa-green', 'project-map-find', 'not-a-real-basis'],
  });
  if (receipt.schemaVersion === 'cdk-autonomy-receipt/1') ok('assembler: canonical schema version'); else bad('assembler: wrong schema version');
  if (receipt.claimType === 'estimated') ok('assembler: subscription+matched profile → estimated'); else bad(`assembler: claimType ${receipt.claimType}`);
  if (receipt.financial.costStatus === 'unavailable' && receipt.financial.estimatedSavings === null) ok('assembler: subscription invents NO financial savings'); else bad('assembler: subscription leaked a financial figure');
  if (Array.isArray(receipt.basis) && receipt.basis.includes('qa-green') && !receipt.basis.includes('not-a-real-basis')) ok('assembler: basis keeps only confirmed/known tokens'); else bad('assembler: basis admitted an unknown token');
  if (receipt.integrity && ['signed', 'hash-only'].includes(receipt.integrity.status)) ok('assembler: integrity attached (signed|hash-only)'); else bad('assembler: integrity missing');

  // insufficient-evidence: no profile match, usage present.
  const insufficient = buildReceipt({
    sessionId: 'smoke-2', generatedAt: '2026-06-20T00:00:00Z', consumptionMode: 'unknown',
    observedUsage: { observedTokens: 12000, total: 12000 },
    sessionProfile: { language: 'javascript', taskType: 'feature', repoSizeLoc: 4000 },
  });
  if (insufficient.claimType === 'insufficient-evidence' && insufficient.autonomy.multiplier === null) ok('assembler: no calibration match → insufficient-evidence, no multiplier'); else bad('assembler: fabricated a multiplier without evidence');

  // fail-open: estimator throws (bad signals) → finalization still ok.
  const finalized = finalizeReceipt({
    sessionId: 'smoke-3', sessionsDir: null, generatedAt: '2026-06-20T00:00:00Z',
    config: { economy: { sessionAutonomyReceipt: { enabled: true } } },
    signals: { observedUsage: null, get sessionProfile() { throw new Error('boom'); } },
  });
  if (finalized.ok === true) ok('finalize: fail-open (never throws to caller)'); else bad('finalize: propagated an error');

  // disabled → skipped
  const disabled = finalizeReceipt({
    sessionId: 'smoke-4', generatedAt: '2026-06-20T00:00:00Z',
    config: { economy: { sessionAutonomyReceipt: { enabled: false } } }, signals: {},
  });
  if (disabled.status === 'skipped') ok('finalize: feature-disabled → skipped'); else bad('finalize: ran while disabled');
}

/**
 * Runs every Session Autonomy Receipt self-check slice.
 * @param {{ ok: (m: string) => void, bad: (m: string) => void }} reporter
 * @param {{ KIT: string }} ctx
 */
export async function runSessionAutonomyChecks({ ok, bad }, { KIT }) {
  await runSessionAutonomyEstimatorChecks({ ok, bad }, { KIT });
  await runSessionAutonomyUsageChecks({ ok, bad }, { KIT });
  await runSessionAutonomyFinancialChecks({ ok, bad }, { KIT });
  await runSessionAutonomyIntegrityChecks({ ok, bad }, { KIT });
  await runSessionAutonomyRenderChecks({ ok, bad }, { KIT });
  await runAssemblerChecks({ ok, bad }, { KIT });
}

// Standalone runner — node tools/selfcheck-session-autonomy-all.mjs (registered suite).
import { fileURLToPath } from 'node:url';
if (process.argv[1] && process.argv[1] === fileURLToPath(import.meta.url)) {
  let pass = 0, fail = 0;
  const ok = () => { pass++; };
  const bad = (m) => { fail++; console.error('  BAD ' + m); };
  const KIT = process.cwd();
  console.log('Session Autonomy Receipt — aggregate suite');
  await runSessionAutonomyChecks({ ok, bad }, { KIT });
  console.log(`session-autonomy: ${pass}/${pass + fail} checks ok`);
  process.exit(fail ? 1 : 0);
}
