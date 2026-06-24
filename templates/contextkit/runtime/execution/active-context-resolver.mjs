/**
 * active-context-resolver.mjs — Resolves the active governed context for a
 * request (WF0038, ADR-0112, Wave A7-T1, shadow-first).
 *
 * Deterministic, pure, zero runtime dependencies — only `node:*` plus the
 * platform's own primitives. Same input → identical output every time.
 * No Date.now/Math.random on any active code path.
 *
 * Seams consumed (imported lazily to stay testable without a live repo):
 *   - `registry/work-context.mjs`  → buildWorkContextRegistry (enumerate BIZ-/OP-####)
 *   - `registry/workflow.mjs`      → resolveWorkflow (by id or slug)
 *   - `runtime/config/load.mjs`    → loadConfigSync (read business.rootBusinessId)
 *   - `runtime/config/paths.mjs`   → pathsFor (canonical absolute paths)
 *   - `runtime/hooks/safe-io.mjs`  → readJsonSafe (defensive JSON reads)
 *
 * @module active-context-resolver
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, normalize } from 'node:path';

// ─── Platform primitives ────────────────────────────────────────────────────
import { buildWorkContextRegistry } from '../../tools/scripts/registry/work-context.mjs';
import { resolveWorkflow } from '../../tools/scripts/registry/workflow.mjs';
import { loadConfigSync } from '../config/load.mjs';
import { pathsFor } from '../config/paths.mjs';
import { readJsonSafe } from '../hooks/safe-io.mjs';

// ─── Public types (JSDoc-only, zero runtime cost) ───────────────────────────

/**
 * @typedef {object} ResolverInput
 * @property {object}   [request]     - The raw request object (signals, context).
 * @property {string[]} [explicitIds] - Caller-supplied BIZ-####/OP-####/WF-#### ids.
 * @property {string}   [branch]      - Current git branch / worktree name.
 * @property {string}   [cwd]         - Working directory (defaults to process.cwd()).
 */

/**
 * @typedef {'confirmed'|'suggested'|'ambiguous'|'unlinked'} ContextState
 */

/**
 * @typedef {object} ActiveContext
 * @property {ContextState}  state          - Confidence of the resolved context.
 * @property {string|null}   rootBusinessId - The canonical root business id from config.
 * @property {string|null}   business       - Resolved BIZ-#### id, or null.
 * @property {string|null}   operation      - Resolved OP-#### id, or null.
 * @property {string|null}   workflow       - Resolved WF-#### id, or null.
 * @property {string|null}   wave           - Wave tag (e.g. "A7"), or null.
 * @property {string|null}   task           - Task tag (e.g. "T1"), or null.
 * @property {string}        source         - Which precedence rule fired.
 * @property {string[]}      reasonCodes    - Ordered explanation of the verdict.
 */

// ─── ID patterns ────────────────────────────────────────────────────────────

const BIZ_RE = /^BIZ-\d{4}$/;
const OP_RE  = /^OP-\d{4}$/;
const WF_RE  = /^WF-\d{4}$/;
// Branch/folder names encode context as: BIZ-0001, OP-0002, WF-0003, and
// optionally wave+task suffixes like "-A7-T1" or "_a7_t1".
const BRANCH_BIZ_RE  = /\b(BIZ-\d{4})\b/i;
const BRANCH_OP_RE   = /\b(OP-\d{4})\b/i;
const BRANCH_WF_RE   = /\b(WF-\d{4})\b/i;
const BRANCH_WAVE_RE = /[_\-](A\d+)[_\-](T\d+)/i;

// ─── Internal helpers ────────────────────────────────────────────────────────

/**
 * Reads the project config and extracts `business.rootBusinessId`.
 * Never throws; returns null when missing or blank.
 *
 * @param {string} root - project root.
 * @returns {string|null}
 */
function readRootBusinessId(root) {
  try {
    const cfg = loadConfigSync(root);
    const id = cfg?.business?.rootBusinessId;
    return typeof id === 'string' && id.trim() ? id.trim() : null;
  } catch {
    return null;
  }
}

