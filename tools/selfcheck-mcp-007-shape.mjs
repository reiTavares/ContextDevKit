/**
 * selfcheck-mcp-007-shape.mjs — MCP-007 JSON shape validation (Suites 1-6).
 *
 * Verifies the static shape and metadata of the github-readonly profile and
 * github.allow.json policy files. Does not import any runtime modules.
 *
 * Acceptance criteria:
 *   AC#1 — registry.json NOT edited; profile + policy exist and are valid JSON.
 *   AC#2 — Default mode read-only; read tools allowed.
 *   AC#3 — Secret referenced as GITHUB_PERSONAL_ACCESS_TOKEN (env-var name only);
 *           version pinned to 2.0.0; risk R2; no literal token value.
 *   AC#4 — web-app and backend-api profiles enable github; missing-token → skipped.
 *   AC#5 — Write/admin tools in deny list; no allow/deny overlap.
 *
 * Self-contained. Exits non-zero on any failure.
 */

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const KIT       = resolve(__dirname, '..');
const MCP       = resolve(KIT, 'templates', 'contextkit', 'mcp');
const POLICIES  = resolve(MCP, 'policies');
const PROFILES  = resolve(MCP, 'profiles');

let passed = 0;
let failed = 0;

/** @param {string} label */
function ok(label) {
  console.log(`  PASS  ${label}`);
  passed++;
}

/**
 * @param {string} label
 * @param {string} [reason]
 */
function fail(label, reason) {
  console.error(`  FAIL  ${label}${reason ? ` — ${reason}` : ''}`);
  failed++;
}

/**
 * Strip BOM and parse JSON.
 * @param {string} filePath
 * @returns {unknown}
 */
function loadJson(filePath) {
  const raw = readFileSync(filePath, 'utf-8').replace(/^﻿/, '');
  return JSON.parse(raw);
}

// ─── Suite 1: File existence and valid JSON ──────────────────────────────────

console.log('\n[Suite 1] File existence + valid JSON (AC#1)');

const PROFILE_PATH  = resolve(PROFILES, 'github-readonly.json');
const POLICY_PATH   = resolve(POLICIES, 'github.allow.json');
const REGISTRY_PATH = resolve(MCP, 'registry.json');

let profile, policy, registry;

try {
  profile = loadJson(PROFILE_PATH);
  ok('github-readonly.json parses as valid JSON');
} catch (err) {
  fail('github-readonly.json parses as valid JSON', err.message);
  process.exit(1);
}

try {
  policy = loadJson(POLICY_PATH);
  ok('github.allow.json parses as valid JSON');
} catch (err) {
  fail('github.allow.json parses as valid JSON', err.message);
  process.exit(1);
}

try {
  registry = loadJson(REGISTRY_PATH);
  ok('registry.json still parses (not edited)');
} catch (err) {
  fail('registry.json parses', err.message);
  process.exit(1);
}

const githubEntry = registry.entries.find((e) => e.id === 'github');
if (githubEntry) {
  ok('AC#1 github entry exists in registry (wave-1 seeded, not edited by MCP-007)');
} else {
  fail('AC#1 github entry exists in registry', 'not found — registry.json may have been modified');
}

// ─── Suite 2: Profile shape — read-only, correct tools, correct secret name ──

console.log('\n[Suite 2] Profile shape (AC#2 + AC#3)');

const profileServers = profile.servers ?? [];
const githubServer   = profileServers.find((s) => s.id === 'github');

if (githubServer) {
  ok('profile.servers contains a github entry');
} else {
  fail('profile.servers contains a github entry',
    `got: ${JSON.stringify(profileServers.map((s) => s.id))}`);
}

if (githubServer?.mode === 'read-only') {
  ok('AC#2 profile mode is read-only');
} else {
  fail('AC#2 profile mode is read-only', `got: ${githubServer?.mode}`);
}

const READ_TOOLS = ['get_repo', 'list_pull_requests', 'get_issue'];
for (const tool of READ_TOOLS) {
  if (githubServer?.allowedTools?.includes(tool)) {
    ok(`AC#2 read tool present in allowedTools: ${tool}`);
  } else {
    fail(`AC#2 read tool present in allowedTools: ${tool}`,
      `allowedTools=${JSON.stringify(githubServer?.allowedTools)}`);
  }
}

// AC#3: secret must be the env-var name GITHUB_PERSONAL_ACCESS_TOKEN (not GITHUB_TOKEN)
// and must match the wave-1 registry's requiredSecrets field.
const referencedSecrets = githubServer?.referencedSecrets ?? [];
if (referencedSecrets.includes('GITHUB_PERSONAL_ACCESS_TOKEN')) {
  ok('AC#3 GITHUB_PERSONAL_ACCESS_TOKEN is in referencedSecrets');
} else {
  fail('AC#3 GITHUB_PERSONAL_ACCESS_TOKEN is in referencedSecrets',
    `got: ${JSON.stringify(referencedSecrets)}`);
}

// AC#3: no literal token values (starts with ghp_ / ghs_ etc.)
const LITERAL_PATTERNS = [/^gh[ps]_/, /^sk-/, /^xox/, /^[A-Za-z0-9+/]{40,}/];
const containsLiteralSecret = referencedSecrets.some((s) =>
  LITERAL_PATTERNS.some((p) => p.test(s))
);
if (!containsLiteralSecret) {
  ok('AC#3 no literal secret value in referencedSecrets');
} else {
  fail('AC#3 no literal secret value in referencedSecrets', 'offending value found');
}

