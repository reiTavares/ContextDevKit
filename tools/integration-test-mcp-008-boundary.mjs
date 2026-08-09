/**
 * integration-test-mcp-008-boundary.mjs — MCP-008 AC-3 / AC-4: Network /
 * workspace trust boundary, activation wiring coherence, and /mcp doctor
 * contract completeness.
 *
 * Covers:
 *   - No network secret required (profile + policy level).
 *   - trustBoundary is "workspace"; persistent state disabled in policy.
 *   - Cross-boundary tools (browser_network_request, browser_file_upload) are
 *     absent from allow and present in deny.
 *   - profile.activatedBy + dynamicActivation ticket/trigger coherence.
 *   - profile.riskClass matches registry entry risk.
 *   - /mcp doctor contract: displayName, transport, capabilities.tools, npm pin.
 *   - guarded profile has at least one allowed tool for doctor handshake.
 *   - Profile tools overlap registry capabilities (≥2).
 *   - profile.pairsWith includes "qa-e2e".
 *
 * Run:  node tools/integration-test-mcp-008-boundary.mjs
 * Exits 0 on all-pass, non-zero on any failure.
 */

import { buildSuiteContext } from './integration-test-mcp-008-helpers.mjs';

const SUITE = 'MCP-008 boundary + wiring + doctor (AC-3/AC-4)';
const { ok, check, finish, registry, profile, policy } = buildSuiteContext(SUITE);

const pwRegistryEntry = registry.entries?.find((e) => e.id === 'playwright');
const profileServer   = (profile.servers ?? []).find((s) => s.id === 'playwright');
const profileAllowed  = profileServer?.allowedTools ?? [];

// ---------------------------------------------------------------------------
// [Suite 4] AC-3 — no network secret; workspace trust boundary
// ---------------------------------------------------------------------------
console.log('\n[MCP-008/boundary] AC-3 — no network secret; workspace boundary\n');

// Profile level
check(
  !(profile.servers ?? []).some((s) => (s.referencedSecrets ?? []).length > 0),
  'profile servers have no referencedSecrets (no network secret required)',
);
check(
  profile.requiresNetworkSecret !== true,
  'profile does not set requiresNetworkSecret=true',
);

// Policy level
check(
  policy.requiresNetworkSecret === false,
  'policy.requiresNetworkSecret is false',
  `got ${policy.requiresNetworkSecret}`,
);
check(
  policy.trustBoundary === 'workspace',
  'policy.trustBoundary is "workspace"',
  `got ${policy.trustBoundary}`,
);
check(
  policy.browserProfile?.persistent === false,
  'policy.browserProfile.persistent is false',
  `got ${policy.browserProfile?.persistent}`,
);
check(
  policy.browserProfile?.ephemeral === true,
  'policy.browserProfile.ephemeral is true',
  `got ${policy.browserProfile?.ephemeral}`,
);

// No cross-boundary tool in allow; each must appear in deny
const networkCrossBoundaryTools = ['browser_network_request', 'browser_file_upload'];
for (const tool of networkCrossBoundaryTools) {
  check(
    !(policy.allow ?? []).includes(tool),
    `cross-boundary tool "${tool}" not in policy.allow`,
  );
  check(
    (policy.deny ?? []).includes(tool),
    `cross-boundary tool "${tool}" is in policy.deny`,
  );
}

// ---------------------------------------------------------------------------
// [Suite 5] AC-3 — activation wiring coherence
// ---------------------------------------------------------------------------
console.log('\n[MCP-008/boundary] AC-3 — activation wiring coherence\n');

const activatedBy = profile.activatedBy ?? [];
check(activatedBy.includes('web-app'), 'profile.activatedBy includes "web-app"');
check(
  activatedBy.includes('product-design'),
  'profile.activatedBy includes "product-design"',
);
check(
  profile.dynamicActivation?.ticket === 'MCP-194',
  'dynamicActivation.ticket is MCP-194',
  `got ${profile.dynamicActivation?.ticket}`,
);
check(
  profile.dynamicActivation?.trigger === 'ui-fix-task',
  'dynamicActivation.trigger is "ui-fix-task"',
  `got ${profile.dynamicActivation?.trigger}`,
);

// riskClass must match registry
check(
  profile.riskClass === pwRegistryEntry?.risk,
  `profile.riskClass matches registry entry risk (${pwRegistryEntry?.risk})`,
  `profile=${profile.riskClass} registry=${pwRegistryEntry?.risk}`,
);

// ---------------------------------------------------------------------------
// [Suite 6] AC-4 — /mcp doctor contract fields
// ---------------------------------------------------------------------------
console.log('\n[MCP-008/boundary] AC-4 — /mcp doctor contract\n');

check(
  typeof pwRegistryEntry?.displayName === 'string' &&
    pwRegistryEntry.displayName.length > 0,
  'registry playwright displayName is non-empty',
);
check(
  pwRegistryEntry?.transport === 'stdio',
  'registry playwright transport is stdio (doctor expects stdio)',
);
check(
  Array.isArray(pwRegistryEntry?.capabilities?.tools) &&
    pwRegistryEntry.capabilities.tools.length > 0,
  'registry playwright capabilities.tools is non-empty',
);
check(
  typeof pwRegistryEntry?.pin?.npm === 'string' &&
    pwRegistryEntry.pin.npm.length > 0,
  'registry playwright has a pinned npm version',
);

// Doctor verifies the guarded profile lists allowed tools for handshake validation
check(
  profileAllowed.length > 0,
  'guarded profile has at least one allowed tool (doctor handshake)',
);

// At least 2 profile tools must appear in registry capabilities
const registryCaps           = new Set(pwRegistryEntry?.capabilities?.tools ?? []);
const profileToolsInRegistry = profileAllowed.filter((t) => registryCaps.has(t));
const profileToolsNotInReg   = profileAllowed.filter((t) => !registryCaps.has(t));

check(
  profileToolsInRegistry.length >= 2,
  `at least 2 profile tools overlap registry capabilities (${profileToolsInRegistry.join(', ')})`,
  `none of [${profileAllowed.join(', ')}] found in registry [${[...registryCaps].join(', ')}]`,
);

// Read-only guarded extras not in base registry are expected — report, not fail
if (profileToolsNotInReg.length > 0) {
  ok(
    `INFO: read-only profile tools not in base registry: ${profileToolsNotInReg.join(', ')} (expected — guarded additions)`,
  );
}

// Pairs with qa-e2e playbook
check(
  (profile.pairsWith ?? []).includes('qa-e2e'),
  'profile.pairsWith includes "qa-e2e"',
  `got ${JSON.stringify(profile.pairsWith)}`,
);

// ---------------------------------------------------------------------------
finish(SUITE);
