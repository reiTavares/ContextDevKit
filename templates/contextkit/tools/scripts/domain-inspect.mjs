#!/usr/bin/env node
/**
 * domain-inspect.mjs — the `/domain` diagnostic (ADR-0128 §27, WF-0068).
 *
 * OBSERVATION-ONLY. Prints what the Domain Engineering classifier decides for an
 * objective — CMIS (code-mutation intent), DAS (domain applicability), the
 * resolved implementation profile, optional specialist/artifact recommendations,
 * and the effective observation mode for this project's config. It changes
 * NOTHING: no write, no gate, no state mutation. Normal activation never needs
 * it — the hooks + classifier fire by deterministic signal; this command is for
 * a human calibrating the rollout to SEE the decision.
 *
 * Reuse-over-rebuild: it calls the SAME pure `buildImplementationBlock` (§15) the
 * diagnostic surface reads — zero new classification logic. `/implementation`
 * is NOT a separate
 * command: the implementation profile is a field of this one block, so a second
 * command would have no distinct consumer (constitution §9) — it is folded here.
 *
 * Usage:
 *   node contextkit/tools/scripts/domain-inspect.mjs "<objective>" [--json]
 *
 * Zero runtime dependencies beyond node:* + the runtime modules it inspects.
 *
 * @module domain-inspect
 */
import { pathToFileURL } from 'node:url';
import { getLevel, loadConfig } from '../../runtime/config/load.mjs';
import { resolveConfig, resolveObservationMode } from '../../runtime/domain-engineering/config.mjs';
import { buildImplementationBlock } from '../../runtime/domain-engineering/envelope-block.mjs';

/**
 * Builds the diagnostic view for an objective: the §15 block + the effective
 * mode. Pure given a root; never mutates anything.
 *
 * @param {string} objective the request text to classify.
 * @param {string} root project root.
 * @returns {Promise<{ objective:string, level:number, enabled:boolean, mode:string, block:object }>}
 */
export async function inspectObjective(objective, root) {
  const level = getLevel(root);
  const config = await loadConfig(root);
  const domainConfig = resolveConfig(config?.domainEngineering);
  const block = buildImplementationBlock({ root, requestText: objective });
  return {
    objective,
    level,
    enabled: domainConfig.enabled === true,
    mode: resolveObservationMode(domainConfig),
    block,
  };
}

/**
 * Renders the human-readable summary. Kept separate from the data builder so the
 * `--json` path can bypass it (SRP).
 *
 * @param {Awaited<ReturnType<typeof inspectObjective>>} view
 * @returns {string}
 */
export function renderView(view) {
  const { block } = view;
  const lines = [
    `🔎 /domain — diagnostic (observation only; nothing was changed)`,
    ``,
    `  objective:        ${view.objective}`,
    `  level:            L${view.level}`,
    `  domainEngineering.enabled: ${view.enabled}`,
    `  effective mode:   ${view.mode}${view.enabled ? '' : '  (default-OFF ⇒ shadow: zero authority)'}`,
    ``,
    `  code-mutation intent (CMIS): ${block.codeMutationIntentScore} → ${block.codeMutationVerdict}`,
    `  domain applicability (DAS):  ${block.domainApplicabilityScore}`,
    `  implementation profile:      ${block.profile}`,
    `  recommendations available:   ${block.recommendationAvailable}`,
    `  recommended agents:          ${fmtList(block.recommendedAgents)}`,
    `  recommended skills:          ${fmtList(block.recommendedSkills)}${block.skillsDegraded ? '  (skill table degraded → baseline)' : ''}`,
    `  recommended artifacts:       ${fmtList(block.recommendedArtifacts)}`,
    `  simulate-impact recommended: ${block.simulateImpactRecommended}`,
    `  reason codes:                ${fmtList(block.reasonCodes)}`,
  ];
  if (block.degraded) lines.push(``, `  ⚠️  classification DEGRADED (missing: ${fmtList(block.missing)}) — a recorded receipt, never a false pass.`);
  return lines.join('\n');
}

/** Formats a list for the summary — `(none)` when empty. */
function fmtList(list) {
  return Array.isArray(list) && list.length > 0 ? list.join(', ') : '(none)';
}

async function main() {
  const argv = process.argv.slice(2);
  const json = argv.includes('--json');
  const objective = argv.filter((a) => !a.startsWith('--')).join(' ').trim();
  if (!objective) {
    console.error('Usage: node contextkit/tools/scripts/domain-inspect.mjs "<objective>" [--json]');
    process.exit(2);
  }
  const view = await inspectObjective(objective, process.cwd());
  console.log(json ? JSON.stringify(view, null, 2) : renderView(view));
}

// Only run as a CLI (importable for tests without side effects). Windows-safe
// entrypoint check via pathToFileURL (mirrors the arch-debt scripts' convention).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(`domain-inspect failed: ${err?.message ?? err}`);
    process.exit(1);
  });
}
