#!/usr/bin/env node
/**
 * agent-registry-core — pure join/rollup for the unified agent index (CDK-081).
 *
 * Accepts a roster of agent tuning rows and a model-resolver function, returns
 * the assembled registry payload. Intentionally I/O-free: all disk access lives
 * in the sibling agent-registry.mjs so this module is unit-testable without
 * touching the filesystem.
 *
 * Invariant (§8 honesty): costUsd is ALWAYS null because the usage-event schema
 * carries no agentName field — only agentScope (main/subagent) and
 * attributionSkill. Per-agent cost attribution is therefore impossible with the
 * current schema and must never be fabricated.
 */

/** @typedef {{ name:string, squad:string, hasBriefing:boolean, mentions:number }} TuningAgent */
/** @typedef {{ model:string|null, tier:string|null }} ModelResolution */
/** @typedef {{ name:string, squad:string, model:string|null, tier:string|null, hasBriefing:boolean, mentions:number, costUsd:null, costConfidence:'unattributable' }} RegistryAgent */

/**
 * The single sentence explaining why cost attribution is impossible. Load-bearing
 * §8 invariant — referenced by every agent row and by the top-level costNote.
 */
export const COST_NOTE =
  'Per-agent cost cannot be attributed because the usage-event schema contains ' +
  'no agentName field — only agentScope (main/subagent) and attributionSkill — ' +
  'making it impossible to isolate individual agent spend without schema changes.';

/**
 * Groups agents into tier buckets. Agents whose tier is null land in 'unresolved'
 * rather than being silently dropped — rule 8: skip means "skipped", not "pass".
 *
 * @param {RegistryAgent[]} agents
 * @returns {Record<string,number>}
 */
function countByTier(agents) {
  /** @type {Record<string,number>} */
  const buckets = {};
  for (const agent of agents) {
    const bucket = agent.tier ?? 'unresolved';
    buckets[bucket] = (buckets[bucket] ?? 0) + 1;
  }
  return buckets;
}

/**
 * Builds the registry payload from already-collected tuning data and a
 * resolver function. Pure — no I/O, no side effects.
 *
 * @param {TuningAgent[]} tuningAgents array from agent-tuning.collect()
 * @param {(name:string) => ModelResolution} resolveFn returns { model, tier } for an agent name
 * @returns {{ agents: RegistryAgent[], totals: { agents:number, byTier:Record<string,number>, withoutBriefing:number } }}
 */
export function assembleRegistry(tuningAgents, resolveFn) {
  const agents = tuningAgents.map((tuning) => {
    let model = null;
    let tier = null;
    try {
      const resolved = resolveFn(tuning.name);
      model = resolved.model ?? null;
      tier = resolved.tier ?? null;
    } catch {
      // Agent absent from policy or policy unavailable — degrade to null (rule 8).
    }

    return {
      name: tuning.name,
      squad: tuning.squad,
      model,
      tier,
      hasBriefing: tuning.hasBriefing,
      mentions: tuning.mentions,
      costUsd: null,
      costConfidence: /** @type {'unattributable'} */ ('unattributable'),
    };
  });

  const totals = {
    agents: agents.length,
    byTier: countByTier(agents),
    withoutBriefing: agents.filter((a) => !a.hasBriefing).length,
  };

  return { agents, totals };
}

// ---------------------------------------------------------------- self-check
// Running this file directly prints the export surface so CI can verify it loads.
// Use only process.argv[1] — never import.meta.url — so this block is silent
// when another module imports agent-registry-core.mjs as a dependency.
const isMain =
  Boolean(process.argv[1]) &&
  process.argv[1].replace(/\\/g, '/').endsWith('agent-registry-core.mjs');

if (isMain) {
  console.log('agent-registry-core exports: assembleRegistry, COST_NOTE');
  console.log('costNote:', COST_NOTE.slice(0, 80) + '…');
}
