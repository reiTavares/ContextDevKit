/**
 * selfcheck-mcp-007-engine.mjs — MCP-007 policy engine + render guard tests (Suites 7-9).
 *
 * Tests the runtime policy engine and render-layer secret guard against the
 * REAL registry entry for the github server. Uses no fabricated capability lists
 * — all evaluations are against registry.json as it actually exists on disk
 * (constitution §8: graceful degradation reports 'skipped', never a false pass).
 *
 * Acceptance criteria:
 *   AC#5 — Write tools denied-by-default; secret-by-reference enforced by policy engine.
 *   AC#3 — assertSecretName rejects literal PATs; looksLikeSecretValue flags them.
 *   AC#4 — web-app and backend-api profiles both enable github in read-only mode.
 *
 * Self-contained. Exits non-zero on any failure.
 */

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const KIT       = resolve(__dirname, '..');
const MCP       = resolve(KIT, 'templates', 'contextkit', 'mcp');
const PROFILES  = resolve(MCP, 'profiles');
const REGISTRY_PATH = resolve(MCP, 'registry.json');

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

// ─── Load real registry entry ─────────────────────────────────────────────────

const registry     = loadJson(REGISTRY_PATH);
const registryEntry = registry.entries.find((e) => e.id === 'github');

if (!registryEntry) {
  console.error('  FATAL  github entry missing from registry.json — cannot run engine tests');
  process.exit(1);
}

// ─── Suite 7: Policy engine — evaluated against the REAL registry entry ────────

console.log('\n[Suite 7] Policy engine — write tools denied-by-default (AC#5)');
console.log('         (Using real registry.json github entry — no fabricated capabilities)');

let evaluateServer;
try {
  const policyModule = await import(
    new URL('../templates/contextkit/runtime/mcp/policy.mjs', import.meta.url)
  );
  evaluateServer = policyModule.evaluateServer;
  ok('policy.mjs imported successfully');
} catch (err) {
  fail('policy.mjs imported', err.message);
  process.exit(1);
}

// AC#5: write mode override on R2 read-only server → DENY.
// The policy engine denies write-mode overrides on servers whose defaultMode is
// read-only regardless of the capabilities list. This check does not depend on
// the registry declaring any specific tools.
const writeModeEval = evaluateServer(
  registryEntry,
  { mode: 'write', referencedSecrets: ['GITHUB_PERSONAL_ACCESS_TOKEN'], allowedTools: ['get_repo'] },
  'claude-code'
);

if (writeModeEval.decision === 'deny') {
  ok('AC#5 write mode override on R2 read-only server → DENY');
} else {
  fail('AC#5 write mode override → deny',
    `got decision=${writeModeEval.decision}, reasons=${writeModeEval.reasons.join('|')}`);
}

const writeModeReason = writeModeEval.reasons.some((r) => /write-override.*read-only/.test(r));
if (writeModeReason) {
  ok('AC#5 deny reason references write-override-on-read-only');
} else {
  fail('AC#5 deny reason references write-override-on-read-only',
    `reasons: ${writeModeEval.reasons.join(' | ')}`);
}

// AC#5: literal GitHub PAT in referencedSecrets → DENY with secret:literal-value.
const literalSecretEval = evaluateServer(
  registryEntry,
  {
    mode: 'read-only',
    referencedSecrets: ['ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123'],
    allowedTools: ['get_repo'],
  },
  'claude-code'
);

if (literalSecretEval.decision === 'deny') {
  ok('AC#5 literal GitHub token in referencedSecrets → DENY');
} else {
  fail('AC#5 literal token → deny',
    `got: ${literalSecretEval.decision}, reasons=${literalSecretEval.reasons.join('|')}`);
}

const literalReason = literalSecretEval.reasons.some((r) => /secret:literal-value/.test(r));
if (literalReason) {
  ok('AC#5 deny reason references secret:literal-value');
} else {
  fail('AC#5 deny reason references secret:literal-value',
    `reasons: ${literalSecretEval.reasons.join(' | ')}`);
}

// AC#5: env-var name GITHUB_PERSONAL_ACCESS_TOKEN must not trigger literal-value deny.
const validSecretEval = evaluateServer(
  registryEntry,
  {
    mode: 'read-only',
    referencedSecrets: ['GITHUB_PERSONAL_ACCESS_TOKEN'],
    allowedTools: ['get_repo'],
  },
  'claude-code'
);

const hasLiteralDeny = validSecretEval.reasons.some((r) => /secret:literal-value/.test(r));
if (!hasLiteralDeny) {
  ok('AC#5 GITHUB_PERSONAL_ACCESS_TOKEN as secret reference — no literal-value deny reason');
} else {
  fail('AC#5 GITHUB_PERSONAL_ACCESS_TOKEN must not trigger literal-value deny',
    `reasons: ${validSecretEval.reasons.join(' | ')}`);
}

