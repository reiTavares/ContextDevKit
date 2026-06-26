/**
 * integration-test-mcp-010-seam.mjs — MCP-010 AC-4a: CDK-022 seam integrity.
 *
 * Acceptance criteria covered:
 *   AC-4a DEGRADED PATH (CDK-022 absent): local store used; substrate-only
 *         fields = 'skipped'; no false-pass on absent CDK-022 integration.
 *
 * Suites:
 *   Suite 11 — CDK-022 seam: SUBSTRATE_STATUS='skipped', receipt.substrate
 *              mirrors constant, buildReport preserves caller substrateStatus
 *
 * This suite guards the integration seam contract: SUBSTRATE_STATUS must be
 * the literal 'skipped' string exported by mcp-receipt.mjs until CDK-022 is
 * wired. If CDK-022 is wired later, SUBSTRATE_STATUS will change — that
 * change is intentional, but this test makes it visible and forces an update.
 *
 * Run:  node tools/integration-test-mcp-010-seam.mjs
 * Exits non-zero on any failure.
 */

import { reporter } from './it-helpers.mjs';
import {
  buildReceipt,
  buildReport,
  SUBSTRATE_STATUS,
} from './integration-test-mcp-010-helpers.mjs';

const rep = reporter();
const { ok, bad, finish } = rep;

// ---------------------------------------------------------------------------
// Suite 11: CDK-022 seam — substrate-only fields stay 'skipped' (AC-4a)
// ---------------------------------------------------------------------------
console.log('\n[Suite 11] CDK-022 seam — substrate-only fields report "skipped", not pass (AC-4a)\n');
{
  SUBSTRATE_STATUS === 'skipped'
    ? ok('SUBSTRATE_STATUS exported value is "skipped" (CDK-022 not yet wired)')
    : bad(
        `SUBSTRATE_STATUS changed from expected "skipped": got "${SUBSTRATE_STATUS}" ` +
        '— if CDK-022 is wired, update this test to reflect the real status',
      );

  // Any receipt built while CDK-022 is absent must carry substrate='skipped'
  const receipt = buildReceipt({
    task: 't', run: 'r', servers: [], tools: [], host: 'h', result: 'passed',
  });

  receipt.substrate === SUBSTRATE_STATUS
    ? ok('receipt.substrate mirrors SUBSTRATE_STATUS constant')
    : bad(`receipt.substrate "${receipt.substrate}" ≠ SUBSTRATE_STATUS "${SUBSTRATE_STATUS}"`);

  receipt.substrate !== 'passed'
    ? ok('receipt.substrate ≠ "passed" — no false-pass on absent CDK-022')
    : bad('receipt.substrate must NEVER be "passed" when CDK-022 absent');

  // buildReport must propagate the caller-supplied substrateStatus unchanged
  const report = buildReport({
    servers: [],
    receipts: [],
    configFound: false,
    substrateStatus: 'local-empty',
    currentHost: 'claude-code',
  });

  report.substrateStatus === 'local-empty'
    ? ok('buildReport preserves caller-supplied substrateStatus unchanged')
    : bad(`buildReport altered substrateStatus: ${report.substrateStatus}`);
}

// ---------------------------------------------------------------------------
// Finish
// ---------------------------------------------------------------------------
finish('MCP-010 CDK-022 seam (AC-4a)');
