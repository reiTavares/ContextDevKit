/**
 * integration-test-capabilities.mjs — CDK-020 / ADR-0072.
 *
 * Table-driven tests for the canonical capability resolver. Confirms that
 * `resolveCapabilities` returns the correct capability id-set (and requiredMoment
 * for each) across tier/level/domain combinations, and that the output is
 * deterministic (byte-identical on repeated calls).
 *
 * Runs without a real project fixture — purely unit-level calls against the
 * loaded DEFAULT_REGISTRY (the embedded fallback in resolve-capabilities.mjs).
 * This mirrors the selfcheck pattern: no I/O, no subprocess, fast.
 */
import { resolve } from 'node:path';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { reporter } from './it-helpers.mjs';

const KIT = dirname(dirname(fileURLToPath(import.meta.url)));
const resolverPath = resolve(KIT, 'templates/contextkit/runtime/capabilities/resolve-capabilities.mjs');

const rep = reporter();

/** Load the resolver module fresh for this test file. */
let resolveCapabilities;
let DEFAULT_REGISTRY;
try {
  const mod = await import('file://' + resolverPath.replaceAll('\\', '/'));
  resolveCapabilities = mod.resolveCapabilities;
  DEFAULT_REGISTRY = mod.DEFAULT_REGISTRY;
} catch (err) {
  rep.bad(`Failed to import resolve-capabilities.mjs: ${err?.message ?? err}`);
  rep.finish('capabilities (CDK-020)');
}

/**
 * Convenience: resolve against the embedded default registry and return the id
 * set plus a map of id → requiredMoment.
 *
 * @param {object} signals task signals
 * @returns {{ ids: Set<string>, moments: Map<string, string> }}
 */
function resolve_(signals) {
  const caps = resolveCapabilities(signals, DEFAULT_REGISTRY);
  return {
    ids: new Set(caps.map((c) => c.id)),
    moments: new Map(caps.map((c) => [c.id, c.requiredMoment])),
  };
}

// ---------------------------------------------------------------------------
// Case 1: trivial tier, level 7 — heavy gates NOT required.
// The registry has no capability with tiers=["trivial"] or ["trivial", ...].
// "state" + "tests" + "log-session" apply on "*" tiers; the workflow/project-map
// etc. require tiers=["feature","architectural"] and thus do not apply for "trivial".
// ---------------------------------------------------------------------------
{
  const { ids, moments } = resolve_({ tier: 'trivial', domain: 'general', paths: ['src/x.ts'], phase: '*', level: 7 });
  const heavyGates = ['workflow', 'project-map', 'qa-signoff', 'simulate-impact', 'test-plan', 'context-pack'];
  const noHeavyGate = heavyGates.every((id) => !ids.has(id));
  noHeavyGate
    ? rep.ok('1. trivial tier L7: heavy gates (workflow/project-map/qa/simulate) are absent')
    : rep.bad(`1. trivial tier L7: unexpected heavy gate(s): ${heavyGates.filter((id) => ids.has(id)).join(', ')}`);
  // The "*"-tier gates still apply.
  ids.has('state') && ids.has('log-session')
    ? rep.ok('1. trivial tier L7: universal capabilities (state, log-session) present')
    : rep.bad(`1. trivial tier L7: universal cap(s) missing from: ${[...ids].join(', ')}`);
}

// ---------------------------------------------------------------------------
// Case 2: feature tier, level 7, generic domain — expected set.
// Expected (minLevel ≤ 7 and tiers match "feature"):
//   beforeExploration: context-pack, project-map
//   beforeWrite:       dev-start, workflow
//   beforeCompletion:  log-session, qa-signoff, test-plan, tests
// Plus universal star-tier caps: state, log-session, tests (minLevel 1).
// ---------------------------------------------------------------------------
{
  const { ids, moments } = resolve_({ tier: 'feature', domain: 'general', paths: ['src/'], phase: '*', level: 7 });
  const expectedExploration = ['context-pack', 'project-map'];
  const expectedWrite = ['dev-start', 'workflow'];
  const expectedCompletion = ['test-plan', 'tests', 'qa-signoff', 'log-session'];

  const allExpected = [...expectedExploration, ...expectedWrite, ...expectedCompletion, 'state'];
  const missing = allExpected.filter((id) => !ids.has(id));
  missing.length === 0
    ? rep.ok(`2. feature tier L7: all expected capabilities present (${allExpected.length} total)`)
    : rep.bad(`2. feature tier L7: missing: ${missing.join(', ')} — got: ${[...ids].join(', ')}`);

  // Verify requiredMoments for key capabilities.
  const momentChecks = [
    ['context-pack', 'beforeExploration'],
    ['project-map', 'beforeExploration'],
    ['workflow', 'beforeWrite'],
    ['dev-start', 'beforeWrite'],
    ['test-plan', 'beforeCompletion'],
    ['tests', 'beforeCompletion'],
    ['qa-signoff', 'beforeCompletion'],
    ['log-session', 'beforeCompletion'],
  ];
  const wrongMoments = momentChecks.filter(([id, want]) => moments.get(id) !== want);
  wrongMoments.length === 0
    ? rep.ok('2. feature tier L7: requiredMoment correct for all checked capabilities')
    : rep.bad(`2. feature tier L7: wrong requiredMoment(s): ${wrongMoments.map(([id, want]) => `${id}(want ${want}, got ${moments.get(id)})`).join('; ')}`);
}