/**
 * Reads all workspace claim files under `.claude/.workspace/` for `root`.
 * Returns an array of parsed claim objects; empty on any error.
 *
 * @param {string} root - project root.
 * @returns {object[]}
 */
function readWorkspaceClaims(root) {
  const wsDir = pathsFor(root).workspaceStateDir;
  if (!existsSync(wsDir)) return [];
  try {
    return readdirSync(wsDir)
      .filter((f) => f.endsWith('.json') && !f.startsWith('.'))
      .map((f) => readJsonSafe(join(wsDir, f), null))
      .filter(Boolean);
  } catch {
    return [];
  }
}

/**
 * Reads the most recent session file under `contextkit/memory/sessions/` and
 * extracts the first BIZ-/OP-/WF-#### ids found in its text (prior-session seam).
 *
 * @param {string} root - project root.
 * @returns {{ business:string|null, operation:string|null, workflow:string|null }}
 */
function readPriorSessionIds(root) {
  const sessionsDir = pathsFor(root).sessions;
  if (!existsSync(sessionsDir)) return { business: null, operation: null, workflow: null };
  try {
    const files = readdirSync(sessionsDir)
      .filter((f) => f.endsWith('.md') && !f.startsWith('_'))
      .sort()
      .reverse();
    if (!files.length) return { business: null, operation: null, workflow: null };
    const text = readFileSync(join(sessionsDir, files[0]), 'utf-8');
    return {
      business:  (text.match(/\b(BIZ-\d{4})\b/) ?? [])[1] ?? null,
      operation: (text.match(/\b(OP-\d{4})\b/)  ?? [])[1] ?? null,
      workflow:  (text.match(/\b(WF-\d{4})\b/)  ?? [])[1] ?? null,
    };
  } catch {
    return { business: null, operation: null, workflow: null };
  }
}

/**
 * Reads the engine workflow-state and business.json files for the given
 * business id to extract the active workflow + wave/task.
 *
 * The canonical location for a business's workflow-state is:
 *   `contextkit/memory/business/<BIZ-####-slug>/workflows/<WF-####-slug>/workflow-state.json`
 *
 * We scan the business folder to find the first active workflow.
 *
 * @param {string} root - project root.
 * @param {string|null} bizId - the BIZ-#### id to scan under.
 * @returns {{ workflow:string|null, wave:string|null, task:string|null }}
 */
function readEngineWorkflowState(root, bizId) {
  if (!bizId) return { workflow: null, wave: null, task: null };
  const bizDir = pathsFor(root).business;
  if (!existsSync(bizDir)) return { workflow: null, wave: null, task: null };
  try {
    const bizFolders = readdirSync(bizDir, { withFileTypes: true })
      .filter((e) => e.isDirectory() && e.name.startsWith(bizId))
      .map((e) => e.name);
    for (const folder of bizFolders) {
      const wfDir = join(bizDir, folder, 'workflows');
      if (!existsSync(wfDir)) continue;
      const wfFolders = readdirSync(wfDir, { withFileTypes: true })
        .filter((e) => e.isDirectory())
        .map((e) => e.name);
      for (const wf of wfFolders) {
        const stateFile = join(wfDir, wf, 'workflow-state.json');
        const state = readJsonSafe(stateFile, null);
        if (state?.overallStatus === 'active' || state?.overallStatus === 'in-progress') {
          const wfId = (wf.match(/^(WF-\d{4})/) ?? [])[1] ?? null;
          const wave = state?.currentWave ?? null;
          const task = state?.currentTask ?? null;
          return { workflow: wfId, wave, task };
        }
      }
    }
  } catch {
    /* fall through */
  }
  return { workflow: null, wave: null, task: null };
}

/**
 * Parses the wave and task tags from a branch/folder name.
 * Returns nulls when neither tag is found.
 *
 * @param {string} name - branch or folder name.
 * @returns {{ wave: string|null, task: string|null }}
 */
function parseBranchWaveTask(name) {
  const m = name.match(BRANCH_WAVE_RE);
  if (!m) return { wave: null, task: null };
  return { wave: m[1].toUpperCase(), task: m[2].toUpperCase() };
}

