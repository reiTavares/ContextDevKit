/**
 * Pure capability resolver for the Canonical Capability Registry (CDK-020, ADR-0072).
 *
 * Zero runtime dependencies — only `node:*` and the canonical paths helper.
 * This module MUST NOT import `config/load.mjs` or any hook file to avoid
 * circular dependencies on the hot path.
 *
 * Consumers: selfcheck, slash commands, the governance substrate.
 * Not: hooks — they read config/load.mjs whose chain this module stays out of.
 */
import { existsSync, readFileSync } from 'node:fs';
import { pathsFor } from '../config/paths.mjs';

/**
 * Embedded fallback so resolveCapabilities works in any project that has not
 * yet seeded the registry (mirrors the DEFAULT_RUBRIC pattern in complexity-rubric.mjs).
 * Only the public API surface is listed — internal helpers are never registered here.
 *
 * @type {object}
 */
const DEFAULT_REGISTRY = Object.freeze({
  version: 1,
  capabilities: [
    {
      id: 'state',
      kind: 'public',
      entrypoint: 'contextkit/tools/scripts/context-pack.mjs',
      aliases: { claude: '/state', codex: 'cdx state', agy: 'agy state' },
      minLevel: 1,
      appliesWhen: { tiers: ['*'], domains: ['*'], paths: ['*'], phases: ['*'] },
      prerequisites: [],
      requiredMoment: 'informational',
      receiptType: 'state-summary',
      bypass: 'none',
      sideEffects: [],
    },
    {
      id: 'context-pack',
      kind: 'public',
      entrypoint: 'contextkit/tools/scripts/context-pack.mjs',
      aliases: { claude: '/context-pack', codex: 'cdx context-pack', agy: 'agy context-pack' },
      minLevel: 3,
      appliesWhen: { tiers: ['feature', 'architectural'], domains: ['*'], paths: ['*'], phases: ['*'] },
      prerequisites: [],
      requiredMoment: 'beforeExploration',
      receiptType: 'context-pack',
      bypass: 'none',
      sideEffects: [],
    },
    {
      id: 'project-map',
      kind: 'public',
      entrypoint: 'contextkit/tools/scripts/project-map.mjs',
      aliases: { claude: '/project-map', codex: 'cdx project-map', agy: 'agy project-map' },
      minLevel: 3,
      appliesWhen: { tiers: ['feature', 'architectural'], domains: ['*'], paths: ['*'], phases: ['*'] },
      prerequisites: [],
      requiredMoment: 'beforeExploration',
      receiptType: 'project-map',
      bypass: 'audited',
      sideEffects: ['writes contextkit/memory/project-map/'],
    },
    {
      id: 'workflow',
      kind: 'public',
      entrypoint: 'contextkit/tools/scripts/workflow.mjs',
      aliases: { claude: '/workflow', codex: 'cdx workflow', agy: 'agy workflow' },
      minLevel: 3,
      appliesWhen: { tiers: ['feature', 'architectural'], domains: ['*'], paths: ['*'], phases: ['*'] },
      prerequisites: [],
      requiredMoment: 'beforeWrite',
      receiptType: 'workflow-spec',
      bypass: 'audited',
      sideEffects: ['writes contextkit/memory/workflows/'],
    },
    {
      id: 'dev-start',
      kind: 'public',
      entrypoint: 'contextkit/tools/scripts/sync-check.mjs',
      aliases: { claude: '/dev-start', codex: 'cdx pipeline dev-start', agy: 'agy dev-start' },
      minLevel: 2,
      appliesWhen: { tiers: ['feature', 'architectural'], domains: ['*'], paths: ['*'], phases: ['*'] },
      prerequisites: [],
      requiredMoment: 'beforeWrite',
      receiptType: 'dev-start',
      bypass: 'none',
      sideEffects: [],
    },
    {
      id: 'simulate-impact',
      kind: 'public',
      entrypoint: 'contextkit/tools/scripts/mark-simulation.mjs',
      aliases: { claude: '/simulate-impact', codex: 'cdx simulate-impact', agy: 'agy simulate-impact' },
      minLevel: 5,
      appliesWhen: { tiers: ['architectural'], domains: ['*'], paths: ['*'], phases: ['*'] },
      prerequisites: [],
      requiredMoment: 'beforeWrite',
      receiptType: 'blast-radius-report',
      bypass: 'audited',
      sideEffects: ['writes contextkit/memory/predictions/'],
    },
    {
      id: 'test-plan',
      kind: 'public',
      entrypoint: 'contextkit/tools/scripts/scaffold-tests.mjs',
      aliases: { claude: '/test-plan', codex: 'cdx qa test-plan', agy: 'agy test-plan' },
      minLevel: 4,
      appliesWhen: { tiers: ['feature', 'architectural'], domains: ['*'], paths: ['*'], phases: ['*'] },
      prerequisites: [],
      requiredMoment: 'beforeCompletion',
      receiptType: 'test-plan',
      bypass: 'none',
      sideEffects: [],
    },
    {
      id: 'tests',
      kind: 'public',
      entrypoint: 'npm test',
      aliases: { claude: 'npm test', codex: 'npm test', agy: 'npm test' },
      minLevel: 1,
      appliesWhen: { tiers: ['feature', 'architectural'], domains: ['*'], paths: ['*'], phases: ['*'] },
      prerequisites: [],
      requiredMoment: 'beforeCompletion',
      receiptType: 'test-run',
      bypass: 'none',
      sideEffects: [],
    },
    {
      id: 'qa-signoff',
      kind: 'public',
      entrypoint: 'contextkit/tools/scripts/ship-state.mjs',
      aliases: { claude: '/qa-signoff', codex: 'cdx qa qa-signoff', agy: 'agy qa-signoff' },
      minLevel: 4,
      appliesWhen: { tiers: ['feature', 'architectural'], domains: ['*'], paths: ['*'], phases: ['*'] },
      prerequisites: ['tests', 'test-plan'],
      requiredMoment: 'beforeCompletion',
      receiptType: 'qa-signoff',
      bypass: 'audited',
      sideEffects: [],
    },
    {
      id: 'log-session',
      kind: 'public',
      entrypoint: 'contextkit/tools/scripts/session-draft.mjs',
      aliases: { claude: '/log-session', codex: 'cdx log-session', agy: 'agy log-session' },
      minLevel: 2,
      appliesWhen: { tiers: ['*'], domains: ['*'], paths: ['*'], phases: ['*'] },
      prerequisites: [],
      requiredMoment: 'beforeCompletion',
      receiptType: 'session-log',
      bypass: 'none',
      sideEffects: [
        'writes contextkit/memory/sessions/',
        'writes docs/CHANGELOG.md',
        'writes contextkit/memory/SESSIONS.md',
      ],
    },
  ],
});

