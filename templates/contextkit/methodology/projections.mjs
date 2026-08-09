/**
 * Structural auto-fill projections (WF-0089 SA1, BIZ-0006, ADR-0148 §9/§10).
 *
 * Every export here fills the STRUCTURAL half of a spec/PRD skeleton — the
 * half a script can derive with zero ambiguity from data that already exists
 * (the committed dependency graph, an owner's execution plan, the
 * deterministic work classifier). The REASONED half (why this scope matters,
 * what the risk actually means) stays a human/LLM job deferred to WF-0090.
 *
 * Every function is pure, idempotent, and I/O-free: same input -> same output,
 * always, with zero disk reads and zero model calls. The one disk boundary
 * (`loadProjection`, `graph-query.mjs`) stays OUTSIDE these functions by
 * design — callers load the projection once and pass it in, so this module
 * never becomes a second place that reads `graph.json` (S1: one read
 * boundary) and stays trivially testable with an in-memory fixture.
 *
 * Every result shares one envelope so SA2 (provenance/hashing) can treat them
 * uniformly: `{ source, available, value, reason, inputs }`. `source` is one
 * of the SA0-ratified DERIVED source ids (`biz0004:fwd-reach`,
 * `biz0004:rev-consumers`, `biz0003:tasks-derive`, `work-classifier`,
 * `scaffold`); `inputs` is the sorted/normalized identity SA2 hashes for
 * idempotency; `available:false` is the fail-open contract (R7) — a missing
 * graph or an empty entry-symbol list never throws and never blocks the
 * `{{TOKEN}}` skeleton, it degrades to a well-formed empty projection.
 */
import { boundedReachability, reverseConsumers } from '../tools/scripts/graph-query.mjs';
import { deriveWorkflowTasks } from '../tools/scripts/tasks-derive.mjs';
import { classifyWork, DEFAULT_WORK_CLASSIFICATION } from '../runtime/execution/work-classifier.mjs';

/**
 * The field keys this module's projections OWN — the DERIVED half of ADR-0148
 * §10. Frozen and exported so WF-0090's disjointness argument is a mechanical
 * test (`REASONED_FIELD_KEYS ∩ DERIVED_FIELD_KEYS === ∅`) rather than a claim in
 * a report: nothing stops a future field from being added to both lists except
 * an assertion that fails when it is.
 *
 * `kpi.*` is represented by its container key: `deriveKpiSkeleton` owns the whole
 * KPI block, and the content engine has no write path into any of it (targets stay
 * `null` until measured).
 */
export const DERIVED_FIELD_KEYS = Object.freeze([
  'spec.scope',
  'risk.table',
  'tasks',
  'classification',
  'index.currentPhase',
  'kpi',
]);

/** Supported hosts for the v4 generated-projection contract. */
export const HOST_PROJECTION_HOSTS = Object.freeze(['claude', 'codex', 'antigravity']);

/** Supported generation modes. Template mode builds the kit; installed mode updates one project. */
export const HOST_PROJECTION_MODES = Object.freeze(['templates', 'installed']);

/**
 * Validates and normalizes the explicit host-projection manifest.
 *
 * The function is intentionally pure: converters own filesystem discovery and
 * mutation, while this module owns the declarative contract shared by every
 * host. Unknown hosts, undeclared paths, and ambiguous targets are rejected
 * before a converter can touch an output tree.
 *
 * @param {unknown} candidate parsed JSON value
 * @returns {object} the validated manifest
 * @throws {TypeError} when the manifest is incomplete or ambiguous
 */