// ---------------------------------------------------------------------------
// Case 3: architectural tier, level 7 — feature set + simulate-impact.
// ---------------------------------------------------------------------------
{
  const { ids } = resolve_({ tier: 'architectural', domain: 'general', paths: ['src/'], phase: '*', level: 7 });
  ids.has('simulate-impact')
    ? rep.ok('3. architectural tier L7: simulate-impact is present')
    : rep.bad(`3. architectural tier L7: simulate-impact missing — got: ${[...ids].join(', ')}`);

  // simulate-impact is beforeWrite.
  const { moments } = resolve_({ tier: 'architectural', domain: 'general', paths: ['src/'], phase: '*', level: 7 });
  moments.get('simulate-impact') === 'beforeWrite'
    ? rep.ok('3. architectural tier: simulate-impact has requiredMoment=beforeWrite')
    : rep.bad(`3. architectural tier: simulate-impact moment wrong: ${moments.get('simulate-impact')}`);

  // Feature-tier capabilities also appear.
  const featureCaps = ['context-pack', 'project-map', 'workflow', 'dev-start', 'test-plan', 'qa-signoff'];
  const missingFeature = featureCaps.filter((id) => !ids.has(id));
  missingFeature.length === 0
    ? rep.ok('3. architectural tier L7: all feature-tier capabilities also present')
    : rep.bad(`3. architectural tier L7: missing feature caps: ${missingFeature.join(', ')}`);
}

// ---------------------------------------------------------------------------
// Case 4: lgpd domain at feature tier, level 7 — same gates as general domain.
// The registry resolves by tier+level; domain filtering uses '*' for most caps.
// All feature-tier caps still apply; simulate-impact (architectural only) still absent.
// ---------------------------------------------------------------------------
{
  const { ids } = resolve_({ tier: 'feature', domain: 'lgpd', paths: ['src/'], phase: '*', level: 7 });
  const domainMandatory = ['context-pack', 'project-map', 'workflow', 'dev-start', 'test-plan', 'qa-signoff', 'log-session'];
  const missingDomain = domainMandatory.filter((id) => !ids.has(id));
  missingDomain.length === 0
    ? rep.ok('4. lgpd domain at feature tier: all mandatory gates are present')
    : rep.bad(`4. lgpd domain at feature tier: missing: ${missingDomain.join(', ')}`);

  // simulate-impact only applies when tier=architectural.
  !ids.has('simulate-impact')
    ? rep.ok('4. lgpd domain at feature tier: simulate-impact absent (tier not architectural)')
    : rep.bad('4. lgpd domain at feature tier: simulate-impact appeared unexpectedly');
}

// ---------------------------------------------------------------------------
// Case 5: level 2 project — minLevel filters out level-≥3 capabilities.
// project-map (minLevel 3), workflow (minLevel 3), context-pack (minLevel 3),
// simulate-impact (minLevel 5), test-plan (minLevel 4), qa-signoff (minLevel 4)
// must all be absent.
// ---------------------------------------------------------------------------
{
  const { ids } = resolve_({ tier: 'feature', domain: 'general', paths: ['src/'], phase: '*', level: 2 });
  const shouldBeAbsent = ['project-map', 'workflow', 'context-pack', 'simulate-impact', 'test-plan', 'qa-signoff'];
  const unexpectedlyPresent = shouldBeAbsent.filter((id) => ids.has(id));
  unexpectedlyPresent.length === 0
    ? rep.ok('5. level 2: capabilities with minLevel > 2 are excluded')
    : rep.bad(`5. level 2: unexpectedly present: ${unexpectedlyPresent.join(', ')}`);

  // Capabilities with minLevel ≤ 2 on a "*"-tier: state (1), tests (1), log-session (2), dev-start (2).
  // dev-start has tiers=["feature","architectural"] so it DOES apply.
  ids.has('dev-start') && ids.has('log-session') && ids.has('state') && ids.has('tests')
    ? rep.ok('5. level 2: capabilities with minLevel ≤ 2 are present (dev-start, log-session, state, tests)')
    : rep.bad(`5. level 2: expected low-minLevel caps missing — got: ${[...ids].join(', ')}`);
}

// ---------------------------------------------------------------------------
// Case 6: determinism — calling resolveCapabilities twice with the same
// signals produces byte-identical JSON.
// ---------------------------------------------------------------------------
{
  const signals = { tier: 'architectural', domain: 'lgpd', paths: ['src/auth/', 'db/'], phase: 'build', level: 6, host: 'claude' };
  const out1 = JSON.stringify(resolveCapabilities(signals, DEFAULT_REGISTRY));
  const out2 = JSON.stringify(resolveCapabilities(signals, DEFAULT_REGISTRY));
  out1 === out2
    ? rep.ok('6. determinism: two identical calls produce byte-identical JSON')
    : rep.bad('6. determinism: output differed between two calls with identical input');
}

rep.finish('capabilities (CDK-020)');
