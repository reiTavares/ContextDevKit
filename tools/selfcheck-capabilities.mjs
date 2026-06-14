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
}