// AC#5: undeclared tool (not in registry.json capabilities.tools) → DENY.
const undeclaredEval = evaluateServer(
  registryEntry,
  {
    mode: 'read-only',
    referencedSecrets: ['GITHUB_PERSONAL_ACCESS_TOKEN'],
    allowedTools: ['launch_missile'],
  },
  'claude-code'
);

if (undeclaredEval.decision === 'deny') {
  ok('AC#5 undeclared tool in allowedTools → DENY (tools:undeclared-in-registry)');
} else {
  fail('AC#5 undeclared tool → deny',
    `got: ${undeclaredEval.decision}, reasons=${undeclaredEval.reasons.join('|')}`);
}

const undeclaredReason = undeclaredEval.reasons.some((r) => /tools:undeclared-in-registry/.test(r));
if (undeclaredReason) {
  ok('AC#5 undeclared tool deny reason is tools:undeclared-in-registry');
} else {
  fail('AC#5 undeclared tool deny reason missing',
    `reasons: ${undeclaredEval.reasons.join(' | ')}`);
}

// ─── Suite 8: Profile enablement (AC#4) ───────────────────────────────────────

console.log('\n[Suite 8] Profile enablement (AC#4)');

for (const profileId of ['web-app', 'backend-api']) {
  try {
    const p        = loadJson(resolve(PROFILES, `${profileId}.json`));
    const hasGithub = (p.servers ?? []).some((s) => s.id === 'github');
    if (hasGithub) {
      ok(`AC#4 profile '${profileId}' includes github server`);
    } else {
      fail(`AC#4 profile '${profileId}' includes github server`,
        `servers: ${JSON.stringify((p.servers ?? []).map((s) => s.id))}`);
    }
    const ghEntry = (p.servers ?? []).find((s) => s.id === 'github');
    if (ghEntry?.mode === 'read-only') {
      ok(`AC#4 '${profileId}' github entry is read-only`);
    } else {
      fail(`AC#4 '${profileId}' github entry is read-only`, `got mode=${ghEntry?.mode}`);
    }
    // Both profiles use the canonical secret name matching the registry.
    const secretName = 'GITHUB_PERSONAL_ACCESS_TOKEN';
    if ((ghEntry?.referencedSecrets ?? []).includes(secretName)) {
      ok(`AC#4 '${profileId}' github referencedSecrets uses ${secretName}`);
    } else {
      fail(`AC#4 '${profileId}' github referencedSecrets must use ${secretName}`,
        `got: ${JSON.stringify(ghEntry?.referencedSecrets)}`);
    }
  } catch (err) {
    fail(`AC#4 profile '${profileId}' readable`, err.message);
  }
}

// ─── Suite 9: assertSecretName + looksLikeSecretValue render guards (AC#3) ────

console.log('\n[Suite 9] Render layer secret guard (AC#3)');

let assertSecretName;
try {
  const rs = await import(
    new URL('../templates/contextkit/runtime/mcp/render/render-shared.mjs', import.meta.url)
  );
  assertSecretName = rs.assertSecretName;
  ok('render-shared.mjs imported');
} catch (err) {
  fail('render-shared.mjs imported', err.message);
  process.exit(1);
}

// Valid canonical name must not throw.
try {
  assertSecretName('GITHUB_PERSONAL_ACCESS_TOKEN', 'github');
  ok('AC#3 GITHUB_PERSONAL_ACCESS_TOKEN passes assertSecretName without throw');
} catch (err) {
  fail('AC#3 GITHUB_PERSONAL_ACCESS_TOKEN passes assertSecretName', err.message);
}

// Literal PAT must throw TypeError (fail-closed).
try {
  assertSecretName('ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123', 'github');
  fail('AC#3 literal PAT fails assertSecretName', 'expected TypeError not thrown');
} catch {
  ok('AC#3 literal GitHub PAT rejected by assertSecretName (TypeError)');
}

let looksLikeSecretValue;
try {
  const ss = await import(
    new URL('../templates/contextkit/runtime/mcp/secret-shape.mjs', import.meta.url)
  );
  looksLikeSecretValue = ss.looksLikeSecretValue;
  ok('secret-shape.mjs imported');
} catch (err) {
  fail('secret-shape.mjs imported', err.message);
  process.exit(1);
}

if (!looksLikeSecretValue('GITHUB_PERSONAL_ACCESS_TOKEN')) {
  ok('AC#3 GITHUB_PERSONAL_ACCESS_TOKEN is NOT flagged as a secret value (it is a name)');
} else {
  fail('AC#3 GITHUB_PERSONAL_ACCESS_TOKEN should not be flagged as a secret value');
}

if (looksLikeSecretValue('ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123')) {
  ok('AC#3 literal PAT IS flagged as a secret value by secret-shape');
} else {
  fail('AC#3 literal PAT should be flagged as a secret value');
}

// ─── Summary ──────────────────────────────────────────────────────────────────

console.log(`\nMCP-007 engine self-test: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
