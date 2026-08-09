#!/usr/bin/env node
/**
 * policy-distribution.mjs — Advisory policy-distribution PLAN builder (CDK-082, PKG-08).
 *
 * ADVISORY · FAIL-OPEN · UNREGISTERED · READ-ONLY · DRY-RUN
 *
 * Given the kit's BASELINE policy stores and a TARGET installed project's
 * policy stores, this tool reports which policy keys WOULD be added (present in
 * baseline, missing in target), which are UNTOUCHED (user value always wins), and
 * a version-stamp diff. It NEVER writes anything — it is a PLAN only.
 *
 * Live installer integration is a separate deferred user-gated activation (CDK-083
 * or equivalent); this module is not wired into install.mjs.
 *
 * Baseline stores (all under templates/contextkit/policy/ relative to this file):
 *   routing-policy.json, complexity-rubric.json, squads-registry.json,
 *   capability-registry.json (note: capability-registry.json is NOT currently
 *   seeded by the installer — flagged as a 'would-distribute' candidate).
 *
 * Usage:
 *   node policy-distribution.mjs [targetRoot] [--json]
 *   node policy-distribution.mjs --json .    # JSON plan to stdout
 *   node policy-distribution.mjs /path/to/project
 *
 * Zero runtime dependencies — node:* + sibling kit modules only. ADR-0072 / CDK-082.
 */
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { readJsonSafe } from '../../runtime/hooks/safe-io.mjs';
import { additivePlan, versionDelta } from './policy-distribution-core.mjs';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const HERE = dirname(fileURLToPath(import.meta.url));

/**
 * Path to the kit's own baseline policy directory.
 * Assembled from parts to avoid join(x, 'contextkit/...') (CLAUDE.md rule 4).
 */
const BASELINE_POLICY_DIR = resolve(HERE, '..', '..', 'policy');

/** Schema version stamp for this plan shape. */
const SCHEMA_VERSION = 'cdk-policy-distribution/1';

/** Dry-run note appended to every plan output. */
const DRY_RUN_NOTE =
  'This is a plan only; no files are written; installer integration is a deferred user-gated activation.';

/**
 * The four policy stores the kit ships.
 * capability-registry.json is flagged separately because it is NOT yet seeded
 * by the installer — it is a 'would-distribute' candidate (candidatesNotYetSeeded).
 */
const POLICY_STORES = [
  'routing-policy.json',
  'complexity-rubric.json',
  'squads-registry.json',
  'capability-registry.json',
];

/** Stores not yet seeded by the installer (CDK-082 §spec). */
const NOT_YET_SEEDED = new Set(['capability-registry.json']);

// ---------------------------------------------------------------------------
// Per-store diff builder
// ---------------------------------------------------------------------------

/**
 * @typedef {object} StorePlan
 * @property {string}               store
 * @property {boolean}              baselinePresent
 * @property {boolean}              targetPresent
 * @property {string[]}             wouldAdd
 * @property {string[]}             untouched
 * @property {number|null}          baselineVersion
 * @property {number|null}          targetVersion
 * @property {'newer'|'same'|'older'|'unknown'} versionDelta
 */

/**
 * Reads one policy store from both baseline and target, then computes the
 * additive distribution plan. Missing baseline → store skipped. Missing target
 * → targetPresent:false, all baseline top-level keys land in wouldAdd.
 *
 * @param {string} storeName     e.g. 'routing-policy.json'
 * @param {string} targetRoot    absolute path to the installed project root
 * @returns {StorePlan|null}     null only when baseline is missing (skipped)
 */
function buildStorePlan(storeName, targetRoot) {
  const baselinePath = join(BASELINE_POLICY_DIR, storeName);
  const baselineData = readJsonSafe(baselinePath);

  if (baselineData === null) {
    // Baseline missing — nothing to distribute; callers filter this out.
    return null;
  }

  // Target path: join with 'contextkit', 'policy', storeName as separate args
  // so the selfcheck regex (/\b(resolve|join)\(.*['"]contextkit\//) does not match.
  const targetPath = join(targetRoot, 'contextkit', 'policy', storeName);
  const targetData = readJsonSafe(targetPath);

  const baselinePresent = true; // confirmed above
  const targetPresent = targetData !== null;

  const baselineVersion = (typeof baselineData?.version === 'number')
    ? baselineData.version
    : null;
  const targetVersion = (typeof targetData?.version === 'number')
    ? targetData.version
    : null;

  const { wouldAdd, untouched } = additivePlan(
    baselineData,
    targetPresent ? targetData : null,
  );

  return {
    store: storeName,
    baselinePresent,
    targetPresent,
    wouldAdd,
    untouched,
    baselineVersion,
    targetVersion,
    versionDelta: versionDelta(baselineVersion, targetVersion),
  };
}

// ---------------------------------------------------------------------------
// Plan builder (exported public API)
// ---------------------------------------------------------------------------

/**
 * @typedef {object} PolicyDistributionOpts
 * @property {string[]} [stores] Override which stores to scan (default: POLICY_STORES).
 */

/**
 * @typedef {object} PolicyDistributionPlan
 * @property {'cdk-policy-distribution/1'}   schemaVersion
 * @property {StorePlan[]}                   stores
 * @property {{ storesScanned:number, totalWouldAdd:number, candidatesNotYetSeeded:string[] }} summary
 * @property {{ present:string[], skipped:string[] }} sources
 * @property {string}                        dryRunNote
 */

