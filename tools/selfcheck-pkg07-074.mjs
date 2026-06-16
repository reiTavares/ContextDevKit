#!/usr/bin/env node
/**
 * CDK-074 self-check — governance policy-registry.
 *
 * Asserts four invariants:
 *   (1) Each PRESENT store contributes policies with the correct kind field.
 *   (2) §8 SAFETY: a store that is ABSENT in the fixture appears in
 *       sources.skipped and contributes ZERO policies (never fabricated).
 *   (3) counts.capability + counts.routing + counts.enforcement match
 *       the actual entries in the policies array by kind.
 *   (4) CLI `node policy-registry.mjs --json` exits 0 and stdout is
 *       parseable JSON with schemaVersion, policies[], counts, sources.
 *
 * Standalone runnable: node tools/selfcheck-pkg07-074.mjs
 * Exit 0 on all-pass, exit 1 on any failure.
 * Zero runtime deps — node:* only.
 */
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync, execSync } from 'node:child_process';
import { tmpdir } from 'node:os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const KIT = resolve(__dirname, '..');
const REGISTRY_PATH = resolve(KIT, 'templates/contextkit/tools/scripts/policy-registry.mjs');
const REGISTRY_URL  = pathToFileURL(REGISTRY_PATH).href;

let failures = 0;
const ok  = (msg) => console.log(`  ✓ ${msg}`);
const bad = (msg) => { console.error(`  ✗ ${msg}`); failures += 1; };

