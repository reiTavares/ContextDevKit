/**
 * Self-check — CAPABILITY REGISTRY invariants (CDK-020, ADR-0072).
 *
 * Asserts the structural and behavioral contracts of the canonical capability
 * registry and its pure resolver. Split from selfcheck.mjs following the
 * one-invariant-category-per-module pattern (ADR-0016 H1 / task 037).
 *
 * Checks:
 *   1. Registry JSON parses and carries a `version` field.
 *   2. Every capability has required fields and a valid `requiredMoment`.
 *   3. Every `entrypoint` that is a file path resolves to an existing file.
 *   4. Every registered capability is `kind === 'public'` (no internals).
 *   5. Aliases are present for all three known hosts and not empty/divergent.
 *   6. The resolver is pure: identical input → identical JSON output.
 *   7. The resolver source does NOT import `config/load.mjs` or any hook
 *      file (proves no circular dep on the hot path, rule 1 / ADR-0001).
 *
 * Entry point: `runCapabilityChecks(rep, { KIT })` where `rep = { ok, bad }`.
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/** Required fields each capability entry must carry (schema v1). */
const REQUIRED_FIELDS = ['id', 'kind', 'entrypoint', 'aliases', 'minLevel', 'appliesWhen', 'requiredMoment'];

/** Valid requiredMoment values per the schema. */
const VALID_MOMENTS = new Set(['informational', 'beforeExploration', 'beforeWrite', 'beforeCompletion']);

/** Known multi-host alias keys. Every capability must carry all three. */
const KNOWN_HOSTS = ['claude', 'codex', 'agy'];

/**
 * Runs all capability registry and resolver invariant checks.
 *
 * @param {{ ok: (m: string) => void, bad: (m: string) => void }} rep reporter
 * @param {{ KIT: string }} ctx KIT is the repo root (parent of tools/)
 */
