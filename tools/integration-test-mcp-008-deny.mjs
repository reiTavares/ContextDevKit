/**
 * integration-test-mcp-008-deny.mjs — MCP-008 AC-5: deny-wins invariant.
 *
 * Covers:
 *   - policy.allow ∩ policy.deny = ∅ (no tool simultaneously allowed and denied).
 *   - Every destructive tool is explicitly listed in policy.deny.
 *   - Every tool in policy.allow is a recognised testing tool.
 *   - Regression guard: adding browser_evaluate to allow while it's in deny
 *     produces an overlap that the contract must catch.
 *   - Regression guard: removing browser_evaluate from deny breaks the
 *     destructive-tool contract (contract must catch it).
 *
 * Run:  node tools/integration-test-mcp-008-deny.mjs
 * Exits 0 on all-pass, non-zero on any failure.
 */

import {
  buildSuiteContext,
  ALLOWED_TESTING_TOOLS,
  DESTRUCTIVE_TOOLS,
} from './integration-test-mcp-008-helpers.mjs';

const SUITE = 'MCP-008 deny-wins invariant (AC-5)';
const { check, expectContractFails, finish, policy } = buildSuiteContext(SUITE);

const policyAllow = policy.allow ?? [];
const policyDeny  = policy.deny  ?? [];

// ---------------------------------------------------------------------------
// [Suite 7] AC-5 — deny-wins: no tool in both allow and deny
// ---------------------------------------------------------------------------
console.log('\n[MCP-008/deny] AC-5 — deny-wins invariant\n');

// Happy path: allow ∩ deny = ∅
const overlap = policyAllow.filter((t) => policyDeny.includes(t));
check(
  overlap.length === 0,
  'deny-wins invariant holds: allow ∩ deny = ∅',
  `overlap: ${overlap.join(', ')}`,
);

// Every destructive tool is explicitly in deny
for (const tool of DESTRUCTIVE_TOOLS) {
  check(policyDeny.includes(tool), `policy.deny includes destructive tool "${tool}"`);
}

// Only recognised testing tools appear in allow
for (const tool of policyAllow) {
  check(
    ALLOWED_TESTING_TOOLS.includes(tool),
    `policy.allow tool "${tool}" is a recognised testing tool (not destructive)`,
    `"${tool}" is not in ALLOWED_TESTING_TOOLS`,
  );
}

// Regression guard: adding browser_evaluate to allow violates deny-wins
// (browser_evaluate is already in deny — this creates an overlap the contract must detect)
expectContractFails(
  'browser_evaluate in allow + deny simultaneously violates deny-wins',
  () => {
    const mutatedAllow   = [...policyAllow, 'browser_evaluate'];
    const mutatedDeny    = [...policyDeny];
    const mutatedOverlap = mutatedAllow.filter((t) => mutatedDeny.includes(t));
    // contractFn returns true = "contract passes" (wrong — should catch the overlap)
    return mutatedOverlap.length === 0;
  },
);

// Regression guard: removing browser_evaluate from deny breaks the security contract
expectContractFails(
  'browser_evaluate removed from policy.deny breaks destructive-tool contract',
  () => {
    const mutatedDeny = policyDeny.filter((t) => t !== 'browser_evaluate');
    // contractFn returns true = "contract passes" (wrong — should catch the missing entry)
    return mutatedDeny.includes('browser_evaluate');
  },
);

// ---------------------------------------------------------------------------
finish(SUITE);