/**
 * Verifies that a BIZ-/OP-#### id exists in the work-context registry.
 * Returns null when the registry call fails or the id is absent.
 *
 * @param {string} id - the candidate id.
 * @param {object} registry - the work-context registry payload.
 * @returns {string|null}
 */
function verifyInRegistry(id, registry) {
  try {
    const found = registry.contexts.find((c) => c.id === id);
    return found ? id : null;
  } catch {
    return null;
  }
}

/**
 * Builds the frozen ActiveContext return object.
 *
 * @param {ContextState} state
 * @param {string|null}  rootBusinessId
 * @param {string|null}  business
 * @param {string|null}  operation
 * @param {string|null}  workflow
 * @param {string|null}  wave
 * @param {string|null}  task
 * @param {string}       source
 * @param {string[]}     reasonCodes
 * @returns {ActiveContext}
 */
function buildResult(state, rootBusinessId, business, operation, workflow, wave, task, source, reasonCodes) {
  return Object.freeze({
    state, rootBusinessId, business, operation, workflow, wave, task, source,
    reasonCodes: [...reasonCodes],
  });
}

// ─── Precedence rules (applied in order; first confident hit wins) ──────────

/**
 * Rule 1 — Explicit ids provided by the caller win unconditionally.
 * Multiple ids of the same type → ambiguous; mixed types resolve the first
 * of each type and return confirmed only when a single unique pair is found.
 *
 * @param {string[]} ids
 * @param {object}   registry
 * @returns {object|null} partial resolution or null.
 */
function ruleExplicitIds(ids, registry) {
  if (!Array.isArray(ids) || ids.length === 0) return null;
  const bizIds = ids.filter((id) => BIZ_RE.test(id));
  const opIds  = ids.filter((id) => OP_RE.test(id));
  const wfIds  = ids.filter((id) => WF_RE.test(id));
  if (bizIds.length > 1 || opIds.length > 1 || wfIds.length > 1) {
    return { state: 'ambiguous', source: 'explicit-ids', reason: 'multiple same-type explicit ids supplied' };
  }
  const business  = bizIds[0] ? verifyInRegistry(bizIds[0], registry) ?? bizIds[0] : null;
  const operation = opIds[0]  ? verifyInRegistry(opIds[0], registry)  ?? opIds[0]  : null;
  const workflow  = wfIds[0] ?? null;
  const hit = business || operation || workflow;
  if (!hit) return null;
  return {
    state: 'confirmed', source: 'explicit-ids', business, operation, workflow,
    reason: `explicit-ids=${ids.slice(0, 4).join(',')}`,
  };
}

/**
 * Rule 2 — Engine state: read from workflow-state.json under the business tree.
 * Requires a resolvable business id (from rootBusinessId or the registry's sole
 * business entry).
 *
 * @param {string|null} rootBizId
 * @param {object}      registry
 * @param {string}      root
 * @returns {object|null}
 */
function ruleEngineState(rootBizId, registry, root) {
  const effectiveBizId = rootBizId
    ?? (registry.contexts.filter((c) => c.type === 'business').length === 1
      ? registry.contexts.find((c) => c.type === 'business').id
      : null);
  if (!effectiveBizId) return null;
  const { workflow, wave, task } = readEngineWorkflowState(root, effectiveBizId);
  if (!workflow) return null;
  return {
    state: 'confirmed', source: 'engine-state', business: effectiveBizId,
    operation: null, workflow, wave, task,
    reason: `engine-state: business=${effectiveBizId} workflow=${workflow}`,
  };
}

/**
 * Rule 3 — Branch / worktree name contains BIZ-/OP-/WF-#### tokens.
 *
 * @param {string|null} branch
 * @param {object}      registry
 * @param {string}      root
 * @returns {object|null}
 */