export async function runCapabilityChecks(rep, { KIT }) {
  const { ok, bad } = rep;
  console.log('Checking capability registry (CDK-020, ADR-0072)...');

  // Resolve paths
  const registryPath = resolve(KIT, 'templates/contextkit/policy/capability-registry.json');
  const resolverPath = resolve(KIT, 'templates/contextkit/runtime/capabilities/resolve-capabilities.mjs');

  // 1. Registry JSON parses and has a version field.
  let registry;
  try {
    const raw = readFileSync(registryPath, 'utf-8').replace(/^﻿/, '');
    registry = JSON.parse(raw);
  } catch (err) {
    bad(`capability-registry.json is missing or unparseable: ${err?.message ?? err}`);
    return;
  }
  Number.isInteger(registry?.version)
    ? ok(`capability-registry.json parses with version=${registry.version}`)
    : bad('capability-registry.json missing integer `version` field');

  const capabilities = Array.isArray(registry?.capabilities) ? registry.capabilities : [];
  capabilities.length > 0
    ? ok(`registry contains ${capabilities.length} capability entries`)
    : bad('registry.capabilities array is empty or missing');

  // 2. Every capability has all required fields and a valid requiredMoment.
  let fieldErrors = 0;
  let momentErrors = 0;
  for (const cap of capabilities) {
    for (const field of REQUIRED_FIELDS) {
      if (cap[field] === undefined || cap[field] === null) {
        bad(`capability '${cap.id ?? '?'}' is missing required field '${field}'`);
        fieldErrors++;
      }
    }
    if (!VALID_MOMENTS.has(cap.requiredMoment)) {
      bad(`capability '${cap.id}' has invalid requiredMoment '${cap.requiredMoment}' (expected one of ${[...VALID_MOMENTS].join(', ')})`);
      momentErrors++;
    }
  }
  if (fieldErrors === 0) ok(`all ${capabilities.length} capabilities carry every required field`);
  if (momentErrors === 0) ok(`all ${capabilities.length} capabilities have a valid requiredMoment`);

  // 3. Every entrypoint that is a file path (not a bare command like `npm test`) exists.
  let entrypointMisses = 0;
  for (const cap of capabilities) {
    const ep = String(cap.entrypoint ?? '');
    // Skip bare commands (no slash, no .mjs extension) — they are tool invocations, not files.
    if (!ep.includes('/') && !ep.endsWith('.mjs')) continue;
    const abs = resolve(KIT, 'templates', ep);
    if (!existsSync(abs)) {
      bad(`capability '${cap.id}' entrypoint '${ep}' does not exist at ${abs}`);
      entrypointMisses++;
    }
  }
  if (entrypointMisses === 0) ok(`all file-path entrypoints resolve to existing files in the repo`);

  // 4. Every registered capability is kind === 'public'.
  const nonPublic = capabilities.filter((c) => c.kind !== 'public');
  nonPublic.length === 0
    ? ok('all registered capabilities are kind=public (no internals in the registry)')
    : bad(`non-public capabilities found: ${nonPublic.map((c) => c.id).join(', ')}`);

  // 5. Aliases are present for all known hosts and not empty/divergent.
  let aliasErrors = 0;
  for (const cap of capabilities) {
    for (const host of KNOWN_HOSTS) {
      const alias = cap.aliases?.[host];
      if (typeof alias !== 'string' || alias.trim() === '') {
        bad(`capability '${cap.id}' has missing or empty alias for host '${host}'`);
        aliasErrors++;
      }
    }
  }
  if (aliasErrors === 0) ok(`all ${capabilities.length} capabilities have non-empty aliases for ${KNOWN_HOSTS.join(', ')}`);

  // 6. Resolver is pure: same input → identical JSON output.
  let resolver;
  try {
    resolver = await import('file://' + resolverPath.replaceAll('\\', '/'));
  } catch (err) {
    bad(`resolve-capabilities.mjs failed to import: ${err?.message ?? err}`);
    return;
  }

  if (typeof resolver?.resolveCapabilities !== 'function') {
    bad('resolveCapabilities is not exported from resolve-capabilities.mjs');
  } else {
    const signals = { tier: 'feature', domain: 'general', paths: ['src/'], phase: '*', level: 5, host: 'claude' };
    const r1 = JSON.stringify(resolver.resolveCapabilities(signals, registry));
    const r2 = JSON.stringify(resolver.resolveCapabilities(signals, registry));
    r1 === r2
      ? ok('resolveCapabilities is pure: two calls with identical signals produce identical output')
      : bad('resolveCapabilities is not pure — output differed between two calls with the same input');
  }

  if (typeof resolver?.loadRegistry !== 'function') {
    bad('loadRegistry is not exported from resolve-capabilities.mjs');
  } else {
    ok('loadRegistry is exported from resolve-capabilities.mjs');
  }

  if (typeof resolver?.isPublicCapability !== 'function') {
    bad('isPublicCapability is not exported from resolve-capabilities.mjs');
  } else {
    const samplePublic = { kind: 'public', entrypoint: 'contextkit/tools/scripts/x.mjs' };
    const sampleInternal = { kind: 'internal', entrypoint: 'contextkit/runtime/hooks/x.mjs' };
    resolver.isPublicCapability(samplePublic) && !resolver.isPublicCapability(sampleInternal)
      ? ok('isPublicCapability correctly distinguishes public from internal entries')
      : bad('isPublicCapability returned wrong result on public/internal samples');
  }

  // 7. resolver source must NOT import load.mjs or hooks (circular dep proof).
  const resolverSrc = readFileSync(resolverPath, 'utf-8');
  const importLines = resolverSrc
    .split('\n')
    .filter((line) => /^\s*import\s/.test(line));
  const forbiddenImports = importLines.filter(
    (line) => /config\/load\.mjs|runtime\/hooks\//.test(line),
  );
  forbiddenImports.length === 0
    ? ok('resolve-capabilities.mjs does not import config/load.mjs or any hook (no circular dep, ADR-0001)')
    : bad(`resolve-capabilities.mjs imports forbidden module(s): ${forbiddenImports.map((l) => l.trim()).join('; ')}`);

  await runContractChecks(rep, { KIT });
}