export function validateHostProjectionManifest(candidate) {
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
    throw new TypeError('host projection manifest must be an object');
  }
  if (candidate.schemaVersion !== 1) {
    throw new TypeError(`unsupported host projection manifest schemaVersion: ${String(candidate.schemaVersion)}`);
  }
  if (candidate.canonicalHost !== 'claude') {
    throw new TypeError('host projection manifest canonicalHost must be "claude"');
  }
  if (!Array.isArray(candidate.requiredContracts) || candidate.requiredContracts.length === 0) {
    throw new TypeError('host projection manifest requiredContracts must be a non-empty array');
  }
  const contractNames = new Set();
  for (const contractName of candidate.requiredContracts) {
    if (typeof contractName !== 'string' || !/^[a-z][a-z0-9-]+$/.test(contractName)) {
      throw new TypeError(`invalid host contract name: ${String(contractName)}`);
    }
    if (contractNames.has(contractName)) throw new TypeError(`duplicate host contract: ${contractName}`);
    contractNames.add(contractName);
  }

  const declaredHosts = Object.keys(candidate.hosts ?? {}).sort();
  const expectedHosts = [...HOST_PROJECTION_HOSTS].sort();
  if (JSON.stringify(declaredHosts) !== JSON.stringify(expectedHosts)) {
    throw new TypeError(`host projection manifest must declare exactly: ${expectedHosts.join(', ')}`);
  }

  const projectionIds = new Set();
  for (const hostName of HOST_PROJECTION_HOSTS) {
    const host = candidate.hosts[hostName];
    if (!host || typeof host !== 'object' || Array.isArray(host)) {
      throw new TypeError(`host projection manifest entry missing for ${hostName}`);
    }
    assertRelativeProjectionPath(host.contractSource, `${hostName}.contractSource`);
    if (!Array.isArray(host.projections)) {
      throw new TypeError(`${hostName}.projections must be an array`);
    }
    for (const projection of host.projections) {
      if (!projection || typeof projection !== 'object' || Array.isArray(projection)) {
        throw new TypeError(`${hostName} projection must be an object`);
      }
      if (typeof projection.id !== 'string' || !/^[a-z][a-z0-9-]+$/.test(projection.id)) {
        throw new TypeError(`invalid ${hostName} projection id: ${String(projection.id)}`);
      }
      if (projectionIds.has(projection.id)) throw new TypeError(`duplicate projection id: ${projection.id}`);
      projectionIds.add(projection.id);
      if (typeof projection.generator !== 'string' || projection.generator.length === 0) {
        throw new TypeError(`${projection.id}.generator must be a non-empty string`);
      }
      for (const mode of HOST_PROJECTION_MODES) {
        assertRelativeProjectionPath(projection.source?.[mode], `${projection.id}.source.${mode}`);
        assertRelativeProjectionPath(projection.target?.[mode], `${projection.id}.target.${mode}`);
      }
      if (!Array.isArray(projection.retain) || projection.retain.some((path) => typeof path !== 'string')) {
        throw new TypeError(`${projection.id}.retain must be a string array`);
      }
    }
  }
  return candidate;
}

/**
 * Returns the rules a named generator is allowed to execute for one host/mode.
 * Paths are copied into a small immutable-like envelope so callers cannot
 * accidentally use another mode's destination.
 *
 * @param {object} manifest validated host projection manifest
 * @param {'claude'|'codex'|'antigravity'} hostName
 * @param {'templates'|'installed'} mode
 * @param {string} generator
 * @returns {Array<object>}
 * @throws {TypeError} for an unknown host, mode, or empty rule set
 */
export function selectHostProjectionRules(manifest, hostName, mode, generator) {
  validateHostProjectionManifest(manifest);
  if (!HOST_PROJECTION_HOSTS.includes(hostName)) throw new TypeError(`unknown projection host: ${hostName}`);
  if (!HOST_PROJECTION_MODES.includes(mode)) throw new TypeError(`unknown projection mode: ${mode}`);
  const rules = manifest.hosts[hostName].projections
    .filter((projection) => projection.generator === generator)
    .map((projection) => ({
      ...projection,
      sourcePath: projection.source[mode],
      targetPath: projection.target[mode],
      retain: [...projection.retain],
    }));
  if (rules.length === 0) throw new TypeError(`no ${generator} projections declared for ${hostName}`);
  return rules;
}

