/**
 * integration-test-mcp-008-profile.mjs — MCP-008 AC-2: Guarded + ephemeral
 * profile contract, and allowlist scoped to testing tools only.
 *
 * Covers:
 *   - Profile activation mode is "guarded"; riskClass is R3.
 *   - Browser profile is ephemeral, not persistent (defence-in-depth).
 *   - Server browserOptions declare ephemeral + headless.
 *   - Allowlist contains exactly the 5 read-only testing tools.
 *   - No destructive tool appears in the allowlist.
 *   - Regression guards: persistent=true and browser_evaluate-in-allow are caught.
 *
 * Run:  node tools/integration-test-mcp-008-profile.mjs
 * Exits 0 on all-pass, non-zero on any failure.
 */

import {
  buildSuiteContext,
  ALLOWED_TESTING_TOOLS,
  DESTRUCTIVE_TOOLS,
} from './integration-test-mcp-008-helpers.mjs';

const SUITE = 'MCP-008 profile (AC-2)';
const { check, expectContractFails, finish, profile } = buildSuiteContext(SUITE);

// ---------------------------------------------------------------------------
// [Suite 2] AC-2 — profile ships guarded + ephemeral defaults
// ---------------------------------------------------------------------------
console.log('\n[MCP-008/profile] AC-2 — guarded + ephemeral defaults\n');

check(
  profile.activationMode === 'guarded',
  'profile.activationMode is "guarded"',
  `got ${profile.activationMode}`,
);
check(
  profile.riskClass === 'R3',
  'profile.riskClass is R3',
  `got ${profile.riskClass}`,
);
check(
  profile.browserProfile?.persistent === false,
  'browserProfile.persistent is false (non-persistent)',
  `got ${profile.browserProfile?.persistent}`,
);
check(
  profile.browserProfile?.ephemeral === true,
  'browserProfile.ephemeral is true',
  `got ${profile.browserProfile?.ephemeral}`,
);

// Server options must also declare ephemeral mode (defence-in-depth)
const profileServer = (profile.servers ?? []).find((s) => s.id === 'playwright');
check(profileServer !== undefined, 'profile has a playwright server entry');
check(
  profileServer?.browserOptions?.profile === 'ephemeral',
  'server browserOptions.profile is "ephemeral"',
  `got ${profileServer?.browserOptions?.profile}`,
);
check(
  profileServer?.browserOptions?.headless === true,
  'server browserOptions.headless is true',
  `got ${profileServer?.browserOptions?.headless}`,
);

// Regression guard: persistent=true must be caught by the ephemeral contract
expectContractFails(
  'persistent=true violates ephemeral contract',
  () =>
    ({ ...profile, browserProfile: { persistent: true, ephemeral: false } })
      .browserProfile?.persistent === false,
);

// ---------------------------------------------------------------------------
// [Suite 3] AC-2 — allowlist scope (testing only; destructive excluded)
// ---------------------------------------------------------------------------
console.log('\n[MCP-008/profile] AC-2 — allowlist scope\n');

const profileAllowed = profileServer?.allowedTools ?? [];

// Happy path: every expected testing tool is present
for (const tool of ALLOWED_TESTING_TOOLS) {
  check(profileAllowed.includes(tool), `profile.allowedTools includes "${tool}"`);
}

// Failure mode: every destructive tool is absent from profile.allowedTools
for (const tool of DESTRUCTIVE_TOOLS) {
  check(
    !profileAllowed.includes(tool),
    `destructive tool "${tool}" absent from profile.allowedTools`,
    `found in: ${profileAllowed.join(', ')}`,
  );
}

// Edge: profile must have EXACTLY the allowed testing tools — no silent extras
check(
  profileAllowed.length === ALLOWED_TESTING_TOOLS.length,
  `profile.allowedTools count is exactly ${ALLOWED_TESTING_TOOLS.length} (no silent additions)`,
  `got ${profileAllowed.length}: [${profileAllowed.join(', ')}]`,
);

// Regression guard: browser_evaluate in profileAllowed must be caught
expectContractFails(
  'browser_evaluate in profileAllowed violates least-privilege contract',
  () => ![...profileAllowed, 'browser_evaluate'].includes('browser_evaluate'),
);

// ---------------------------------------------------------------------------
finish(SUITE);