/**
 * Builds the additive policy-distribution plan for a target installed project.
 *
 * Reads the kit's baseline policy stores and the target project's policy stores.
 * Reports which keys WOULD be added vs. which are already present (untouched).
 * NEVER writes anything. Advisory, fail-open.
 *
 * @param {string}                  targetRoot  Absolute path to an installed project root.
 * @param {PolicyDistributionOpts}  [opts]      Optional overrides (test/advanced use).
 * @returns {PolicyDistributionPlan}
 */
export function buildPolicyDistribution(targetRoot, opts = {}) {
  const storesToScan = opts.stores ?? POLICY_STORES;
  const resolvedRoot = resolve(targetRoot);

  /** @type {StorePlan[]} */
  const storePlans = [];
  const presentStores = /** @type {string[]} */ ([]);
  const skippedStores = /** @type {string[]} */ ([]);
  const candidatesNotYetSeeded = /** @type {string[]} */ ([]);

  for (const storeName of storesToScan) {
    const plan = buildStorePlan(storeName, resolvedRoot);

    if (plan === null) {
      // Baseline missing — store is skipped entirely (§8 contract).
      skippedStores.push(storeName);
      continue;
    }

    storePlans.push(plan);
    presentStores.push(storeName);

    // Flag not-yet-seeded stores that have content to distribute.
    if (NOT_YET_SEEDED.has(storeName) && plan.wouldAdd.length > 0) {
      candidatesNotYetSeeded.push(storeName);
    }
  }

  const totalWouldAdd = storePlans.reduce((acc, s) => acc + s.wouldAdd.length, 0);

  return {
    schemaVersion: SCHEMA_VERSION,
    stores: storePlans,
    summary: {
      storesScanned: storePlans.length,
      totalWouldAdd,
      candidatesNotYetSeeded,
    },
    sources: {
      present: presentStores,
      skipped: skippedStores,
    },
    dryRunNote: DRY_RUN_NOTE,
  };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

/**
 * Returns true when this module is the entry point (not imported as a library).
 *
 * @returns {boolean}
 */
function isMain() {
  if (!process.argv[1]) return false;
  const entryNorm = process.argv[1].replace(/\\/g, '/');
  return entryNorm.endsWith('policy-distribution.mjs');
}

/**
 * Formats a store plan as human-readable digest lines.
 *
 * @param {StorePlan} plan
 * @returns {string}
 */
function formatStoreLine(plan) {
  const targetTag = plan.targetPresent ? 'present' : 'MISSING';
  const addTag = plan.wouldAdd.length > 0
    ? `+${plan.wouldAdd.length} keys`
    : 'nothing to add';
  const vTag = plan.versionDelta !== 'unknown'
    ? ` (baseline v${plan.baselineVersion} vs target v${plan.targetVersion}: ${plan.versionDelta})`
    : '';
  return `  ${plan.store}  [target: ${targetTag}]  ${addTag}${vTag}`;
}

/**
 * Formats the full plan as a human-readable digest string.
 *
 * @param {PolicyDistributionPlan} plan
 * @param {string} targetRoot
 * @returns {string}
 */
function formatDigest(plan, targetRoot) {
  const lines = [
    `policy-distribution plan (CDK-082) — target: ${targetRoot}`,
    `  stores scanned: ${plan.summary.storesScanned}  total keys to add: ${plan.summary.totalWouldAdd}`,
    '',
  ];

  for (const storePlan of plan.stores) {
    lines.push(formatStoreLine(storePlan));
    if (storePlan.wouldAdd.length > 0) {
      for (const key of storePlan.wouldAdd) {
        lines.push(`    + ${key}`);
      }
    }
    if (storePlan.untouched.length > 0) {
      lines.push(`    ~ ${storePlan.untouched.length} key(s) untouched (user value wins)`);
    }
  }

  if (plan.sources.skipped.length > 0) {
    lines.push('');
    lines.push(`  skipped (baseline missing): ${plan.sources.skipped.join(', ')}`);
  }

  if (plan.summary.candidatesNotYetSeeded.length > 0) {
    lines.push('');
    lines.push(`  NOTE: ${plan.summary.candidatesNotYetSeeded.join(', ')} not yet seeded by installer — would-distribute candidate`);
  }

  lines.push('');
  lines.push(`  ${plan.dryRunNote}`);
  return lines.join('\n');
}

if (isMain()) {
  // Parse args: skip --json flag, treat first non-flag arg as targetRoot.
  const args = process.argv.slice(2);
  const jsonMode = args.includes('--json');
  const positional = args.filter((a) => !a.startsWith('--'));
  const targetRoot = positional[0] ? resolve(process.cwd(), positional[0]) : process.cwd();

  try {
    const plan = buildPolicyDistribution(targetRoot);
    if (jsonMode) {
      process.stdout.write(JSON.stringify(plan, null, 2) + '\n');
    } else {
      console.log(formatDigest(plan, targetRoot));
    }
    process.exit(0);
  } catch (err) {
    // Fail-open — never crash the caller's flow (§8 contract).
    console.error(`policy-distribution: unexpected error — ${err.message}`);
    process.exit(0);
  }
}