/** Valid requiredMoment values per the schema. */
const VALID_MOMENTS = new Set(['informational', 'beforeExploration', 'beforeWrite', 'beforeCompletion']);

/**
 * Reads the capability registry from the project's policy file, falling back to
 * the embedded DEFAULT_REGISTRY on any I/O or parse failure. Never throws.
 *
 * @param {string} [root] project root (defaults to process.cwd())
 * @returns {object} registry with `version` and `capabilities` array
 */
export function loadRegistry(root = process.cwd()) {
  const registryPath = pathsFor(root).capabilityRegistry;
  if (!existsSync(registryPath)) return structuredClone(DEFAULT_REGISTRY);
  try {
    const raw = readFileSync(registryPath, 'utf-8').replace(/^﻿/, '');
    const parsed = JSON.parse(raw);
    return parsed && Number.isInteger(parsed.version) && Array.isArray(parsed.capabilities)
      ? parsed
      : structuredClone(DEFAULT_REGISTRY);
  } catch {
    return structuredClone(DEFAULT_REGISTRY);
  }
}

/**
 * Returns true when a task signal path matches an appliesWhen paths list.
 * `*` matches everything; prefix matching handles directory-level patterns.
 *
 * @param {string[]} signalPaths paths from the task signals
 * @param {string[]} policyPaths paths from the capability's appliesWhen
 * @returns {boolean}
 */
function pathMatches(signalPaths, policyPaths) {
  if (!Array.isArray(policyPaths) || policyPaths.includes('*')) return true;
  if (!Array.isArray(signalPaths) || signalPaths.length === 0) return true;
  return signalPaths.some((sp) =>
    policyPaths.some((pp) => pp === '*' || String(sp).startsWith(String(pp))),
  );
}

/**
 * Returns true when a signal value matches a policy list.
 * An entry of `*` in the policy list matches any signal value.
 *
 * @param {string} signalValue tier, domain, or phase from task signals
 * @param {string[]} policyList the appliesWhen field to check against
 * @returns {boolean}
 */
function listMatches(signalValue, policyList) {
  if (!Array.isArray(policyList) || policyList.includes('*')) return true;
  return policyList.includes(signalValue);
}

/**
 * Pure resolver. Determines which registered capabilities apply for the given
 * task signals. Same input always produces byte-identical output (sorted by id).
 *
 * A capability applies when ALL of the following hold:
 *   - `appliesWhen.tiers` includes the task's tier (or contains `*`)
 *   - `appliesWhen.domains` includes the task's domain (or contains `*`)
 *   - `appliesWhen.paths` matches at least one signal path (or contains `*`)
 *   - `appliesWhen.phases` includes the task's phase (or contains `*`)
 *   - `taskSignals.level >= capability.minLevel`
 *
 * @param {{ tier: string, domain: string, paths: string[], phase: string, level: number, host: string }} taskSignals
 * @param {object} [registry] capability registry (defaults to the embedded fallback)
 * @returns {object[]} matching capabilities sorted by id (stable/deterministic)
 */
export function resolveCapabilities(taskSignals, registry = DEFAULT_REGISTRY) {
  const { tier = 'feature', domain = 'general', paths = [], phase = '*', level = 1 } = taskSignals || {};
  const capabilities = Array.isArray(registry?.capabilities) ? registry.capabilities : [];

  const matching = capabilities.filter((cap) => {
    if (!isPublicCapability(cap)) return false;
    if (typeof cap.minLevel === 'number' && level < cap.minLevel) return false;
    const aw = cap.appliesWhen || {};
    if (!listMatches(tier, aw.tiers)) return false;
    if (!listMatches(domain, aw.domains)) return false;
    if (!listMatches(phase, aw.phases)) return false;
    if (!pathMatches(paths, aw.paths)) return false;
    return true;
  });

  return matching.slice().sort((a, b) => String(a.id).localeCompare(String(b.id)));
}

/**
 * Returns true when the registry entry represents a public, invocable capability
 * (kind === 'public' with a non-empty entrypoint). Internal helpers return false.
 *
 * @param {object} entry capability registry entry
 * @returns {boolean}
 */
export function isPublicCapability(entry) {
  return (
    entry !== null &&
    typeof entry === 'object' &&
    entry.kind === 'public' &&
    typeof entry.entrypoint === 'string' &&
    entry.entrypoint.length > 0
  );
}

export { DEFAULT_REGISTRY, VALID_MOMENTS };
