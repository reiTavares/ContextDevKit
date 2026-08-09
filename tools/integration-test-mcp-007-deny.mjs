/**
 * integration-test-mcp-007-deny.mjs — MCP-007 sub-suite: policy engine deny paths +
 * render-shared guards + filterForHost host-restriction.
 *
 * Covers:
 *   [Suite 7]  AC#5 — evaluateServer: write-mode override / literal secret / floating
 *                      pin / undeclared tool are all DENIED; happy path is NOT denied
 *   [Suite 8]  AC#3 + AC#5 — render-shared assertSecretName rejects literals;
 *                             buildEnvRefs produces ${env:NAME} and rejects literals
 *   [Suite 13] AC#2 — filterForHost: github skipped when host not in allowedHosts;
 *                      wildcard allowedHosts allows any host
 *
 * Run:  node tools/integration-test-mcp-007-deny.mjs
 * Exits non-zero on any failure. Plain node:* — zero framework, zero deps.
 */

import { reporter } from './it-helpers.mjs';
import {
  loadFixtures,
  loadRuntimeModules,
  GITHUB_REG,
} from './integration-test-mcp-007-helpers.mjs';

const { ok, bad, finish } = reporter();

// ── Load JSON fixtures ────────────────────────────────────────────────────────

let registry;

try {
  const fixtures = loadFixtures();
  registry = fixtures.registry;
} catch (err) {
  bad(`JSON load failed — ${err.message}`);
  finish('MCP-007/deny (integration)');
}

const registryEntries = registry.entries ?? [];

// ── Load runtime modules ──────────────────────────────────────────────────────

const { evaluateServer, assertSecretName, buildEnvRefs, filterForHost } =
  await loadRuntimeModules({ ok, bad });

if (!evaluateServer) {
  bad('policy.mjs unavailable — cannot run deny tests');
  finish('MCP-007/deny (integration)');
}

// ── Build render-registry with wildcard host (needed for filterForHost suite) ─
const RENDER_REGISTRY = registryEntries.map((e) =>
  e.id === 'github' ? { ...e, allowedHosts: ['*'] } : e
);

const RENDER_MANIFEST = {
  servers: [{
    id: 'github',
    mode: 'read-only',
    referencedSecrets: ['GITHUB_TOKEN'],
    allowedTools: ['get_repo', 'list_pull_requests', 'get_issue'],
  }],
};

// ────────────────────────────────────────────────────────────────────────────
// [Suite 7] AC#5 — Policy engine deny paths
// ────────────────────────────────────────────────────────────────────────────

console.log('\n[Suite 7] AC#5 — policy engine denies write-mode / literal secret / floating pin / undeclared tool\n');

// Happy-path: read-only manifest → allowed, no write/literal deny reasons
const happyEval = evaluateServer(
  GITHUB_REG,
  { mode: 'read-only', referencedSecrets: ['GITHUB_TOKEN'], allowedTools: ['get_repo'] },
  'claude-code'
);
const writeDenyInHappy = (happyEval.reasons ?? []).some((r) => /write-override|secret:literal/.test(r));
!writeDenyInHappy
  ? ok('AC#5 happy-path (GITHUB_TOKEN, read-only) has no write-override or literal-secret deny reason')
  : bad(`AC#5 happy-path unexpectedly has write/literal deny reasons: ${happyEval.reasons.join(' | ')}`);

// Write-mode override on a read-only R2 server → DENY
const writeModeEval = evaluateServer(
  GITHUB_REG,
  { mode: 'write', referencedSecrets: ['GITHUB_TOKEN'], allowedTools: ['get_repo'] },
  'claude-code'
);
writeModeEval.decision === 'deny'
  ? ok('AC#5 write-mode override on R2 read-only server → DENY')
  : bad(`AC#5 write-mode override: expected deny, got ${writeModeEval.decision}`);
writeModeEval.reasons.some((r) => /write-override.*read-only/.test(r))
  ? ok('AC#5 deny reason references write-override-on-read-only')
  : bad(`AC#5 deny reason missing write-override pattern. reasons: ${writeModeEval.reasons.join(' | ')}`);

// Literal PAT in referencedSecrets → DENY (secret:literal-value)
const literalTokenEval = evaluateServer(
  GITHUB_REG,
  {
    mode: 'read-only',
    referencedSecrets: ['ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ01234'],
    allowedTools: ['get_repo'],
  },
  'claude-code'
);
literalTokenEval.decision === 'deny'
  ? ok('AC#5 literal PAT in referencedSecrets → DENY')
  : bad(`AC#5 literal PAT: expected deny, got ${literalTokenEval.decision}`);
literalTokenEval.reasons.some((r) => /secret:literal-value/.test(r))
  ? ok('AC#5 deny reason is secret:literal-value for literal PAT')
  : bad(`AC#5 literal PAT deny reason missing. reasons: ${literalTokenEval.reasons.join(' | ')}`);

// Floating pin (@latest) → DENY (supply-chain:unpinned-or-floating)
const floatingPinEval = evaluateServer(
  { ...GITHUB_REG, pin: { npm: 'latest' } },
  { mode: 'read-only', referencedSecrets: ['GITHUB_TOKEN'], allowedTools: ['get_repo'] },
  'claude-code'
);
floatingPinEval.decision === 'deny'
  ? ok('AC#5 floating pin (@latest) → DENY')
  : bad(`AC#5 floating pin: expected deny, got ${floatingPinEval.decision}`);
floatingPinEval.reasons.some((r) => /supply-chain:unpinned-or-floating/.test(r))
  ? ok('AC#5 floating pin deny reason is supply-chain:unpinned-or-floating')
  : bad(`AC#5 floating pin deny reason missing. reasons: ${floatingPinEval.reasons.join(' | ')}`);

