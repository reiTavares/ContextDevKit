/**
 * Read-only advisory reader for the governance-contract envelope (BIZ-0006 /
 * WF-0088 advisory lift). This is the ADVISORY consumer the shadow stage lacked:
 * it reads the emitted `governance-contract.json` for the active work context and
 * renders one compact advisory block so the resolved ceremony shape is actually
 * SURFACED — not written to a file nobody reads.
 *
 * RESOLVE, NEVER ENFORCE. This module only reads + formats. It blocks nothing,
 * writes nothing, and an absent/invalid/stale contract yields `null` → the surface
 * simply says nothing (skipped, never a false negative, never a block). Fail-open:
 * every export returns null on any error and NEVER throws (immutable rule 2).
 *
 * Zero runtime dependencies — node:* + the schema validator only.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathsFor } from '../../runtime/config/paths.mjs';
import { stripBom } from '../../runtime/work/enums.mjs';
import {
  validateGovernanceContract,
  GOVERNANCE_CONTRACT_FILENAME,
  CONTEXT_REF_TYPES,
} from '../../runtime/work/schema-governance-contract.mjs';

/**
 * Resolve the on-disk directory of a top-level work context (business/operation)
 * from its id, by prefix-matching the memory root. Workflows are nested under an
 * owner and are not resolved here (the advisory surfaces the owning context).
 *
 * @param {string} root project root
 * @param {string} id `BIZ-####` or `OP-####`
 * @returns {string|null} absolute context dir, or null when unresolved
 */
export function resolveContextDir(root, id) {
  if (typeof id !== 'string') return null;
  const paths = pathsFor(root);
  const base = id.startsWith('BIZ-') ? paths.business : id.startsWith('OP-') ? paths.operations : null;
  if (!base || !existsSync(base)) return null;
  const prefix = `${id}-`;
  const match = readdirSync(base).find((name) => name === id || name.startsWith(prefix));
  return match ? join(base, match) : null;
}

/**
 * Read + validate a governance contract at a context root. Pure read, fail-open.
 *
 * @param {string} contextDir absolute context directory
 * @returns {object|null} the schema-valid contract, or null when absent/invalid
 */
export function readGovernanceContract(contextDir) {
  try {
    if (!contextDir) return null;
    const target = join(contextDir, GOVERNANCE_CONTRACT_FILENAME);
    if (!existsSync(target)) return null;
    const contract = JSON.parse(stripBom(readFileSync(target, 'utf-8')));
    const verdict = validateGovernanceContract(contract);
    return verdict.ok ? contract : null;
  } catch {
    return null;
  }
}

/**
 * Render a compact advisory block for a schema-valid contract. Read-only,
 * informational — names the effective shape, the resolved axes, the governing
 * decision, and the state authority (so the reader knows this is a projection,
 * not the source of truth). Returns '' on any missing input (never throws).
 *
 * @param {object|null} contract a validated contract (or null)
 * @returns {string} newline-terminated advisory block, or ''
 */
export function formatGovernanceContractAdvisory(contract) {
  try {
    if (!contract || !CONTEXT_REF_TYPES.includes(contract.contextRef?.type)) return '';
    const axes = contract.resolvedAxes || {};
    const decision = contract.governingDecision || {};
    const decisionText = decision.ref ? `${decision.ref} (${decision.status})` : 'uncovered';
    const lines = [
      `‹CONTEXTKIT-GOVERNANCE-CONTRACT ${contract.contextRef.type}=${contract.contextRef.id}›`,
      `  shape: ${contract.ceremonyShape} · axes: ${axes.nature}/${axes.executionMode}/${axes.tier}/${axes.kind}`,
      `  governed by: ${decisionText} · state authority: ${contract.stateAuthority || 'workflow-state.json'}`,
    ];
    if (contract.ceremonyOverride?.applied) {
      const override = contract.ceremonyOverride;
      lines.push(`  ⚠ ceremony override: ${override.resolvedShape} → ${override.shape} (by ${override.authorizedBy})`);
    }
    lines.push('  (advisory — read-only projection of the resolved ceremony; never blocks. WF-0088/ADR-0148)');
    return lines.join('\n') + '\n';
  } catch {
    return '';
  }
}

/**
 * End-to-end advisory: resolve the active context from its id, read its contract,
 * and format the advisory block. The single entry point the advisory hook calls.
 *
 * @param {string} root project root
 * @param {string} id active work-context id (`BIZ-####`/`OP-####`)
 * @returns {string} advisory block, or '' when nothing to surface
 */
export function renderGovernanceContractAdvisory(root, id) {
  try {
    const contextDir = resolveContextDir(root, id);
    if (!contextDir) return '';
    return formatGovernanceContractAdvisory(readGovernanceContract(contextDir));
  } catch {
    return '';
  }
}
