/**
 * Self-check suite for the Session Autonomy Receipt RENDER + STORE layers
 * (workstream 5). Proves the honesty invariants stay enforced at render time and
 * that storage is atomic + idempotent:
 *  - subscription terminal states "subscription"/"unavailable" and NEVER a `$`
 *    figure for savings (spec §25, #14);
 *  - insufficient-evidence output shows NO multiplier (spec §27);
 *  - api output shows cost lines (spec §24);
 *  - low confidence shows a multiplier RANGE, not a point (spec §10.3);
 *  - storeReceipt writes the sidecar files atomically;
 *  - upsertSessionAutonomySection REPLACES (never duplicates) the section on a
 *    second run (spec §23).
 *
 * Wired into `tools/selfcheck.mjs`; also runs standalone (see footer).
 */
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from 'node:fs';

const RENDER_REL = 'templates/contextkit/tools/scripts/economics/session-autonomy/receipt-render.mjs';
const STORE_REL = 'templates/contextkit/tools/scripts/economics/session-autonomy/receipt-store.mjs';

/** Builds an API-mode receipt with high confidence + cost lines. */
function apiReceipt() {
  return {
    schemaVersion: 'cdk-autonomy-receipt/1', reportId: 'r-api', sessionId: 's-api',
    generatedAt: '2026-06-20T00:00:00.000Z', claimType: 'estimated', status: 'generated',
    consumption: { mode: 'api', provider: 'anthropic', model: 'opus' },
    usage: { observedTokens: 223453, estimatedBaselineTokens: 372588, tokenSavingsPercent: 40.0 },
    autonomy: { multiplier: 1.4, gainPercent: 40.0, lowerBound: 1.22, upperBound: 1.43 },
    financial: {
      observedCost: 1.84, estimatedBaselineCost: 3.07, estimatedSavings: 1.23,
      estimatedSavingsPercent: 40.0, costStatus: 'actual', currency: 'USD',
    },
    confidence: { level: 'high', score: 0.9, reasons: [] },
    integrity: { status: 'signed', receiptPath: '.claude/.sessions/s-api.autonomy-receipt.json' },
  };
}

/** Builds a subscription-mode receipt — financial savings must be suppressed. */
function subscriptionReceipt() {
  const base = apiReceipt();
  base.consumption = { mode: 'subscription', provider: 'anthropic', model: 'opus' };
  base.financial = { costStatus: 'unavailable', currency: null, estimatedSavings: null };
  base.confidence = { level: 'medium', score: 0.7, reasons: [] };
  return base;
}

/** Builds a low-confidence receipt — multiplier must render as a range. */
function lowConfidenceReceipt() {
  const base = apiReceipt();
  base.confidence = { level: 'low', score: 0.4, reasons: ['few calibrated samples'] };
  return base;
}

/** Builds an insufficient-evidence receipt — no multiplier, reason shown. */
function insufficientReceipt() {
  return {
    schemaVersion: 'cdk-autonomy-receipt/1', reportId: 'r-ins', sessionId: 's-ins',
    generatedAt: '2026-06-20T00:00:00.000Z', claimType: 'insufficient-evidence', status: 'generated',
    consumption: { mode: 'unknown', provider: null, model: null },
    usage: { observedTokens: 12000, estimatedBaselineTokens: null, tokenSavingsPercent: null },
    autonomy: { multiplier: null, gainPercent: null, lowerBound: null, upperBound: null },
    financial: { costStatus: 'unavailable', estimatedSavings: null },
    confidence: { level: 'insufficient', score: null, reasons: ['no calibrated evidence'] },
    integrity: { status: 'unsigned' },
  };
}

/**
 * @param {{ ok: Function, bad: Function }} report
 * @param {{ KIT: string }} ctx
 */
