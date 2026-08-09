/**
 * integration-test-mcp-007-policy.mjs — MCP-007 sub-suite: policy JSON contracts.
 *
 * Covers:
 *   [Suite 3] AC#2 + AC#5 — policy deny list contains write/admin tools; no allow/deny overlap
 *   [Suite 4] AC#3         — secret by reference; version pinned; risk R2
 *   [Suite 5] AC#4         — web-app and backend-api profiles include github in read-only mode
 *   [Suite 6] AC#4         — missing GITHUB_PERSONAL_ACCESS_TOKEN → skipped not fail
 *
 * Run:  node tools/integration-test-mcp-007-policy.mjs
 * Exits non-zero on any failure. Plain node:* — zero framework, zero deps.
 */

import { reporter } from './it-helpers.mjs';
import { loadFixtures, WRITE_ADMIN_TOOLS, LITERAL_RE } from './integration-test-mcp-007-helpers.mjs';

const { ok, bad, finish } = reporter();

// ── Load JSON fixtures ────────────────────────────────────────────────────────

let profile, policy, webApp, backendApi;

try {
  const fixtures = loadFixtures();
  profile    = fixtures.profile;
  policy     = fixtures.policy;
  webApp     = fixtures.webApp;
  backendApi = fixtures.backendApi;
} catch (err) {
  bad(`JSON load failed — ${err.message}`);
  finish('MCP-007/policy (integration)');
}

const profileServer = (profile.servers ?? []).find((s) => s.id === 'github');

// ────────────────────────────────────────────────────────────────────────────
// [Suite 3] AC#2 + AC#5 — policy deny list contains write/admin tools
// ────────────────────────────────────────────────────────────────────────────

console.log('\n[Suite 3] AC#2 + AC#5 — policy deny list contains write/admin tools\n');

policy.defaultMode === 'read-only'
  ? ok('AC#2 policy.defaultMode is read-only')
  : bad(`AC#2 policy.defaultMode: expected read-only, got ${policy.defaultMode}`);

const denyList  = policy.deny ?? [];
const allowList = policy.allow ?? [];

for (const tool of WRITE_ADMIN_TOOLS) {
  denyList.includes(tool)
    ? ok(`AC#5 write/admin tool '${tool}' is in policy deny list`)
    : bad(`AC#5 write/admin tool '${tool}' NOT in policy deny list`);
}

// No tool should appear in both allow and deny (logical invariant)
const overlap = allowList.filter((t) => denyList.includes(t));
overlap.length === 0
  ? ok('AC#5 no tool appears in both allow and deny lists')
  : bad(`AC#5 allow/deny overlap: ${overlap.join(', ')}`);

// ────────────────────────────────────────────────────────────────────────────
// [Suite 4] AC#3 — Secret is a name only; version pinned; risk R2
// ────────────────────────────────────────────────────────────────────────────

console.log('\n[Suite 4] AC#3 — secret by reference; version pinned; risk R2\n');

// Secret names must be env-var names, never literal tokens
const profileSecrets = profileServer?.referencedSecrets ?? [];
profileSecrets.includes('GITHUB_PERSONAL_ACCESS_TOKEN')
  ? ok('AC#3 GITHUB_PERSONAL_ACCESS_TOKEN present in profile referencedSecrets')
  : bad(`AC#3 GITHUB_PERSONAL_ACCESS_TOKEN missing from profile referencedSecrets — got: ${JSON.stringify(profileSecrets)}`);

// No literal token patterns in the profile at all
const allProfileSecrets = JSON.stringify(profile);
const literalLeakProfile = LITERAL_RE.some((p) => p.test(allProfileSecrets));
!literalLeakProfile
  ? ok('AC#3 no literal token patterns found anywhere in profile JSON')
  : bad('AC#3 literal token pattern detected in profile JSON — secret not by reference');