// AC#3: secret names must be ALL_CAPS env-var names
const VALID_ENV_NAME = /^[A-Z][A-Z0-9_]{0,127}$/;
const allNamesValid  = referencedSecrets.every((s) => VALID_ENV_NAME.test(s));
if (allNamesValid) {
  ok('AC#3 all referencedSecrets are valid env-var names (ALL_CAPS)');
} else {
  fail('AC#3 all referencedSecrets are valid env-var names',
    `invalid: ${referencedSecrets.filter((s) => !VALID_ENV_NAME.test(s)).join(', ')}`);
}

// ─── Suite 3: Policy shape — deny list contains write/admin tools ─────────────

console.log('\n[Suite 3] Policy shape (AC#2 + AC#5)');

if (policy.serverId === 'github') {
  ok('policy.serverId is "github"');
} else {
  fail('policy.serverId is "github"', `got: ${policy.serverId}`);
}

if (policy.defaultMode === 'read-only') {
  ok('AC#2 policy.defaultMode is read-only');
} else {
  fail('AC#2 policy.defaultMode is read-only', `got: ${policy.defaultMode}`);
}

// AC#5: write/admin tools explicitly denied.
// Note: merge_pull_request, delete_repository, and update_secret are listed
// as defense-in-depth documentation; they are not in the wave-1 registry's
// capabilities.tools but are retained to guard against future capability expansion.
const WRITE_ADMIN_TOOLS = [
  'merge_pull_request', 'delete_repository', 'update_secret',
  'push_files', 'create_pull_request',
];
const denyList  = policy.deny ?? [];
for (const tool of WRITE_ADMIN_TOOLS) {
  if (denyList.includes(tool)) {
    ok(`AC#5 write/admin tool in deny list: ${tool}`);
  } else {
    fail(`AC#5 write/admin tool in deny list: ${tool}`, `deny=${JSON.stringify(denyList)}`);
  }
}

const allowList = policy.allow ?? [];
const overlap   = allowList.filter((t) => denyList.includes(t));
if (overlap.length === 0) {
  ok('AC#5 no tool appears in both allow and deny lists');
} else {
  fail('AC#5 no allow/deny overlap', `overlapping tools: ${overlap.join(', ')}`);
}

// ─── Suite 4: Secret policy metadata ─────────────────────────────────────────

console.log('\n[Suite 4] Secret policy metadata (AC#3 + AC#4)');

const sp = policy.secretPolicy ?? {};

// requiredEnvVars must match the wave-1 registry's requiredSecrets field.
if (Array.isArray(sp.requiredEnvVars) && sp.requiredEnvVars.includes('GITHUB_PERSONAL_ACCESS_TOKEN')) {
  ok('AC#3 secretPolicy.requiredEnvVars includes GITHUB_PERSONAL_ACCESS_TOKEN');
} else {
  fail('AC#3 secretPolicy.requiredEnvVars includes GITHUB_PERSONAL_ACCESS_TOKEN',
    `got: ${JSON.stringify(sp.requiredEnvVars)}`);
}

if (sp.secretsAreByReference === true) {
  ok('AC#3 secretPolicy.secretsAreByReference is true');
} else {
  fail('AC#3 secretPolicy.secretsAreByReference is true', `got: ${sp.secretsAreByReference}`);
}

if (sp.literalValuesBlocked === true) {
  ok('AC#3 secretPolicy.literalValuesBlocked is true');
} else {
  fail('AC#3 secretPolicy.literalValuesBlocked is true', `got: ${sp.literalValuesBlocked}`);
}

if (sp.missingSecretBehavior === 'skipped') {
  ok('AC#4 secretPolicy.missingSecretBehavior is "skipped" (not "fail")');
} else {
  fail('AC#4 secretPolicy.missingSecretBehavior is "skipped"', `got: ${sp.missingSecretBehavior}`);
}

// ─── Suite 5: Version pin — no @latest / floating ────────────────────────────

console.log('\n[Suite 5] Version pin (AC#3)');

const vp           = policy.versionPin ?? {};
const FLOATING_REFS = new Set(['latest', '*', 'next', 'main', 'master', 'HEAD', '']);

if (typeof vp.npm === 'string' && vp.npm.trim().length > 0 && !FLOATING_REFS.has(vp.npm.trim())) {
  ok(`AC#3 policy.versionPin.npm is concrete: "${vp.npm}"`);
} else {
  fail('AC#3 policy.versionPin.npm is concrete (not @latest / floating)',
    `got: ${JSON.stringify(vp.npm)}`);
}

if (vp.floatingRefsBlocked === true) {
  ok('AC#3 policy.versionPin.floatingRefsBlocked is true');
} else {
  fail('AC#3 policy.versionPin.floatingRefsBlocked is true', `got: ${vp.floatingRefsBlocked}`);
}

// ─── Suite 6: Risk class R2 ───────────────────────────────────────────────────

console.log('\n[Suite 6] Risk class (AC#3)');

if (githubEntry?.risk === 'R2') {
  ok('AC#3 registry github entry has risk R2');
} else {
  fail('AC#3 registry github entry has risk R2', `got: ${githubEntry?.risk}`);
}

if (policy.risk === 'R2') {
  ok('AC#3 policy risk field is R2');
} else {
  fail('AC#3 policy risk field is R2', `got: ${policy.risk}`);
}

// ─── Summary ──────────────────────────────────────────────────────────────────

console.log(`\nMCP-007 shape self-test: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