export async function runSessionAutonomyRenderChecks({ ok, bad }, { KIT }) {
  console.log('Checking Session Autonomy Receipt render + store...');
  let render; let store;
  try {
    render = await import(pathToFileURL(resolve(KIT, RENDER_REL)).href);
    store = await import(pathToFileURL(resolve(KIT, STORE_REL)).href);
    ok('receipt-render + receipt-store import cleanly');
  } catch (err) {
    bad(`session-autonomy render/store import failed: ${err?.message ?? err}`);
    return;
  }
  const { renderTerminal, renderMarkdown } = render;
  const { receiptPaths, storeReceipt, upsertSessionAutonomySection } = store;

  // --- Render: subscription suppresses dollar savings (spec §25, #14) ---
  const sub = renderTerminal(subscriptionReceipt());
  const subLower = sub.toLowerCase();
  const subSavingsLine = sub.split('\n').find((l) => /financial savings/i.test(l)) ?? '';
  subLower.includes('subscription') && subLower.includes('unavailable') && !subSavingsLine.includes('$')
    ? ok('subscription terminal: "subscription" + "unavailable", no $ savings figure')
    : bad(`subscription terminal leaked a $ figure or missing markers: ${subSavingsLine}`);

  // --- Render: insufficient-evidence shows NO multiplier (spec §27) ---
  const ins = renderTerminal(insufficientReceipt());
  !/×/.test(ins) && /unavailable/i.test(ins) && /reason/i.test(ins)
    ? ok('insufficient-evidence terminal: no multiplier, reason shown')
    : bad(`insufficient-evidence terminal showed a multiplier or no reason: ${ins}`);

  // --- Render: api shows cost lines (spec §24) ---
  const api = renderTerminal(apiReceipt());
  api.includes('$1.84') && /cost/i.test(api) && /1\.40×/.test(api)
    ? ok('api terminal: observed cost line + central multiplier present')
    : bad(`api terminal missing cost or multiplier lines: ${api}`);

  // --- Render: low confidence shows a RANGE not a point (spec §10.3) ---
  const low = renderTerminal(lowConfidenceReceipt());
  low.includes('1.22×–1.43×')
    ? ok('low-confidence terminal: multiplier rendered as a range')
    : bad(`low-confidence terminal did not show a range: ${low}`);

  // --- Render: markdown section heading + bullets present ---
  const md = renderMarkdown(apiReceipt());
  md.startsWith('## Session autonomy') && md.includes('- Autonomy Multiplier:') && md.includes('- Receipt path:')
    ? ok('markdown: heading + required bullets present')
    : bad('markdown section missing heading or required bullets');

  // --- Store: writes the sidecar files atomically ---
  const sessionsDir = mkdtempSync(resolve(tmpdir(), 'cdk-sar-'));
  const result = storeReceipt({
    sessionsDir, sessionId: 's-api', receipt: apiReceipt(), markdown: md,
    signature: { algo: 'mock', payloadHash: 'abc' },
  });
  const paths = receiptPaths(sessionsDir, 's-api');
  result.ok && existsSync(paths.json) && existsSync(paths.md) && existsSync(paths.signature)
    ? ok('storeReceipt: json + md + signature sidecars written')
    : bad(`storeReceipt failed: ${result.reason ?? 'files missing'}`);

  // --- Upsert: replaces rather than duplicates on a second run (spec §23) ---
  const sessionMd = resolve(sessionsDir, 'session-log.md');
  writeFileSync(sessionMd, '# Session\n\nSome narrative.\n\n## Notes\n\nkeep me\n', 'utf8');
  const first = upsertSessionAutonomySection(sessionMd, renderMarkdown(apiReceipt()));
  const second = upsertSessionAutonomySection(sessionMd, renderMarkdown(lowConfidenceReceipt()));
  const finalText = readFileSync(sessionMd, 'utf8');
  const headingCount = (finalText.match(/^## Session autonomy$/gm) ?? []).length;
  first.action === 'inserted' && second.action === 'replaced'
    && headingCount === 1 && finalText.includes('keep me')
    ? ok('upsert: inserted then replaced — exactly one section, sibling section preserved')
    : bad(`upsert duplicated or lost content (headings=${headingCount})`);

  // --- Store: graceful skip when the session markdown is absent ---
  const skip = upsertSessionAutonomySection(resolve(sessionsDir, 'nope.md'), md);
  skip.ok && skip.action === 'skipped'
    ? ok('upsert: skips gracefully when the session markdown is missing')
    : bad('upsert did not skip a missing file');
}

// Standalone runner.
if (process.argv[1] && process.argv[1].endsWith('selfcheck-session-autonomy-render.mjs')) {
  let failures = 0;
  const report = {
    ok: (msg) => console.log(`  ok  ${msg}`),
    bad: (msg) => { failures += 1; console.log(`  BAD ${msg}`); },
  };
  const KIT = resolve(process.argv[1], '..', '..');
  runSessionAutonomyRenderChecks(report, { KIT })
    .then(() => {
      console.log(failures ? `\n${failures} failure(s).` : '\nAll render/store checks passed.');
      process.exit(failures ? 1 : 0);
    })
    .catch((err) => { console.error(err); process.exit(1); });
}
