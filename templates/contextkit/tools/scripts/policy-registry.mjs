#!/usr/bin/env node
/**
 * policy-registry.mjs — READ-ONLY unified index over the kit's governance-policy stores.
 *
 * Purpose: a single enumeration surface over three siloed policy stores so
 * that governance consumers (CDK-071, auditors, the FinOps squad) can discover
 * every active policy in one call instead of importing three separate modules
 * and knowing their individual load paths.
 *
 * CDK-074, ADR-0072 governance substrate.
 *
 * Three policy stores indexed:
 *   capability  — contextkit/policy/capability-registry.json (loadRegistry)
 *   routing     — contextkit/policy/routing-policy.json      (loadPolicy)
 *   enforcement — runtime/execution/enforcement-modes.mjs    (VALID_MODES / resolveEnforcementMode)
 *
 * Contract: advisory + read-only + fail-open. Each store is wrapped
 * independently; a missing or broken store goes to sources.skipped and
 * contributes ZERO policies. Nothing is fabricated (§8).
 *
 * CLI:   node policy-registry.mjs [--json]   — always exit 0
 * Library: export buildPolicyRegistry(root?)
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve, relative, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { pathsFor, PLATFORM_DIR } from '../../runtime/config/paths.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Relative path (from kit root) to THIS script — used to locate siblings. */
const HERE = __dirname;

// ---------------------------------------------------------------------------
// Schema version
// ---------------------------------------------------------------------------

/** Bumped when the registry shape changes in a breaking way. */
const SCHEMA_VERSION = 1;

// ---------------------------------------------------------------------------
// Store loaders (each fail-open — never throw to the caller)
// ---------------------------------------------------------------------------

/**
 * Loads capability policies from the capability-registry.json store.
 *
 * Returns { entries, sourceLabel, present } on success or { entries: [],
 * sourceLabel, present: false } on any I/O / import error.
 *
 * The source label uses the pathsFor key value to avoid a 'contextkit/'
 * literal in resolve() / join() (rule 4).
 *
 * @param {string} root project root
 * @returns {Promise<{ entries: object[], sourceLabel: string, present: boolean }>}
 */
async function loadCapabilityStore(root) {
  const paths = pathsFor(root);
  // Build source label from the pathsFor value, not a hardcoded literal.
  const sourceLabel = relative(root, paths.capabilityRegistry).replaceAll('\\', '/');
  // Guard: loadRegistry() embeds a DEFAULT_REGISTRY fallback, so it never
  // throws on a missing file. We must check physical presence first to
  // distinguish "not seeded" (skipped) from "seeded + loaded" (present).
  // A missing file means the store was never installed — treat as skipped (§8).
  if (!existsSync(paths.capabilityRegistry)) {
    return { entries: [], sourceLabel, present: false };
  }
  try {
    const resolverPath = resolve(HERE, '../../runtime/capabilities/resolve-capabilities.mjs');
    const { loadRegistry } = await import(pathToFileURL(resolverPath).href);
    const registry = loadRegistry(root);
    const capabilities = Array.isArray(registry?.capabilities) ? registry.capabilities : [];
    const entries = capabilities.map((cap) => ({
      id: `capability:${cap.id}`,
      kind: 'capability',
      source: sourceLabel,
      scope: cap.minLevel != null ? `minLevel:${cap.minLevel}` : 'all',
      summary: `${cap.kind ?? 'public'} capability "${cap.id}" — ${cap.requiredMoment ?? 'informational'}`,
      present: true,
    }));
    return { entries, sourceLabel, present: true };
  } catch {
    return { entries: [], sourceLabel, present: false };
  }
}

/**
 * Loads routing policies from routing-policy.json.
 *
 * The policy file path is derived from pathsFor(root).policy so no
 * 'contextkit/' literal appears in resolve() / join() (rule 4).
 *
 * @param {string} root project root
 * @returns {Promise<{ entries: object[], sourceLabel: string, present: boolean }>}
 */
async function loadRoutingStore(root) {
  const paths = pathsFor(root);
  const policyFile = resolve(paths.policy, 'routing-policy.json');
  const sourceLabel = relative(root, policyFile).replaceAll('\\', '/');
  try {
    if (!existsSync(policyFile)) return { entries: [], sourceLabel, present: false };
    const raw = readFileSync(policyFile, 'utf-8').replace(/^﻿/, '');
    const policy = JSON.parse(raw);
    // Require the three fields that have always been present (tiers, ladder, agents).
    // hostModels is optional — older installs may predate it; we index what we can.
    if (!policy.tiers || !Array.isArray(policy.ladder) || !policy.agents) {
      return { entries: [], sourceLabel, present: false };
    }
    const tiers = Object.keys(policy.tiers ?? {});
    const agentCount = Object.keys(policy.agents ?? {}).length;
    const inheritCount = (policy.inheritAgents ?? []).length;
    const entries = tiers.map((tier) => ({
      id: `routing:tier:${tier}`,
      kind: 'routing',
      source: sourceLabel,
      scope: `tier/${tier}`,
      summary: `Routing tier "${tier}" → alias "${policy.tiers[tier]?.alias ?? '?'}" (${agentCount} agents, ${inheritCount} inherit)`,
      present: true,
    }));
    return { entries, sourceLabel, present: true };
  } catch {
    return { entries: [], sourceLabel, present: false };
  }
}