/** Rejects absolute or traversal-shaped projection paths. */
function assertRelativeProjectionPath(path, label) {
  if (typeof path !== 'string' || path.length === 0) {
    throw new TypeError(`${label} must be a non-empty relative path`);
  }
  const normalized = path.replaceAll('\\', '/');
  if (normalized.startsWith('/') || /^[A-Za-z]:\//.test(normalized)) {
    throw new TypeError(`${label} must be relative: ${path}`);
  }
  if (normalized.split('/').some((segment) => segment === '..')) {
    throw new TypeError(`${label} must not traverse outside the project root: ${path}`);
  }
}

/** Returns a deterministic, de-duplicated, sorted list of non-empty entry-symbol strings. */
function normalizeEntrySymbols(entrySymbols) {
  if (!Array.isArray(entrySymbols)) return [];
  return [...new Set(entrySymbols.filter((symbol) => typeof symbol === 'string' && symbol.trim().length > 0))].sort();
}

/**
 * Derives a spec's Scope section from BIZ-0004 forward reachability: the
 * bounded, hub-avoiding neighborhood reachable FROM the named entry symbols
 * (what a change starting here can touch). Traces to a real
 * `boundedReachability` graph query per entry symbol; never NLP over the
 * objective (mirrors `task-compiler.mjs`'s explicit `--symbol` contract).
 *
 * Fail-open (R7): an absent/unparsable graph projection degrades to an empty
 * scope rather than throwing, so a fresh install still renders a well-formed
 * `{{SCOPE}}` token.
 *
 * @param {string[]} entrySymbols explicit entry-point node ids (`sym:...`/`file:...`)
 * @param {object} projection a `graph-query.mjs#loadProjection()` result
 * @param {number} [budget=40] max nodes per entry symbol (approximates a token budget)
 * @returns {{source:'biz0004:fwd-reach', available:boolean,
 *   value:{nodes:string[], excludedHubs:string[]}|null, reason:string|null,
 *   inputs:{entrySymbols:string[], budget:number}}}
 */
export function deriveScope(entrySymbols, projection, budget = 40) {
  const symbols = normalizeEntrySymbols(entrySymbols);
  const inputs = { entrySymbols: symbols, budget };
  if (!projection || !projection.available) {
    return { source: 'biz0004:fwd-reach', available: false, value: null, reason: projection?.reason ?? 'no committed graph projection', inputs };
  }
  const nodes = new Set();
  const excludedHubs = new Set();
  for (const seedId of symbols) {
    const result = boundedReachability(projection, seedId, budget);
    for (const node of result.nodes) nodes.add(node);
    for (const hub of result.excludedHubs) excludedHubs.add(hub);
  }
  return {
    source: 'biz0004:fwd-reach',
    available: true,
    value: { nodes: [...nodes].sort(), excludedHubs: [...excludedHubs].sort() },
    reason: null,
    inputs,
  };
}

/**
 * Derives a spec's Risk register from BIZ-0004 reverse consumers (fan-in):
 * every node that would break if one of the named entry symbols changed.
 * Traces to a real `reverseConsumers` graph query per entry symbol.
 *
 * Fail-open (R7): an absent/unparsable graph projection, or an empty
 * entry-symbol list, degrades to `available:false` rather than throwing or
 * fabricating a caller/consumer (ADR-0136 invariant).
 *
 * @param {string[]} entrySymbols explicit entry-point node ids (`sym:...`/`file:...`)
 * @param {object} projection a `graph-query.mjs#loadProjection()` result
 * @returns {{source:'biz0004:rev-consumers', available:boolean,
 *   value:{consumers:string[]}|null, reason:string|null,
 *   inputs:{entrySymbols:string[]}}}
 */
export function deriveRisk(entrySymbols, projection) {
  const symbols = normalizeEntrySymbols(entrySymbols);
  const inputs = { entrySymbols: symbols };
  if (!projection || !projection.available) {
    return { source: 'biz0004:rev-consumers', available: false, value: null, reason: projection?.reason ?? 'no committed graph projection', inputs };
  }
  if (symbols.length === 0) {
    return { source: 'biz0004:rev-consumers', available: false, value: null, reason: 'no entry symbols supplied', inputs };
  }
  const consumers = new Set();
  for (const targetId of symbols) {
    for (const consumer of reverseConsumers(projection, targetId).consumers) consumers.add(consumer);
  }
  return {
    source: 'biz0004:rev-consumers',
    available: true,
    value: { consumers: [...consumers].sort() },
    reason: null,
    inputs,
  };
}