// ---------------------------------------------------------------------------
// Import the module under test
// ---------------------------------------------------------------------------
let buildPolicyRegistry;
try {
  ({ buildPolicyRegistry } = await import(REGISTRY_URL));
  ok('policy-registry.mjs imports cleanly');
} catch (err) {
  console.error(`FATAL: cannot import policy-registry.mjs: ${err?.message ?? err}`);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

const MINIMAL_CAPABILITY_REGISTRY = JSON.stringify({
  version: 1,
  capabilities: [
    {
      id: 'test-run',
      kind: 'public',
      entrypoint: 'contextkit/tools/scripts/scaffold-tests.mjs',
      aliases: { claude: '/test-plan' },
      minLevel: 1,
      appliesWhen: { tiers: ['*'], domains: ['*'], paths: ['*'], phases: ['*'] },
      prerequisites: [],
      requiredMoment: 'beforeCompletion',
      receiptType: 'test-run',
      bypass: 'none',
      sideEffects: [],
    },
  ],
}, null, 2);

const MINIMAL_ROUTING_POLICY = JSON.stringify({
  _note: 'fixture routing policy',
  adr: 'ADR-0052',
  updated: '2026-01-01',
  tiers: { fast: { alias: 'haiku' }, powerful: { alias: 'sonnet' } },
  ladder: ['fast', 'powerful'],
  floorTier: 'powerful',
  floorAgents: [],
  inheritAgents: [],
  taskClasses: {},
  agents: { 'test-agent': 'powerful' },
}, null, 2);

/**
 * Creates a minimal fixture project under a temp dir with git init.
 * Optionally seeds the capability and routing policy files.
 *
 * @param {{ withCapability?: boolean, withRouting?: boolean }} opts
 * @returns {string} fixture root path
 */
function buildFixtureRoot({ withCapability = true, withRouting = true } = {}) {
  const root = resolve(tmpdir(), `selfcheck-policy-registry-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`);
  mkdirSync(root, { recursive: true });
  try { execSync('git init -b main', { cwd: root, stdio: 'pipe' }); } catch {
    try { execSync('git init', { cwd: root, stdio: 'pipe' }); } catch { /* best-effort */ }
  }
  const policyDir = resolve(root, 'contextkit', 'policy');
  if (withCapability || withRouting) mkdirSync(policyDir, { recursive: true });
  if (withCapability) writeFileSync(resolve(policyDir, 'capability-registry.json'), MINIMAL_CAPABILITY_REGISTRY);
  if (withRouting)    writeFileSync(resolve(policyDir, 'routing-policy.json'), MINIMAL_ROUTING_POLICY);
  return root;
}

function cleanFixture(root) {
  try { rmSync(root, { recursive: true, force: true }); } catch { /* best-effort */ }
}

// ---------------------------------------------------------------------------
// (1) Present stores — each indexed with the correct kind
// ---------------------------------------------------------------------------
console.log('\n(1) Present stores — policies carry the correct kind field\n');

let fullRoot;
let fullRegistry;
try {
  fullRoot = buildFixtureRoot({ withCapability: true, withRouting: true });
  fullRegistry = await buildPolicyRegistry(fullRoot);
  ok('buildPolicyRegistry on seeded fixture: no throw');
} catch (err) {
  bad(`buildPolicyRegistry threw unexpectedly: ${err?.message ?? err}`);
  process.exit(failures > 0 ? 1 : 0);
}

// Capability store
const capPolicies = fullRegistry.policies.filter((p) => p.kind === 'capability');
capPolicies.length >= 1
  ? ok(`capability store: ${capPolicies.length} policies indexed with kind='capability'`)
  : bad(`capability store: expected ≥1 capability policy, got ${capPolicies.length}`);

capPolicies.every((p) => p.id.startsWith('capability:'))
  ? ok("capability policies: all ids prefixed 'capability:'")
  : bad("capability policies: some ids missing 'capability:' prefix");

// Routing store
const routePolicies = fullRegistry.policies.filter((p) => p.kind === 'routing');
routePolicies.length >= 1
  ? ok(`routing store: ${routePolicies.length} policies indexed with kind='routing'`)
  : bad(`routing store: expected ≥1 routing policy, got ${routePolicies.length}`);

routePolicies.every((p) => p.id.startsWith('routing:tier:'))
  ? ok("routing policies: all ids prefixed 'routing:tier:'")
  : bad("routing policies: some ids missing 'routing:tier:' prefix");

// Enforcement store — always present (comes from the module, not a data file)
const enforcePolicies = fullRegistry.policies.filter((p) => p.kind === 'enforcement');
enforcePolicies.length === 3
  ? ok(`enforcement store: 3 modes indexed (advisory, guarded, strict)`)
  : bad(`enforcement store: expected 3 enforcement modes, got ${enforcePolicies.length}`);

const expectedModes = ['advisory', 'guarded', 'strict'];
for (const mode of expectedModes) {
  enforcePolicies.some((p) => p.id === `enforcement:mode:${mode}`)
    ? ok(`enforcement mode '${mode}' is indexed`)
    : bad(`enforcement mode '${mode}' missing from registry`);
}

cleanFixture(fullRoot);

// ---------------------------------------------------------------------------
// (2) §8 SAFETY: absent store → skipped + zero policies (never fabricated)
// ---------------------------------------------------------------------------
console.log('\n(2) §8 SAFETY — absent store is skipped and contributes ZERO policies\n');

// Fixture with capability absent, routing absent: only enforcement remains.
let absenceRoot;
let absenceRegistry;
try {
  absenceRoot = buildFixtureRoot({ withCapability: false, withRouting: false });
  absenceRegistry = await buildPolicyRegistry(absenceRoot);
  ok('buildPolicyRegistry on absent-stores fixture: no throw (fail-open)');
} catch (err) {
  bad(`buildPolicyRegistry on absent fixture threw: ${err?.message ?? err}`);
  absenceRegistry = null;
}

if (absenceRegistry) {
  const capSkipped = absenceRegistry.sources.skipped.some((s) => s.includes('capability-registry'));
  capSkipped
    ? ok('absent capability-registry → appears in sources.skipped')
    : bad('absent capability-registry must appear in sources.skipped');

  const routeSkipped = absenceRegistry.sources.skipped.some((s) => s.includes('routing-policy'));
  routeSkipped
    ? ok('absent routing-policy → appears in sources.skipped')
    : bad('absent routing-policy must appear in sources.skipped');

  const fabricatedCap = absenceRegistry.policies.filter((p) => p.kind === 'capability');
  fabricatedCap.length === 0
    ? ok('§8: zero capability policies when store absent (no fabrication)')
    : bad(`§8 VIOLATION: ${fabricatedCap.length} capability policies fabricated when store absent`);

  const fabricatedRoute = absenceRegistry.policies.filter((p) => p.kind === 'routing');
  fabricatedRoute.length === 0
    ? ok('§8: zero routing policies when store absent (no fabrication)')
    : bad(`§8 VIOLATION: ${fabricatedRoute.length} routing policies fabricated when store absent`);

  absenceRegistry.counts.capability === 0
    ? ok('counts.capability is 0 when store absent')
    : bad(`counts.capability should be 0 when absent, got ${absenceRegistry.counts.capability}`);

  absenceRegistry.counts.routing === 0
    ? ok('counts.routing is 0 when store absent')
    : bad(`counts.routing should be 0 when absent, got ${absenceRegistry.counts.routing}`);
}

cleanFixture(absenceRoot);

// ---------------------------------------------------------------------------
// (3) counts match the actual policies[] lengths by kind
// ---------------------------------------------------------------------------
console.log('\n(3) counts match actual policies[] breakdown by kind\n');

let countsRoot;
let countsRegistry;
try {
  countsRoot = buildFixtureRoot({ withCapability: true, withRouting: true });
  countsRegistry = await buildPolicyRegistry(countsRoot);
  ok('buildPolicyRegistry for counts check: no throw');
} catch (err) {
  bad(`buildPolicyRegistry for counts threw: ${err?.message ?? err}`);
  countsRegistry = null;
}

if (countsRegistry) {
  const actualCap    = countsRegistry.policies.filter((p) => p.kind === 'capability').length;
  const actualRoute  = countsRegistry.policies.filter((p) => p.kind === 'routing').length;
  const actualEnforce = countsRegistry.policies.filter((p) => p.kind === 'enforcement').length;

  countsRegistry.counts.capability === actualCap
    ? ok(`counts.capability (${countsRegistry.counts.capability}) matches policies[] filter (${actualCap})`)
    : bad(`counts.capability mismatch: ${countsRegistry.counts.capability} vs ${actualCap}`);

  countsRegistry.counts.routing === actualRoute
    ? ok(`counts.routing (${countsRegistry.counts.routing}) matches policies[] filter (${actualRoute})`)
    : bad(`counts.routing mismatch: ${countsRegistry.counts.routing} vs ${actualRoute}`);

  countsRegistry.counts.enforcement === actualEnforce
    ? ok(`counts.enforcement (${countsRegistry.counts.enforcement}) matches policies[] filter (${actualEnforce})`)
    : bad(`counts.enforcement mismatch: ${countsRegistry.counts.enforcement} vs ${actualEnforce}`);
}

cleanFixture(countsRoot);

// ---------------------------------------------------------------------------
// (4) CLI --json exits 0 and stdout is parseable JSON with expected shape
// ---------------------------------------------------------------------------
console.log('\n(4) CLI --json: exit 0 + parseable JSON + required fields\n');

const cliResult = spawnSync(process.execPath, [REGISTRY_PATH, '--json'], {
  cwd: KIT,
  encoding: 'utf-8',
  timeout: 30_000,
});

cliResult.status === 0
  ? ok('CLI --json: exit code 0')
  : bad(`CLI --json: expected exit 0, got ${cliResult.status}; stderr: ${cliResult.stderr?.slice(0, 300)}`);

let cliParsed = null;
try {
  cliParsed = JSON.parse(cliResult.stdout);
  ok('CLI --json: stdout is valid JSON');
} catch (err) {
  bad(`CLI --json: stdout not parseable: ${err?.message ?? err}`);
}

if (cliParsed) {
  typeof cliParsed.schemaVersion === 'number'
    ? ok(`CLI JSON: schemaVersion present (${cliParsed.schemaVersion})`)
    : bad('CLI JSON: missing schemaVersion');

  Array.isArray(cliParsed.policies)
    ? ok(`CLI JSON: policies[] present (${cliParsed.policies.length} entries)`)
    : bad('CLI JSON: missing policies[]');

  cliParsed.counts && typeof cliParsed.counts === 'object'
    ? ok('CLI JSON: counts{} present')
    : bad('CLI JSON: missing counts{}');

  cliParsed.sources && Array.isArray(cliParsed.sources.present) && Array.isArray(cliParsed.sources.skipped)
    ? ok('CLI JSON: sources{present[], skipped[]} present')
    : bad('CLI JSON: missing or malformed sources{}');
}

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------
console.log(
  failures === 0
    ? '\n  PASS — CDK-074 policy-registry self-check: all checks passed.\n'
    : `\n  FAIL — CDK-074 policy-registry self-check: ${failures} check(s) failed.\n`,
);
process.exit(failures === 0 ? 0 : 1);
