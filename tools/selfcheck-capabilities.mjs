/**
 * Self-check — capability registry invariants (CDK-020, ADR-0072).
 *
 * The v4 runtime keeps the public capability catalog and its pure resolver, but
 * no longer builds or persists the v3 Execution Contract. This check therefore
 * covers only the surviving catalog boundary.
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const REQUIRED_FIELDS = ['id', 'kind', 'entrypoint', 'aliases', 'minLevel', 'appliesWhen', 'requiredMoment'];
const VALID_MOMENTS = new Set(['informational', 'beforeExploration', 'beforeWrite', 'beforeCompletion']);
const KNOWN_HOSTS = ['claude', 'codex', 'agy', 'grok'];

/**
 * Runs capability registry and resolver invariant checks.
 *
 * @param {{ ok: (message: string) => void, bad: (message: string) => void }} reporter check reporter
 * @param {{ KIT: string }} context repository context
 * @returns {Promise<void>} completion
 */
export async function runCapabilityChecks(reporter, { KIT }) {
  const { ok, bad } = reporter;
  console.log('Checking capability registry (CDK-020, ADR-0072)...');

  const registryPath = resolve(KIT, 'templates/contextkit/policy/capability-registry.json');
  const resolverPath = resolve(KIT, 'templates/contextkit/runtime/capabilities/resolve-capabilities.mjs');

  let registry;
  try {
    registry = JSON.parse(readFileSync(registryPath, 'utf-8').replace(/^\uFEFF/, ''));
  } catch (error) {
    bad(`capability-registry.json is missing or unparseable: ${error?.message ?? error}`);
    return;
  }

  Number.isInteger(registry?.version)
    ? ok(`capability-registry.json parses with version=${registry.version}`)
    : bad('capability-registry.json missing integer `version` field');

  const capabilities = Array.isArray(registry?.capabilities) ? registry.capabilities : [];
  capabilities.length > 0
    ? ok(`registry contains ${capabilities.length} capability entries`)
    : bad('registry.capabilities array is empty or missing');

  let fieldErrors = 0;
  let momentErrors = 0;
  for (const capability of capabilities) {
    for (const field of REQUIRED_FIELDS) {
      if (capability[field] === undefined || capability[field] === null) {
        bad(`capability '${capability.id ?? '?'}' is missing required field '${field}'`);
        fieldErrors += 1;
      }
    }
    if (!VALID_MOMENTS.has(capability.requiredMoment)) {
      bad(`capability '${capability.id}' has invalid requiredMoment '${capability.requiredMoment}'`);
      momentErrors += 1;
    }
  }
  if (fieldErrors === 0) ok(`all ${capabilities.length} capabilities carry every required field`);
  if (momentErrors === 0) ok(`all ${capabilities.length} capabilities have a valid requiredMoment`);

  let entrypointMisses = 0;
  for (const capability of capabilities) {
    const entrypoint = String(capability.entrypoint ?? '');
    if (!entrypoint.includes('/') && !entrypoint.endsWith('.mjs')) continue;
    const absoluteEntrypoint = resolve(KIT, 'templates', entrypoint);
    if (!existsSync(absoluteEntrypoint)) {
      bad(`capability '${capability.id}' entrypoint '${entrypoint}' does not exist at ${absoluteEntrypoint}`);
      entrypointMisses += 1;
    }
  }
  if (entrypointMisses === 0) ok('all file-path entrypoints resolve to existing files in the repo');

  const nonPublic = capabilities.filter((capability) => capability.kind !== 'public');
  nonPublic.length === 0
    ? ok('all registered capabilities are kind=public (no internals in the registry)')
    : bad(`non-public capabilities found: ${nonPublic.map((capability) => capability.id).join(', ')}`);

  let aliasErrors = 0;
  for (const capability of capabilities) {
    for (const host of KNOWN_HOSTS) {
      const alias = capability.aliases?.[host];
      if (typeof alias !== 'string' || alias.trim() === '') {
        bad(`capability '${capability.id}' has missing or empty alias for host '${host}'`);
        aliasErrors += 1;
      }
    }
  }
  if (aliasErrors === 0) {
    ok(`all ${capabilities.length} capabilities have non-empty aliases for ${KNOWN_HOSTS.join(', ')}`);
  }

  let resolver;
  try {
    resolver = await import(`file://${resolverPath.replaceAll('\\', '/')}`);
  } catch (error) {
    bad(`resolve-capabilities.mjs failed to import: ${error?.message ?? error}`);
    return;
  }

  if (typeof resolver?.resolveCapabilities !== 'function') {
    bad('resolveCapabilities is not exported from resolve-capabilities.mjs');
  } else {
    const signals = {
      tier: 'feature',
      domain: 'general',
      paths: ['src/'],
      phase: '*',
      level: 5,
      host: 'claude',
    };
    const firstResolution = JSON.stringify(resolver.resolveCapabilities(signals, registry));
    const secondResolution = JSON.stringify(resolver.resolveCapabilities(signals, registry));
    firstResolution === secondResolution
      ? ok('resolveCapabilities is pure: identical signals produce identical output')
      : bad('resolveCapabilities is not pure');
  }

  typeof resolver?.loadRegistry === 'function'
    ? ok('loadRegistry is exported from resolve-capabilities.mjs')
    : bad('loadRegistry is not exported from resolve-capabilities.mjs');

  if (typeof resolver?.isPublicCapability !== 'function') {
    bad('isPublicCapability is not exported from resolve-capabilities.mjs');
  } else {
    const publicCapability = { kind: 'public', entrypoint: 'contextkit/tools/scripts/x.mjs' };
    const internalCapability = { kind: 'internal', entrypoint: 'contextkit/runtime/hooks/x.mjs' };
    resolver.isPublicCapability(publicCapability) && !resolver.isPublicCapability(internalCapability)
      ? ok('isPublicCapability distinguishes public from internal entries')
      : bad('isPublicCapability returned the wrong public/internal verdict');
  }

  const resolverImports = readFileSync(resolverPath, 'utf-8')
    .split('\n')
    .filter((line) => /^\s*import\s/.test(line));
  const forbiddenImports = resolverImports.filter(
    (line) => /config\/load\.mjs|runtime\/hooks\//.test(line),
  );
  forbiddenImports.length === 0
    ? ok('resolve-capabilities.mjs has no config/load or hook import')
    : bad(`resolve-capabilities.mjs imports forbidden modules: ${forbiddenImports.join('; ')}`);
}