// Undeclared tool in allowedTools → DENY (tools:undeclared-in-registry)
const undeclaredWriteEval = evaluateServer(
  GITHUB_REG,
  { mode: 'read-only', referencedSecrets: ['GITHUB_TOKEN'], allowedTools: ['launch_missile'] },
  'claude-code'
);
undeclaredWriteEval.decision === 'deny'
  ? ok('AC#5 undeclared tool in allowedTools → DENY')
  : bad(`AC#5 undeclared tool: expected deny, got ${undeclaredWriteEval.decision}`);
undeclaredWriteEval.reasons.some((r) => /tools:undeclared-in-registry/.test(r))
  ? ok('AC#5 undeclared tool deny reason is tools:undeclared-in-registry')
  : bad(`AC#5 undeclared tool reason missing. reasons: ${undeclaredWriteEval.reasons.join(' | ')}`);

// ────────────────────────────────────────────────────────────────────────────
// [Suite 8] AC#3 + AC#5 — render-shared assertSecretName + buildEnvRefs guards
// ────────────────────────────────────────────────────────────────────────────

console.log('\n[Suite 8] AC#3 + AC#5 — render-shared assertSecretName + buildEnvRefs\n');

if (assertSecretName) {
  // Valid env-var name must not throw
  try {
    assertSecretName('GITHUB_TOKEN', 'github');
    ok('AC#3 GITHUB_TOKEN passes assertSecretName (env-var name)');
  } catch (err) {
    bad(`AC#3 GITHUB_TOKEN should pass assertSecretName — threw: ${err.message}`);
  }

  // Literal GitHub PAT must throw TypeError
  try {
    assertSecretName('ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ01234', 'github');
    bad('AC#5 literal PAT must throw TypeError in assertSecretName — did not throw');
  } catch (err) {
    err instanceof TypeError
      ? ok('AC#5 literal PAT → TypeError from assertSecretName (fail-closed)')
      : bad(`AC#5 literal PAT threw non-TypeError: ${err.constructor.name}`);
  }

  // OpenAI-style key must throw TypeError
  try {
    assertSecretName('sk-abcdefghijklmnopqrstuvwxyz1234', 'github');
    bad('AC#5 OpenAI-style key must throw TypeError in assertSecretName — did not throw');
  } catch (err) {
    err instanceof TypeError
      ? ok('AC#5 OpenAI-style key → TypeError from assertSecretName')
      : bad(`AC#5 OpenAI key threw non-TypeError: ${err.constructor.name}`);
  }
} else {
  bad('Suite 8 skipped — render-shared.mjs unavailable');
}

if (buildEnvRefs) {
  // buildEnvRefs with GITHUB_TOKEN → value must be ${env:GITHUB_TOKEN}
  const envRefs = buildEnvRefs(['GITHUB_TOKEN'], 'github');
  envRefs['GITHUB_TOKEN'] === '${env:GITHUB_TOKEN}'
    ? ok('AC#3 buildEnvRefs produces ${env:GITHUB_TOKEN} for GITHUB_TOKEN')
    : bad(`AC#3 buildEnvRefs: expected \${env:GITHUB_TOKEN}, got ${envRefs['GITHUB_TOKEN']}`);

  // buildEnvRefs with literal PAT must throw TypeError
  let buildEnvRefsThrewOnLiteral = false;
  try {
    buildEnvRefs(['ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ01234'], 'github');
  } catch (err) {
    if (err instanceof TypeError) buildEnvRefsThrewOnLiteral = true;
  }
  buildEnvRefsThrewOnLiteral
    ? ok('AC#5 buildEnvRefs throws TypeError when given a literal PAT (fail-closed)')
    : bad('AC#5 buildEnvRefs must throw TypeError for literal PAT');
} else {
  bad('Suite 8 (buildEnvRefs) skipped — render-shared.mjs unavailable');
}

// ────────────────────────────────────────────────────────────────────────────
// [Suite 13] AC#2 — filterForHost host-restriction behavior
// ────────────────────────────────────────────────────────────────────────────

console.log('\n[Suite 13] AC#2 — filterForHost host-restriction behavior\n');

if (filterForHost) {
  // RESTRICTED_REGISTRY: allowedHosts: ['api.github.com'] — unknown host is skipped
  const { entries: filteredEntries, skipped } = filterForHost(
    RENDER_MANIFEST.servers, registryEntries, 'unknown-host-xyz'
  );

  filteredEntries.every((e) => e.id !== 'github')
    ? ok('AC#2 filterForHost: github skipped when host not in allowedHosts')
    : bad('AC#2 filterForHost: github should be skipped for unknown-host-xyz');

  skipped.includes('github')
    ? ok('AC#2 filterForHost: github appears in skipped list for restricted host')
    : bad(`AC#2 filterForHost: github not in skipped list. skipped=${JSON.stringify(skipped)}`);

  // Wildcard host registry → any host is allowed
  const { entries: wildcardEntries } = filterForHost(
    RENDER_MANIFEST.servers, RENDER_REGISTRY, 'any-host-at-all'
  );
  wildcardEntries.some((e) => e.id === 'github')
    ? ok('AC#2 filterForHost: github accessible when allowedHosts=[*]')
    : bad('AC#2 filterForHost: github should be in entries for wildcard allowedHosts');
} else {
  bad('Suite 13 skipped — render-shared.mjs (filterForHost) unavailable');
}

// ────────────────────────────────────────────────────────────────────────────
finish('MCP-007/deny (integration)');