// No literal token patterns in the policy either
const allPolicyContent    = JSON.stringify(policy);
const literalLeakPolicy   = LITERAL_RE.some((p) => p.test(allPolicyContent));
!literalLeakPolicy
  ? ok('AC#3 no literal token patterns found in policy JSON')
  : bad('AC#3 literal token pattern detected in policy JSON');

// Version pinned — not @latest / floating
const FLOATING = new Set(['latest', '*', 'next', 'main', 'master', 'HEAD', '']);
const pinNpm   = policy.versionPin?.npm ?? '';
!FLOATING.has(pinNpm.trim()) && pinNpm.length > 0
  ? ok(`AC#3 policy versionPin.npm is concrete: "${pinNpm}"`)
  : bad(`AC#3 policy versionPin.npm is floating/missing: "${pinNpm}"`);

policy.versionPin?.floatingRefsBlocked === true
  ? ok('AC#3 policy versionPin.floatingRefsBlocked is true')
  : bad(`AC#3 policy versionPin.floatingRefsBlocked: expected true, got ${policy.versionPin?.floatingRefsBlocked}`);

// Risk R2
policy.risk === 'R2'
  ? ok('AC#3 policy risk is R2')
  : bad(`AC#3 policy risk: expected R2, got ${policy.risk}`);

// ────────────────────────────────────────────────────────────────────────────
// [Suite 5] AC#4 — web-app + backend-api profiles include github in read-only
// ────────────────────────────────────────────────────────────────────────────

console.log('\n[Suite 5] AC#4 — web-app and backend-api profiles include github\n');

const HARD_BLOCKED = Object.freeze([
  'merge_pull_request', 'delete_repository', 'update_secret',
  'push_files', 'add_collaborator', 'delete_file', 'create_release',
  'create_branch', 'create_repository', 'fork_repository',
]);

for (const [id, profileObj] of [['web-app', webApp], ['backend-api', backendApi]]) {
  const ghEntry = (profileObj.servers ?? []).find((s) => s.id === 'github');

  ghEntry
    ? ok(`AC#4 profile '${id}' includes github server`)
    : bad(`AC#4 profile '${id}' does NOT include github server`);

  ghEntry?.mode === 'read-only'
    ? ok(`AC#4 profile '${id}' github entry is read-only`)
    : bad(`AC#4 profile '${id}' github entry mode: expected read-only, got ${ghEntry?.mode}`);

  const hardBlockedInProfile = HARD_BLOCKED.filter((t) =>
    (ghEntry?.allowedTools ?? []).includes(t));
  hardBlockedInProfile.length === 0
    ? ok(`AC#4 profile '${id}' github allowedTools has no hard-blocked tools`)
    : bad(`AC#4 profile '${id}' github allowedTools contains hard-blocked tools: ${hardBlockedInProfile.join(', ')}`);
}

// ────────────────────────────────────────────────────────────────────────────
// [Suite 6] AC#4 — missing GITHUB_PERSONAL_ACCESS_TOKEN → skipped, not fail
// ────────────────────────────────────────────────────────────────────────────

console.log('\n[Suite 6] AC#4 — missing GITHUB_PERSONAL_ACCESS_TOKEN → skipped not fail\n');

policy.secretPolicy?.missingSecretBehavior === 'skipped'
  ? ok('AC#4 policy.secretPolicy.missingSecretBehavior is "skipped"')
  : bad(`AC#4 missingSecretBehavior: expected "skipped", got ${policy.secretPolicy?.missingSecretBehavior}`);

policy.secretPolicy?.secretsAreByReference === true
  ? ok('AC#4 secretsAreByReference is true')
  : bad(`AC#4 secretsAreByReference: expected true, got ${policy.secretPolicy?.secretsAreByReference}`);

policy.secretPolicy?.literalValuesBlocked === true
  ? ok('AC#4 literalValuesBlocked is true')
  : bad(`AC#4 literalValuesBlocked: expected true, got ${policy.secretPolicy?.literalValuesBlocked}`);

// ────────────────────────────────────────────────────────────────────────────
finish('MCP-007/policy (integration)');