/**
 * Derives a spec's task list by reusing BIZ-0003's `tasks-derive.mjs`
 * projection (does not reinvent a second task-planning path). Wraps
 * `deriveWorkflowTasks`'s thrown `TypeError` (malformed plan/waves) into the
 * shared degrade envelope instead of letting it escape, so a caller filling a
 * skeleton never crashes on an incomplete plan.
 *
 * @param {object} plan normalized or raw workflow execution plan
 * @param {{workflowId?: string|number}} [options]
 * @returns {{source:'biz0003:tasks-derive', available:boolean, value:object|null,
 *   reason:string|null, inputs:{workflowId:string|number|null}}}
 */
export function deriveTasks(plan, options = {}) {
  const workflowId = options.workflowId ?? (plan && typeof plan === 'object' ? plan.workflowId : undefined) ?? null;
  const inputs = { workflowId };
  try {
    const value = deriveWorkflowTasks(plan, options);
    return { source: 'biz0003:tasks-derive', available: true, value, reason: null, inputs };
  } catch (err) {
    return { source: 'biz0003:tasks-derive', available: false, value: null, reason: err?.message ?? String(err), inputs };
  }
}

/**
 * Derives a spec's classification block by reusing the deterministic
 * `work-classifier.mjs` (does not reinvent a second nature/kind/intent
 * taxonomy). `classifyWork` is already total (never throws — it fails open to
 * its own defaults internally), so this wrapper only adds the shared envelope.
 *
 * @param {string} objective the natural-language work request
 * @param {object} [policy] loaded classification policy (defaults to the embedded fallback)
 * @returns {{source:'work-classifier', available:true, value:object, reason:null,
 *   inputs:{objective:string}}}
 */
export function deriveClassification(objective, policy = DEFAULT_WORK_CLASSIFICATION) {
  const inputs = { objective: String(objective || '') };
  const value = classifyWork(objective, policy);
  return { source: 'work-classifier', available: true, value, reason: null, inputs };
}

/**
 * Derives a growth-KPI SKELETON: the metric name and its owning lever, never
 * a number. Constitution §8 forbids invented baselines/targets, so every KPI
 * ships with `baseline: null` and sentinel (non-numeric) `target`/`owner`/
 * `cadence` values a human or WF-0090's reasoning pass must fill in — this
 * function only shapes the causal-chain skeleton `business-growth-validator.mjs`
 * expects (metric/target/owner/cadence + baseline honesty), it never guesses
 * a value for it.
 *
 * @param {{growthLever?: string|null, valueIntents?: {primary?: string}, valueIntent?: string}} [shape]
 *   the causal-chain shape (e.g. a `deriveClassification` value) carrying the growth lever
 * @returns {{source:'scaffold', available:boolean,
 *   value:{primaryLever:string|null, kpis:Array<{metric:string, target:string, baseline:null, owner:string, cadence:string}>}|null,
 *   reason:string|null, inputs:{growthLever:string|null, valueIntent:string|null}}}
 */
export function deriveKpiSkeleton(shape) {
  const growthLever = (shape && typeof shape === 'object' && typeof shape.growthLever === 'string') ? shape.growthLever : null;
  const valueIntent = (shape && typeof shape === 'object')
    ? (shape.valueIntents?.primary ?? (typeof shape.valueIntent === 'string' ? shape.valueIntent : null))
    : null;
  const inputs = { growthLever, valueIntent };
  if (!growthLever) {
    return { source: 'scaffold', available: false, value: null, reason: 'no growth lever supplied', inputs };
  }
  return {
    source: 'scaffold',
    available: true,
    value: {
      primaryLever: growthLever,
      kpis: [{ metric: `${growthLever} primary metric`, target: 'to-be-defined', baseline: null, owner: 'to-be-defined', cadence: 'to-be-defined' }],
    },
    reason: null,
    inputs,
  };
}
