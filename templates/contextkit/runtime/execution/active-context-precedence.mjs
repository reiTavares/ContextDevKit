/**
 * active-context-precedence.mjs — Precedence rule helpers for active-context-resolver.
 *
 * Pure functions: no I/O, no Date.now, no Math.random. Zero runtime deps.
 * Imported exclusively by active-context-resolver.mjs (WF0038, ADR-0112, A7-T1).
 *
 * @module active-context-precedence
 */
import { normalize } from 'node:path';
import { resolveWorkflow } from '../../tools/scripts/registry/workflow.mjs';

// ─── ID patterns ────────────────────────────────────────────────────────────

const BIZ_RE = /^BIZ-\d{4}$/;
const OP_RE  = /^OP-\d{4}$/;
const WF_RE  = /^WF-\d{4}$/;
const BRANCH_BIZ_RE  = /\b(BIZ-\d{4})\b/i;
const BRANCH_OP_RE   = /\b(OP-\d{4})\b/i;
const BRANCH_WF_RE   = /\b(WF-\d{4})\b/i;
// Wave+task suffix: e.g. "-A7-T1" or "_a7_t1"
const BRANCH_WAVE_RE = /[_\-](A\d+)[_\-](T\d+)/i;

// ─── Shared primitives ───────────────────────────────────────────────────────

/**
 * Parses wave and task tags from a branch/folder name.
 * @param {string} name
 * @returns {{ wave: string|null, task: string|null }}
 */
export function parseBranchWaveTask(name) {
  const m = name.match(BRANCH_WAVE_RE);
  if (!m) return { wave: null, task: null };
  return { wave: m[1].toUpperCase(), task: m[2].toUpperCase() };
}

/**
 * Returns `id` if found in `registry.contexts`, otherwise null.
 * @param {string} id
 * @param {object} registry
 * @returns {string|null}
 */
export function verifyInRegistry(id, registry) {
  try {
    return registry.contexts.find((c) => c.id === id) ? id : null;
  } catch {
    return null;
  }
}

/**
 * Builds the frozen ActiveContext return object.
 * @param {string}      state
 * @param {string|null} rootBusinessId
 * @param {string|null} business
 * @param {string|null} operation
 * @param {string|null} workflow
 * @param {string|null} wave
 * @param {string|null} task
 * @param {string}      source
 * @param {string[]}    reasonCodes
 * @returns {object}
 */
export function buildResult(state, rootBusinessId, business, operation, workflow, wave, task, source, reasonCodes) {
  return Object.freeze({
    state, rootBusinessId, business, operation, workflow, wave, task, source,
    reasonCodes: [...reasonCodes],
  });
}

// ─── Precedence rules (first confident hit wins) ────────────────────────────

/**
 * Rule 1 — Explicit ids from the caller win unconditionally.
 * Multiple ids of the same type → ambiguous.
 * @param {string[]} ids
 * @param {object}   registry
 * @returns {object|null}
 */
export function ruleExplicitIds(ids, registry) {
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
  if (!business && !operation && !workflow) return null;
  return {
    state: 'confirmed', source: 'explicit-ids', business, operation, workflow,
    reason: `explicit-ids=${ids.slice(0, 4).join(',')}`,
  };
}

/**
 * Rule 2 — Engine state from workflow-state.json under the business tree.
 * @param {string|null}                         rootBizId
 * @param {object}                              registry
 * @param {Function} readEngineWorkflowStateFn - injected reader (avoids circular dep).
 * @param {string}                              root
 * @returns {object|null}
 */
export function ruleEngineState(rootBizId, registry, readEngineWorkflowStateFn, root) {
  const effectiveBizId = rootBizId
    ?? (registry.contexts.filter((c) => c.type === 'business').length === 1
      ? registry.contexts.find((c) => c.type === 'business').id
      : null);
  if (!effectiveBizId) return null;
  const { workflow, wave, task } = readEngineWorkflowStateFn(root, effectiveBizId);
  if (!workflow) return null;
  return {
    state: 'confirmed', source: 'engine-state', business: effectiveBizId,
    operation: null, workflow, wave, task,
    reason: `engine-state: business=${effectiveBizId} workflow=${workflow}`,
  };
}