function ruleBranchName(branch, registry, root) {
  if (typeof branch !== 'string' || !branch.trim()) return null;
  const nb   = normalize(branch);
  const bizM = nb.match(BRANCH_BIZ_RE);
  const opM  = nb.match(BRANCH_OP_RE);
  const wfM  = nb.match(BRANCH_WF_RE);
  const { wave, task } = parseBranchWaveTask(nb);
  const business  = bizM ? verifyInRegistry(bizM[1].toUpperCase(), registry) : null;
  const operation = opM  ? verifyInRegistry(opM[1].toUpperCase(), registry)  : null;
  let workflow = wfM ? wfM[1].toUpperCase() : null;
  // Verify workflow exists on disk.
  if (workflow) {
    const hit = resolveWorkflow(workflow, root);
    if (!hit) workflow = null;
  }
  const hit = business || operation || workflow;
  if (!hit) return null;
  return {
    state: 'suggested', source: 'branch-name', business, operation, workflow, wave, task,
    reason: `branch-name='${branch}' → biz=${business ?? '-'} op=${operation ?? '-'} wf=${workflow ?? '-'}`,
  };
}

/**
 * Rule 4 — Active workspace claims: sessions that wrote a BIZ-/OP-/WF-#### into
 * their claim file. Multiple distinct ids → ambiguous.
 *
 * @param {object[]} claims
 * @param {object}   registry
 * @returns {object|null}
 */
function ruleClaims(claims, registry) {
  if (!claims.length) return null;
  const bizSet = new Set();
  const opSet  = new Set();
  const wfSet  = new Set();
  for (const claim of claims) {
    const biz = claim?.businessId || claim?.context?.businessId;
    const op  = claim?.operationId || claim?.context?.operationId;
    const wf  = claim?.workflowId  || claim?.context?.workflowId;
    if (biz && BIZ_RE.test(biz) && verifyInRegistry(biz, registry)) bizSet.add(biz);
    if (op  && OP_RE.test(op)   && verifyInRegistry(op,  registry)) opSet.add(op);
    if (wf  && WF_RE.test(wf))  wfSet.add(wf);
  }
  const allFound = bizSet.size + opSet.size + wfSet.size;
  if (allFound === 0) return null;
  if (bizSet.size > 1 || opSet.size > 1 || wfSet.size > 1) {
    return { state: 'ambiguous', source: 'claims', reason: 'multiple conflicting context ids in active claims' };
  }
  return {
    state: 'suggested', source: 'claims',
    business:  bizSet.size ? [...bizSet][0] : null,
    operation: opSet.size  ? [...opSet][0]  : null,
    workflow:  wfSet.size  ? [...wfSet][0]  : null,
    wave: null, task: null,
    reason: `claims: biz=${[...bizSet][0] ?? '-'} op=${[...opSet][0] ?? '-'}`,
  };
}

/**
 * Rule 5 — Project-map / paths: the `cwd` path or request paths are compared
 * against the registry to find a matching BIZ-/OP-#### folder prefix.
 *
 * @param {string}   cwd
 * @param {object[]} requestPaths - paths from `input.request?.signals?.paths`.
 * @param {object}   registry
 * @returns {object|null}
 */
function rulePaths(cwd, requestPaths, registry) {
  const allPaths = [cwd, ...(Array.isArray(requestPaths) ? requestPaths : [])].filter(Boolean);
  if (!allPaths.length) return null;
  const matched = new Set();
  for (const ctx of registry.contexts) {
    const segment = ctx.id; // e.g. "BIZ-0001" or "OP-0002"
    for (const p of allPaths) {
      if (typeof p === 'string' && p.includes(segment)) {
        matched.add(ctx.id);
        break;
      }
    }
  }
  if (matched.size === 0) return null;
  if (matched.size > 1) {
    return { state: 'ambiguous', source: 'paths', reason: `multiple contexts matched in paths: ${[...matched].join(',')}` };
  }
  const id = [...matched][0];
  const ctx = registry.contexts.find((c) => c.id === id);
  return {
    state: 'suggested', source: 'paths',
    business:  ctx?.type === 'business' ? id : null,
    operation: ctx?.type === 'operation' ? id : null,
    workflow: null, wave: null, task: null,
    reason: `path-match: id=${id}`,
  };
}

/**
 * Rule 6 — Prior session: extract ids from the most recent session markdown.
 *
 * @param {string} root
 * @param {object} registry
 * @returns {object|null}
 */
