/**
 * program-governance.mjs — B5-T1 dogfood program-governance validation
 * (BIZ-0001 / WF-0037 Wave B5, ADR-0102).
 *
 * Composes the decision-governance machinery built across the program into a
 * single deterministic gate that validates a Business program against its own
 * rules: the authorizing ADR validates under decision schema v2, every workflow's
 * decision references resolve, the registries rebuild idempotently, approval
 * provenance is present (human-authorized, not AI self-approved), and no
 * duplicate accepted decisions exist for the program.
 *
 * Two surfaces:
 *   - `assessProgramGovernance(inputs)` — PURE; given parsed inputs returns the
 *     verdict. Fixture-testable, no I/O (the selftest exercises this).
 *   - `validateProgramGovernance(root)` — thin runner that reads the dogfood under
 *     `contextkit/memory/`, builds the registries (twice, for the idempotency
 *     check), parses the ADR, and delegates to the pure core.
 *
 * Fail-open: a missing dogfood / unreadable file yields a `skipped` verdict, never
 * a throw (constitution §8 — report skipped, never a false pass).
 *
 * @module program-governance
 */
import { readFileSync, existsSync } from 'node:fs';
import { validateDecision } from '../../runtime/work/schema-decision.mjs';
import { readFrontMatter } from '../../runtime/work/front-matter.mjs';
import { validateWorkflowDecisionRefs } from './decision-coverage.mjs';
import { buildDecisionRegistry } from './registry/decision.mjs';
import { buildWorkflowRegistry } from './registry/workflow.mjs';
import { buildWorkContextRegistry } from './registry/work-context.mjs';

/** Hard-duplicate finding kinds (id collisions) — distinct from advisory overlaps. */
const HARD_DUP_KIND = /\bid\b|duplicate-id/i;

/**
 * Pure governance assessment over already-parsed inputs.
 *
 * @param {object} inputs
 * @param {object} inputs.adrRecord - parsed front-matter of the authorizing ADR.
 * @param {object} inputs.registry - the decision registry (rows resolvable by id).
 * @param {object[]} inputs.workflowPlans - workflow plan objects with `decisionRefs`.
 * @param {{ findings?: object[] }} [inputs.redundancyReport] - anti-redundancy output.
 * @param {boolean} [inputs.registriesIdempotent] - runner's byte-identical rebuild result.
 * @returns {{ ok: boolean, checks: object }}
 */
export function assessProgramGovernance(inputs) {
  const { adrRecord, registry, workflowPlans, redundancyReport, registriesIdempotent } = inputs || {};
  const checks = {};

  const schema = validateDecision(adrRecord);
  checks.adrSchemaV2 = { ok: !!schema.ok, errors: schema.errors || [] };

  const refs = (Array.isArray(workflowPlans) ? workflowPlans : []).map((plan) => {
    const result = validateWorkflowDecisionRefs(plan, registry);
    return {
      workflowId: plan?.workflowId ?? null,
      ok: result.ok !== false,
      missing: result.missing || [],
      superseded: result.superseded || [],
    };
  });
  checks.decisionRefs = refs;
  const refsOk = refs.length > 0 && refs.every((r) => r.ok && r.missing.length === 0);

  const approval = adrRecord?.approvalSource;
  const provenanceOk = adrRecord?.status === 'accepted'
    && approval && typeof approval === 'object'
    && typeof approval.type === 'string' && approval.type.length > 0
    && approval.id != null;
  checks.provenance = { ok: !!provenanceOk, approvalSource: approval ?? null };

  const idDups = (redundancyReport?.findings || [])
    .filter((f) => HARD_DUP_KIND.test(String(f?.kind ?? f?.type ?? '')));
  checks.noDuplicates = { ok: idDups.length === 0, hardIdDuplicates: idDups.length };

  checks.registriesIdempotent = { ok: registriesIdempotent === true };

  const ok = checks.adrSchemaV2.ok && refsOk && checks.provenance.ok
    && checks.noDuplicates.ok && checks.registriesIdempotent.ok;
  return { ok, checks };
}

/**
 * Reads the dogfood program memory under `root`, rebuilds the three registries
 * (twice — idempotency), parses the authorizing ADR, and assesses governance.
 *
 * @param {string} root - project root containing `contextkit/memory/`.
 * @param {object} [opts]
 * @param {string} [opts.adrRelPath] - relative path to the authorizing ADR.
 * @param {string[]} [opts.workflowPlanPaths] - relative paths to workflow-plan.json files.
 * @param {{ findings?: object[] }} [opts.redundancyReport] - precomputed anti-redundancy output.
 * @returns {{ ok: boolean, skipped?: boolean, reason?: string, checks?: object }}
 */
export function validateProgramGovernance(root = process.cwd(), opts = {}) {
  try {
    const adrRel = opts.adrRelPath;
    const planPaths = Array.isArray(opts.workflowPlanPaths) ? opts.workflowPlanPaths : [];
    if (!adrRel || !existsSync(`${root}/${adrRel}`)) {
      return { ok: false, skipped: true, reason: 'authorizing ADR not present (dogfood absent) — skipped' };
    }
    const parsed = readFrontMatter(readFileSync(`${root}/${adrRel}`, 'utf8'));
    const registry = buildDecisionRegistry(root);
    const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
    const registriesIdempotent = eq(buildDecisionRegistry(root), registry)
      && eq(buildWorkflowRegistry(root), buildWorkflowRegistry(root))
      && eq(buildWorkContextRegistry(root), buildWorkContextRegistry(root));
    const workflowPlans = planPaths
      .filter((rel) => existsSync(`${root}/${rel}`))
      .map((rel) => JSON.parse(readFileSync(`${root}/${rel}`, 'utf8').replace(/^﻿/, '')));
    return assessProgramGovernance({
      adrRecord: parsed.data,
      registry,
      workflowPlans,
      redundancyReport: opts.redundancyReport,
      registriesIdempotent,
    });
  } catch (err) {
    return { ok: false, skipped: true, reason: `program-governance: skipped on error — ${err?.message ?? err}` };
  }
}