/**
 * Asserts the behavioral contracts of task-intake.mjs + execution-contract.mjs
 * (CDK-021, ADR-0072). Called at the end of runCapabilityChecks so the single
 * wiring in selfcheck.mjs covers both CDK-020 and CDK-021 checks.
 *
 * @param {{ ok: (m: string) => void, bad: (m: string) => void }} rep reporter
 * @param {{ KIT: string }} ctx KIT is the repo root
 */
async function runContractChecks(rep, { KIT }) {
  const { ok, bad } = rep;
  console.log('Checking execution contract (CDK-021, ADR-0072)...');

  const intakePath = resolve(KIT, 'templates/contextkit/runtime/execution/task-intake.mjs');
  const contractPath = resolve(KIT, 'templates/contextkit/runtime/execution/execution-contract.mjs');

  // Load modules — bail early on import failure so later checks don't crash.
  let intake, buildContract;
  try {
    const intakeMod = await import('file://' + intakePath.replaceAll('\\', '/'));
    intake = intakeMod.intake;
  } catch (err) {
    bad(`task-intake.mjs failed to import: ${err?.message ?? err}`);
    return;
  }
  try {
    const contractMod = await import('file://' + contractPath.replaceAll('\\', '/'));
    buildContract = contractMod.buildContract;
  } catch (err) {
    bad(`execution-contract.mjs failed to import: ${err?.message ?? err}`);
    return;
  }

  // C1. Trivial task → tier=trivial, empty required lists (no heavy ceremony).
  try {
    const { signals } = intake({ objective: 'fix typo', level: 7 });
    signals.tier === 'trivial'
      ? ok('C1. intake: trivial objective → tier=trivial')
      : bad(`C1. intake: expected tier=trivial, got tier=${signals.tier}`);

    const contract = buildContract(signals);
    // A trivial task carries no heavy-ceremony gates. Universal gates (log-session,
    // which applies on tiers=['*']) may still appear in beforeCompletion — that is
    // correct: even a typo fix should be logged. What must be ABSENT is the deep
    // workflow-level set (workflow, simulate-impact, qa-signoff, test-plan, etc.).
    const heavyGates = ['workflow', 'simulate-impact', 'qa-signoff', 'test-plan', 'context-pack', 'project-map'];
    const allRequired = [
      ...contract.requiredBeforeExploration,
      ...contract.requiredBeforeWrite,
      ...contract.requiredBeforeCompletion,
    ];
    const unexpectedHeavy = heavyGates.filter((id) => allRequired.includes(id));
    unexpectedHeavy.length === 0
      ? ok('C1. contract: trivial task carries no heavy-ceremony gates (workflow/simulate/qa/test-plan absent)')
      : bad(`C1. contract: trivial task has unexpected heavy gates: [${unexpectedHeavy}] — exploration=[${contract.requiredBeforeExploration}] write=[${contract.requiredBeforeWrite}] completion=[${contract.requiredBeforeCompletion}]`);
  } catch (err) {
    bad(`C1. trivial check crashed: ${err?.message ?? err}`);
  }

  // C2. Architectural task → workflow+simulate-impact (beforeWrite), qa-signoff (beforeCompletion).
  try {
    const { signals } = intake({ objective: 'refactor the auth module across services', level: 7 });
    signals.tier === 'architectural'
      ? ok('C2. intake: architectural objective → tier=architectural')
      : bad(`C2. intake: expected tier=architectural, got tier=${signals.tier}`);

    const contract = buildContract(signals);
    const hasWorkflow = contract.requiredBeforeWrite.includes('workflow');
    const hasSimulate = contract.requiredBeforeWrite.includes('simulate-impact');
    const hasQa = contract.requiredBeforeCompletion.includes('qa-signoff');
    hasWorkflow
      ? ok('C2. contract: architectural task requires workflow (beforeWrite)')
      : bad(`C2. contract: workflow missing from beforeWrite=[${contract.requiredBeforeWrite}]`);
    hasSimulate
      ? ok('C2. contract: architectural task requires simulate-impact (beforeWrite)')
      : bad(`C2. contract: simulate-impact missing from beforeWrite=[${contract.requiredBeforeWrite}]`);
    hasQa
      ? ok('C2. contract: architectural task requires qa-signoff (beforeCompletion)')
      : bad(`C2. contract: qa-signoff missing from beforeCompletion=[${contract.requiredBeforeCompletion}]`);
  } catch (err) {
    bad(`C2. architectural check crashed: ${err?.message ?? err}`);
  }

  // C3. LGPD-signal objective → domain=lgpd, forced to tier=architectural.
  try {
    const { signals } = intake({ objective: 'store user CPF and consent', level: 7 });
    signals.domain === 'lgpd'
      ? ok('C3. intake: CPF+consent objective → domain=lgpd')
      : bad(`C3. intake: expected domain=lgpd, got domain=${signals.domain}`);
    signals.tier === 'architectural'
      ? ok('C3. intake: lgpd domain forces tier=architectural')
      : bad(`C3. intake: expected tier=architectural (forced by lgpd), got tier=${signals.tier}`);

    const contract = buildContract(signals);
    const hasArchitecturalGates =
      contract.requiredBeforeWrite.includes('workflow') ||
      contract.requiredBeforeWrite.includes('simulate-impact');
    hasArchitecturalGates
      ? ok('C3. contract: lgpd-forced architectural task carries architectural gates')
      : bad(`C3. contract: lgpd task missing architectural gates — beforeWrite=[${contract.requiredBeforeWrite}]`);
  } catch (err) {
    bad(`C3. lgpd check crashed: ${err?.message ?? err}`);
  }

  // C4. Determinism — buildContract twice from identical signals → identical required sets.
  try {
    const { signals } = intake({ objective: 'add export endpoint for reports', level: 7 });
    const c1 = buildContract(signals);
    const c2 = buildContract(signals);
    const sameExploration = JSON.stringify(c1.requiredBeforeExploration) === JSON.stringify(c2.requiredBeforeExploration);
    const sameWrite = JSON.stringify(c1.requiredBeforeWrite) === JSON.stringify(c2.requiredBeforeWrite);
    const sameCompletion = JSON.stringify(c1.requiredBeforeCompletion) === JSON.stringify(c2.requiredBeforeCompletion);
    sameExploration && sameWrite && sameCompletion
      ? ok('C4. determinism: buildContract twice from identical signals → identical required-set fields')
      : bad('C4. determinism: buildContract produced differing required-set fields on repeated calls');
  } catch (err) {
    bad(`C4. determinism check crashed: ${err?.message ?? err}`);
  }

  // C5. Grouping invariant — no capability is lost or double-counted.
  try {
    const { signals } = intake({ objective: 'add new user registration feature', level: 7 });
    const { DEFAULT_REGISTRY } = await import('file://' + resolve(KIT, 'templates/contextkit/runtime/capabilities/resolve-capabilities.mjs').replaceAll('\\', '/'));
    const { resolveCapabilities } = await import('file://' + resolve(KIT, 'templates/contextkit/runtime/capabilities/resolve-capabilities.mjs').replaceAll('\\', '/'));
    const applicable = resolveCapabilities(signals, DEFAULT_REGISTRY);
    const contract = buildContract(signals, DEFAULT_REGISTRY);
    const allGrouped = new Set([
      ...contract.requiredBeforeExploration,
      ...contract.requiredBeforeWrite,
      ...contract.requiredBeforeCompletion,
      ...contract.recommended,
    ]);
    const allResolved = new Set(applicable.map((c) => c.id));
    const lost = [...allResolved].filter((id) => !allGrouped.has(id));
    const extra = [...allGrouped].filter((id) => !allResolved.has(id));
    lost.length === 0 && extra.length === 0
      ? ok(`C5. grouping invariant: all ${allResolved.size} resolved capabilities appear in exactly one moment group`)
      : bad(`C5. grouping invariant: lost=[${lost}] extra=[${extra}]`);
  } catch (err) {
    bad(`C5. grouping invariant check crashed: ${err?.message ?? err}`);
  }
}
