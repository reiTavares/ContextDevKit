/**
 * Registry-backed journey evidence (BIZ-0001 / ADR-0127 Phase 2, first cut).
 *
 * The impure counterpart to the signal-derived evidence: given a work-context id
 * it reads the deterministic on-disk registries to produce REAL checkpoint
 * verdicts the verifier consumes — instead of inferring from classifier signals.
 *
 * Honesty contract (matches the verifier): a checkpoint we cannot determine is
 * left ABSENT (→ verifier treats it `pending`); a checkpoint is `false` only when
 * the registry positively contradicts it. Fail-open: any read error yields `{}`
 * (all-unknown), never a throw (immutable rule 2). Zero deps — `node:*` only.
 *
 * @module journey-evidence-registry
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { pathsFor } from '../config/paths.mjs';

/** Reads + parses a JSON file; returns null on any failure (BOM-safe). */
function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8').replace(/^﻿/, ''));
  } catch {
    return null;
  }
}

/** True when a work-context dir holds at least one nested workflow package. */
function hasNestedWorkflow(memoryDir, contextPath) {
  try {
    const wfDir = join(memoryDir, contextPath, 'workflows');
    return existsSync(wfDir) && readdirSync(wfDir).some((name) => !name.startsWith('.') && !name.startsWith('_'));
  } catch {
    return false;
  }
}

/** No duplicate ADR numbers — a forked/"new wrong series" would collide. */
function adrNumbersUnique(decisions) {
  const nums = [];
  for (const d of decisions) {
    const match = typeof d.id === 'string' && d.id.match(/(\d{3,4})$/);
    if (match) nums.push(match[1]);
  }
  return new Set(nums).size === nums.length;
}

/** True when an ACCEPTED decision governs (or is primarily for) the entity. */
function hasAcceptedGoverningAdr(decisions, entityId) {
  return decisions.some((d) => {
    if (d.status !== 'accepted') return false;
    if (d.primaryContext && d.primaryContext.id === entityId) return true;
    const g = d.governs || {};
    return [g.operations, g.business, g.workflows].some((list) => Array.isArray(list) && list.includes(entityId));
  });
}

/**
 * Gathers real checkpoint verdicts for `entityId` from the on-disk registries.
 *
 * @param {string} root - project root.
 * @param {string} entityId - a `BIZ-####` / `OP-####` work-context id.
 * @returns {Record<string, boolean>} sparse evidence (absent = unknown/pending).
 */
export function gatherRegistryEvidence(root, entityId) {
  const evidence = {};
  try {
    if (!entityId) return evidence;
    const paths = pathsFor(root);
    const memoryDir = paths.memory;

    const wcReg = readJson(join(memoryDir, 'work-context-registry.json'));
    const contexts = (wcReg && Array.isArray(wcReg.contexts)) ? wcReg.contexts : null;
    if (contexts) {
      const ctx = contexts.find((c) => c.id === entityId);
      evidence.ownerContextExists = Boolean(ctx);
      if (ctx && typeof ctx.path === 'string') {
        // Nested workflow present → both true; absent stays unknown (the entity may
        // not need a workflow yet — never assert `false` from absence in the first cut).
        if (hasNestedWorkflow(memoryDir, ctx.path)) {
          evidence.workflowExists = true;
          evidence.workflowNestedUnderOwner = true;
        }
      }
    }

    const decReg = readJson(join(memoryDir, 'decision-registry.json'));
    const decisions = (decReg && Array.isArray(decReg.decisions)) ? decReg.decisions : null;
    if (decisions) {
      evidence.governingAdrAccepted = hasAcceptedGoverningAdr(decisions, entityId);
      evidence.adrNumberContiguous = adrNumbersUnique(decisions);
    }
  } catch {
    return {}; // fail-open — registry evidence is best-effort
  }
  return evidence;
}