function rulePriorSession(root, registry) {
  const { business, operation, workflow } = readPriorSessionIds(root);
  const bizOk = business && verifyInRegistry(business, registry);
  const opOk  = operation && verifyInRegistry(operation, registry);
  if (!bizOk && !opOk && !workflow) return null;
  return {
    state: 'suggested', source: 'prior-session',
    business:  bizOk  ? business  : null,
    operation: opOk   ? operation : null,
    workflow:  workflow ?? null,
    wave: null, task: null,
    reason: `prior-session: biz=${business ?? '-'} op=${operation ?? '-'} wf=${workflow ?? '-'}`,
  };
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Resolves the active governed context for a request.
 *
 * Precedence (first confident hit wins):
 *   1. explicitIds  — caller-supplied BIZ-/OP-/WF-#### ids
 *   2. engine-state — workflow-state.json under the business tree
 *   3. branch-name  — BIZ-/OP-/WF-#### tokens in the branch or worktree name
 *   4. claims       — active workspace claim files (.claude/.workspace/*.json)
 *   5. paths        — cwd or request paths contain a BIZ-/OP-#### folder segment
 *   6. prior-session — most recent session markdown contains context ids
 *
 * Returns a FROZEN object (no mutation after return).
 * Deterministic: no Date.now or Math.random; same input → identical output.
 *
 * @param {ResolverInput} input - caller-provided resolution signals.
 * @param {object}        [opts]
 * @param {string}        [opts.root]          - project root (overrides `input.cwd`).
 * @param {boolean}       [opts.strictContext]  - when true, throws on unlinked.
 * @returns {ActiveContext}
 * @throws {Error} when `opts.strictContext` is true and the state is 'unlinked'.
 */
export function resolveActiveContext(input, opts = {}) {
  const safeInput  = (input && typeof input === 'object') ? input : {};
  const safeOpts   = (opts  && typeof opts  === 'object') ? opts  : {};
  const effectiveRoot = safeOpts.root
    ?? safeInput.cwd
    ?? (typeof process !== 'undefined' ? process.cwd() : '');

  // ── Read the root business id from config (never hardcoded). ─────────────
  const rootBusinessId = readRootBusinessId(effectiveRoot);
  const reasonCodes    = [];

  // ── Build the work-context registry once (shared across all rules). ───────
  let registry;
  try {
    registry = buildWorkContextRegistry(effectiveRoot);
  } catch {
    registry = { schemaVersion: 1, generator: 'fallback', contexts: [] };
    reasonCodes.push('registry=unavailable (buildWorkContextRegistry failed; continuing)');
  }

  // ── Precedence rule chain ──────────────────────────────────────────────────
  const requestPaths = safeInput.request?.signals?.paths;
  const claims       = readWorkspaceClaims(effectiveRoot);

  const rules = [
    () => ruleExplicitIds(safeInput.explicitIds, registry),
    () => ruleEngineState(rootBusinessId, registry, effectiveRoot),
    () => ruleBranchName(safeInput.branch, registry, effectiveRoot),
    () => ruleClaims(claims, registry),
    () => rulePaths(effectiveRoot, requestPaths, registry),
    () => rulePriorSession(effectiveRoot, registry),
  ];

  for (const rule of rules) {
    let hit;
    try { hit = rule(); } catch { continue; }
    if (!hit) continue;
    reasonCodes.push(hit.reason ?? `source=${hit.source}`);
    if (hit.state === 'ambiguous') {
      return buildResult('ambiguous', rootBusinessId, null, null, null, null, null, hit.source, reasonCodes);
    }
    return buildResult(
      hit.state, rootBusinessId,
      hit.business ?? null, hit.operation ?? null, hit.workflow ?? null,
      hit.wave ?? null, hit.task ?? null,
      hit.source, reasonCodes,
    );
  }

  // ── Nothing resolved ───────────────────────────────────────────────────────
  reasonCodes.push('unlinked: no rule produced a hit');
  if (safeOpts.strictContext) {
    throw new Error(`[active-context-resolver] unlinked: no context could be resolved for root='${effectiveRoot}'`);
  }
  return buildResult('unlinked', rootBusinessId, null, null, null, null, null, 'none', reasonCodes);
}