/**
 * Rule 3 — Branch/worktree name contains BIZ-/OP-/WF-#### tokens.
 * @param {string|null} branch
 * @param {object}      registry
 * @param {string}      root
 * @returns {object|null}
 */
export function ruleBranchName(branch, registry, root) {
  if (typeof branch !== 'string' || !branch.trim()) return null;
  const nb   = normalize(branch);
  const bizM = nb.match(BRANCH_BIZ_RE);
  const opM  = nb.match(BRANCH_OP_RE);
  const wfM  = nb.match(BRANCH_WF_RE);
  const { wave, task } = parseBranchWaveTask(nb);
  const business  = bizM ? verifyInRegistry(bizM[1].toUpperCase(), registry) : null;
  const operation = opM  ? verifyInRegistry(opM[1].toUpperCase(), registry)  : null;
  let workflow = wfM ? wfM[1].toUpperCase() : null;
  if (workflow && !resolveWorkflow(workflow, root)) workflow = null;
  const hit = business || operation || workflow;
  if (!hit) return null;
  return {
    state: 'suggested', source: 'branch-name', business, operation, workflow, wave, task,
    reason: `branch-name='${branch}' → biz=${business ?? '-'} op=${operation ?? '-'} wf=${workflow ?? '-'}`,
  };
}

/**
 * Rule 4 — Active workspace claims. Multiple distinct ids → ambiguous.
 * @param {object[]} claims
 * @param {object}   registry
 * @returns {object|null}
 */
export function ruleClaims(claims, registry) {
  if (!claims.length) return null;
  const bizSet = new Set();
  const opSet  = new Set();
  const wfSet  = new Set();
  for (const claim of claims) {
    const biz = claim?.businessId  || claim?.context?.businessId;
    const op  = claim?.operationId || claim?.context?.operationId;
    const wf  = claim?.workflowId  || claim?.context?.workflowId;
    if (biz && BIZ_RE.test(biz) && verifyInRegistry(biz, registry)) bizSet.add(biz);
    if (op  && OP_RE.test(op)   && verifyInRegistry(op,  registry)) opSet.add(op);
    if (wf  && WF_RE.test(wf))  wfSet.add(wf);
  }
  if (bizSet.size + opSet.size + wfSet.size === 0) return null;
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
 * Rule 5 — Paths: cwd or request paths contain a BIZ-/OP-#### folder segment.
 * @param {string}   cwd
 * @param {string[]} requestPaths
 * @param {object}   registry
 * @returns {object|null}
 */
export function rulePaths(cwd, requestPaths, registry) {
  const allPaths = [cwd, ...(Array.isArray(requestPaths) ? requestPaths : [])].filter(Boolean);
  if (!allPaths.length) return null;
  const matched = new Set();
  for (const ctx of registry.contexts) {
    for (const p of allPaths) {
      if (typeof p === 'string' && p.includes(ctx.id)) { matched.add(ctx.id); break; }
    }
  }
  if (matched.size === 0) return null;
  if (matched.size > 1) {
    return { state: 'ambiguous', source: 'paths', reason: `multiple contexts matched in paths: ${[...matched].join(',')}` };
  }
  const id  = [...matched][0];
  const ctx = registry.contexts.find((c) => c.id === id);
  return {
    state: 'suggested', source: 'paths',
    business:  ctx?.type === 'business'  ? id : null,
    operation: ctx?.type === 'operation' ? id : null,
    workflow: null, wave: null, task: null,
    reason: `path-match: id=${id}`,
  };
}

/**
 * Rule 6 — Prior session: extract ids from the most recent session markdown.
 * @param {object} priorIds - `{ business, operation, workflow }` from readPriorSessionIds.
 * @param {object} registry
 * @returns {object|null}
 */
export function rulePriorSession(priorIds, registry) {
  const { business, operation, workflow } = priorIds;
  const bizOk = business  && verifyInRegistry(business,  registry);
  const opOk  = operation && verifyInRegistry(operation, registry);
  if (!bizOk && !opOk && !workflow) return null;
  return {
    state: 'suggested', source: 'prior-session',
    business:  bizOk ? business  : null,
    operation: opOk  ? operation : null,
    workflow:  workflow ?? null,
    wave: null, task: null,
    reason: `prior-session: biz=${business ?? '-'} op=${operation ?? '-'} wf=${workflow ?? '-'}`,
  };
}
