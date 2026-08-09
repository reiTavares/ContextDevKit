/**
 * MCP Dynamic Activation — policy ceiling application.
 *
 * Cohesion note: extracted from activation.mjs (one read-path for "apply the
 * MCP-005 risk-class ceiling to candidates") so activation.mjs stays under the
 * 308-line RED ceiling (constitution section 1). PURE given an injected policy
 * object; node:* only.
 *
 * @module activation-policy
 */

/**
 * Loads policy.mjs from the same directory, defensively. Returns null (with a
 * logged warning) if the substrate is absent or evaluateServer is missing —
 * the caller then degrades to manifest-only (never a silent over-grant).
 *
 * @returns {Promise<{evaluateServer: Function}|null>}
 */
export async function tryLoadPolicy() {
  try {
    const policyModule = await import('./policy.mjs');
    if (typeof policyModule.evaluateServer !== 'function') {
      process.stderr.write(
        '[mcp/activation] WARN: policy.mjs loaded but evaluateServer is not a function — ' +
          'activation degrades to manifest-only (substrate absent).\n',
      );
      return null;
    }
    return policyModule;
  } catch {
    process.stderr.write(
      '[mcp/activation] WARN: policy.mjs absent — activation degrades to manifest-only.\n',
    );
    return null;
  }
}

/**
 * Applies the policy ceiling to candidate servers. A candidate whose manifest
 * entry lacks a 'risk' field has no RegistryEntry provenance and is SKIPPED
 * (not a pass — constitution section 8: no false-positive on the security path).
 * Denied servers are dropped; warned servers pass with a recorded warning.
 *
 * @param {{ entry: object, mode: string, allowedTools: string[] }[]} candidates
 * @param {{evaluateServer: Function}} policy
 * @param {string[]} warnings  Mutated in place with skip/deny/warn notes.
 * @returns {{ entry: object, mode: string, allowedTools: string[] }[]} permitted
 */
export function applyPolicyCeiling(candidates, policy, warnings) {
  const permitted = [];

  for (const candidate of candidates) {
    const manifestEntry = candidate.entry;

    // A manifest entry that carries 'risk' is its own registry source. Without
    // 'risk' there is no provenance — skip rather than produce a false pass.
    if (!manifestEntry.risk) {
      warnings.push(
        `Server '${manifestEntry.id}' SKIPPED by policy: manifest entry lacks ` +
          `'risk' field (no RegistryEntry provenance) — server not exposed (not a pass). ` +
          `Register the server in the MCP registry to enable R0-R5 evaluation.`,
      );
      continue;
    }

    const registryView = {
      risk: manifestEntry.risk,
      allowedHosts: Array.isArray(manifestEntry.allowedHosts) ? manifestEntry.allowedHosts : [],
      pin: manifestEntry.pin ?? null,
      defaultMode: manifestEntry.defaultMode ?? manifestEntry.mode ?? 'read-only',
      capabilities: manifestEntry.capabilities ?? { tools: [], resources: [], prompts: [] },
    };

    let verdict;
    try {
      // Host omitted — activation is host-agnostic; the renderer applies host output.
      verdict = policy.evaluateServer(registryView, manifestEntry, null);
    } catch (policyError) {
      warnings.push(
        `policy.evaluateServer threw for '${manifestEntry.id}': ${policyError.message} — server skipped (not a pass).`,
      );
      continue;
    }

    if (verdict.decision === 'deny') {
      warnings.push(`Server '${manifestEntry.id}' DENIED by policy: ${verdict.reasons.join('; ')}`);
      continue;
    }
    if (verdict.decision === 'warn') {
      warnings.push(
        `Server '${manifestEntry.id}' allowed with policy warnings: ${verdict.reasons.join('; ')}`,
      );
    }

    permitted.push(candidate);
  }

  return permitted;
}