/**
 * Loads enforcement mode policy from enforcement-modes.mjs.
 *
 * The source label is the relative path to the enforcement-modes module;
 * the actual modes are the valid enumeration values exported as VALID_MODES.
 *
 * @param {string} root project root — used only to derive a relative label
 * @returns {Promise<{ entries: object[], sourceLabel: string, present: boolean }>}
 */
async function loadEnforcementStore(root) {
  const modesPath = resolve(HERE, '../../runtime/execution/enforcement-modes.mjs');
  // Build label relative to root so paths stay portable.
  const sourceLabel = relative(root, modesPath).replaceAll('\\', '/');
  try {
    const { resolveEnforcementMode } = await import(pathToFileURL(modesPath).href);
    // Derive the valid modes the same way enforcement-modes.mjs does — by probing
    // each known mode string. This avoids importing a private constant.
    const knownModes = ['advisory', 'guarded', 'strict'];
    const entries = knownModes.map((mode) => {
      // Confirm each string is recognized by the resolver (resolves to itself).
      const resolved = resolveEnforcementMode({ enforcement: { mode } });
      const isValid = resolved === mode;
      return {
        id: `enforcement:mode:${mode}`,
        kind: 'enforcement',
        source: sourceLabel,
        scope: 'global',
        summary: `Enforcement mode "${mode}" — ${modeDescription(mode)}`,
        present: isValid,
      };
    });
    // Only include entries the resolver confirmed (defensive; all three should match).
    const valid = entries.filter((e) => e.present);
    return { entries: valid, sourceLabel, present: valid.length > 0 };
  } catch {
    return { entries: [], sourceLabel, present: false };
  }
}

/**
 * Returns a one-line human description for each enforcement mode.
 *
 * @param {string} mode
 * @returns {string}
 */
function modeDescription(mode) {
  switch (mode) {
    case 'advisory':  return 'warns on missing capabilities, never blocks';
    case 'guarded':   return 'blocks writes/completions when required capabilities missing';
    case 'strict':    return 'blocks at every lifecycle moment when any required capability missing';
    default:          return 'unknown';
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Builds the unified governance policy registry over all three policy stores.
 *
 * Each store is loaded independently and fail-open: a store that cannot be
 * read appears in sources.skipped and contributes zero policies (§8 — no
 * fabrication). A present store appears in sources.present.
 *
 * @param {string} [root] project root (default: process.cwd())
 * @returns {Promise<{
 *   schemaVersion: number,
 *   policies: Array<{id: string, kind: string, source: string, scope: string, summary: string, present: true}>,
 *   counts: { capability: number, routing: number, enforcement: number },
 *   sources: { present: string[], skipped: string[] }
 * }>}
 */
export async function buildPolicyRegistry(root = process.cwd()) {
  const [capResult, routeResult, enforceResult] = await Promise.all([
    loadCapabilityStore(root),
    loadRoutingStore(root),
    loadEnforcementStore(root),
  ]);

  const allEntries = [
    ...capResult.entries,
    ...routeResult.entries,
    ...enforceResult.entries,
  ];

  const presentSources = [];
  const skippedSources = [];

  for (const { present, sourceLabel } of [capResult, routeResult, enforceResult]) {
    if (present) presentSources.push(sourceLabel);
    else skippedSources.push(sourceLabel);
  }

  return {
    schemaVersion: SCHEMA_VERSION,
    policies: allEntries,
    counts: {
      capability: capResult.entries.length,
      routing: routeResult.entries.length,
      enforcement: enforceResult.entries.length,
    },
    sources: {
      present: presentSources,
      skipped: skippedSources,
    },
  };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

const isMain =
  process.argv[1] &&
  resolve(process.argv[1]).endsWith('policy-registry.mjs');

if (isMain) {
  const jsonMode = process.argv.includes('--json');
  try {
    const registry = await buildPolicyRegistry(process.cwd());
    if (jsonMode) {
      console.log(JSON.stringify(registry, null, 2));
    } else {
      const { policies, counts, sources } = registry;
      console.log(`\nGovernance Policy Registry  (schemaVersion ${registry.schemaVersion})\n`);
      console.log(`  capability: ${counts.capability}  routing: ${counts.routing}  enforcement: ${counts.enforcement}\n`);
      for (const p of policies) {
        console.log(`  [${p.kind.padEnd(11)}] ${p.id}`);
        console.log(`    source:  ${p.source}`);
        console.log(`    scope:   ${p.scope}`);
        console.log(`    summary: ${p.summary}\n`);
      }
      if (sources.skipped.length > 0) {
        console.log(`  Skipped stores (absent/unreadable):`);
        for (const s of sources.skipped) console.log(`    - ${s}`);
        console.log('');
      }
    }
  } catch (err) {
    // CLI never breaks work — exit 0 always, show the error
    console.error(`policy-registry: unexpected error: ${err?.message ?? String(err)}`);
  }
  process.exit(0);
}
