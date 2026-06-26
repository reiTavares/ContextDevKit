/**
 * integration-test-mcp-008-consistency.mjs — MCP-008: Cross-file consistency,
 * policy schema completeness, and profile integrity.
 *
 * Covers:
 *   - Suite 8: profile.allowedTools and policy.allow contain identical tool sets
 *     (drift guard: one file updated, the other forgotten).
 *   - Suite 9: policy schema and rationale completeness for security reviewers
 *     (server, riskClass, version, description, rationale fields).
 *   - Suite 10: profile structural integrity — id, displayName, description,
 *     exactly one server entry, server id matches policy.server.
 *
 * Run:  node tools/integration-test-mcp-008-consistency.mjs
 * Exits 0 on all-pass, non-zero on any failure.
 */

import { buildSuiteContext } from './integration-test-mcp-008-helpers.mjs';

const SUITE = 'MCP-008 consistency + policy schema + profile integrity';
const { check, finish, profile, policy } = buildSuiteContext(SUITE);

const profileServer  = (profile.servers ?? []).find((s) => s.id === 'playwright');
const profileAllowed = profileServer?.allowedTools ?? [];
const policyAllow    = policy.allow ?? [];

// ---------------------------------------------------------------------------
// [Suite 8] Cross-file consistency — profile.allowedTools == policy.allow
// ---------------------------------------------------------------------------
console.log('\n[MCP-008/consistency] Suite 8 — allowedTools vs policy.allow drift\n');

const profileSet = new Set(profileAllowed);
const policySet  = new Set(policyAllow);

const inProfileNotPolicy = [...profileSet].filter((t) => !policySet.has(t));
const inPolicyNotProfile = [...policySet].filter((t) => !profileSet.has(t));

check(
  inProfileNotPolicy.length === 0,
  'no tool in profile.allowedTools absent from policy.allow (no drift)',
  `only in profile: ${inProfileNotPolicy.join(', ')}`,
);
check(
  inPolicyNotProfile.length === 0,
  'no tool in policy.allow absent from profile.allowedTools (no drift)',
  `only in policy: ${inPolicyNotProfile.join(', ')}`,
);
check(
  profileSet.size === policySet.size,
  `allowed tool count matches across files (${policySet.size})`,
  `profile=${profileSet.size} policy=${policySet.size}`,
);

// ---------------------------------------------------------------------------
// [Suite 9] Policy schema and rationale completeness
// ---------------------------------------------------------------------------
console.log('\n[MCP-008/consistency] Suite 9 — policy schema and rationale\n');

check(
  policy.server === 'playwright',
  'policy.server is "playwright"',
  `got ${policy.server}`,
);
check(
  policy.riskClass === 'R3',
  'policy.riskClass is R3',
  `got ${policy.riskClass}`,
);
check(
  policy.version === 1,
  'policy.version is 1',
  `got ${policy.version}`,
);
check(
  typeof policy.description === 'string' && policy.description.length > 20,
  'policy has a non-trivial description',
);
check(
  typeof policy.rationale === 'object' && policy.rationale !== null,
  'policy.rationale is an object',
);
check(
  typeof policy.rationale?.allowed === 'string' &&
    policy.rationale.allowed.length > 20,
  'policy.rationale.allowed documents permitted tools',
);
check(
  typeof policy.rationale?.denied_destructive === 'string' &&
    policy.rationale.denied_destructive.length > 20,
  'policy.rationale.denied_destructive documents exclusions',
);
check(
  typeof policy.rationale?.browser_evaluate_rationale === 'string' &&
    policy.rationale.browser_evaluate_rationale.length > 0,
  'policy.rationale.browser_evaluate_rationale is documented',
);

// ---------------------------------------------------------------------------
// [Suite 10] Profile integrity — id, schema coherence, no extra server entries
// ---------------------------------------------------------------------------
console.log('\n[MCP-008/consistency] Suite 10 — profile structural integrity\n');

check(
  profile.id === 'playwright-guarded',
  'profile.id is "playwright-guarded"',
  `got ${profile.id}`,
);
check(
  typeof profile.displayName === 'string' && profile.displayName.length > 0,
  'profile.displayName is non-empty',
);
check(
  typeof profile.description === 'string' && profile.description.length > 0,
  'profile.description is non-empty',
);
check(
  (profile.servers ?? []).length === 1,
  'profile has exactly 1 server entry (no extra entries added)',
  `got ${(profile.servers ?? []).length}`,
);
check(
  profileServer?.id === 'playwright',
  'profile server entry id is "playwright"',
  `got ${profileServer?.id}`,
);
check(
  policy.server === profileServer?.id,
  `policy.server ("${policy.server}") matches profile server entry id ("${profileServer?.id}")`,
);

// ---------------------------------------------------------------------------
finish(SUITE);
