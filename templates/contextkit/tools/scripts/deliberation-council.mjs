#!/usr/bin/env node
/**
 * deliberation-council — deterministic specialist-roster + tiered-research planner
 * for `/debate` (ADR-0070). Turns a debate question into (1) the named specialist
 * council that should argue it and (2) the tiered model plan that gathers evidence
 * cheaply before the reasoning voices debate.
 *
 * Why a script: ADR-0035 voices were a flat count of anonymous positions; the
 * orchestrator improvised who argued. This makes the roster RELEVANT-by-construction
 * and DETERMINISTIC (same question → same council) — the kit distrusts AI goodwill,
 * so roster selection is computed, not vibed. The skill reads this plan and dispatches.
 *
 * Pure + zero-dep core (rule 1): keyword classification + clamp. Model aliases come
 * from `model-policy.mjs` (ADR-0052); if routing-policy is absent (L<4 / host gap)
 * the plan still returns tiers with `model: null` — it degrades, never throws (rule 8).
 *
 * Contract (ADR-0052 / ADR-0070): the VOICES and SYNTHESIZER always argue at the
 * `reasoning` tier — the specialist agent supplies the PERSPECTIVE (lane), never a
 * cheaper argument. Only the scout (evidence) and verify phases run on cheaper tiers.
 *
 *   deliberation-council.mjs plan --question "<text>" [--complexity feature|architectural] [--host claude|codex|agy] [--json]
 */
import { loadConfigSync } from '../../runtime/config/load.mjs';
import { DEFAULT_CONFIG } from '../../runtime/config/defaults.mjs';
import { aliasForTier } from './model-policy.mjs';

/**
 * Lane → trigger keywords. Order is the PRIORITY used when trimming past `max`
 * (architecture + security are the protected spine and are trimmed last).
 */
const LANE_KEYWORDS = Object.freeze({
  architecture: ['architect', 'design', 'pattern', 'refactor', 'migrat', 'coupl', 'schema', 'structure', 'scalab', 'latency', 'throughput', 'dependency'],
  security: ['security', 'auth', 'token', 'secret', 'credential', 'crypto', 'vulnerab', 'injection', 'permission', 'privacy', 'lgpd', 'pii', 'attack'],
  features: ['feature', 'capability', 'requirement', 'user story', 'scope', 'mvp', 'roadmap'],
  deepen: ['deepen', 'mature', 'enhance', 'polish', 'harden existing', 'improve existing'],
  ux: ['ux', 'ui ', 'usability', 'onboarding', 'accessibilit', 'a11y', 'layout', 'interaction', 'screen', 'flow'],
  growth: ['growth', 'conversion', 'funnel', 'retention', 'churn', 'activation', 'acquisition', 'seo', 'landing'],
});

/** Lane priority — architecture is always the spine; security is protected next. */
const LANE_PRIORITY = Object.freeze(['architecture', 'security', 'features', 'deepen', 'ux', 'growth']);

/** Perspectives used to PAD up to `council.min` when too few lanes matched (deduped, in order). */
const PAD_POOL = Object.freeze(['architect', 'security', 'product-owner', 'code-reviewer', 'ux-designer', 'growth']);

/**
 * Classifies a question into the advisor lanes by keyword. Always seats
 * `architecture` (the spine) so the architect is in every council.
 *
 * @param {string} question the framed decision question
 * @returns {string[]} matched lanes, in LANE_PRIORITY order
 */
export function classifyLanes(question) {
  const text = String(question || '').toLowerCase();
  const matched = new Set(['architecture']);
  for (const [lane, words] of Object.entries(LANE_KEYWORDS)) {
    if (words.some((w) => text.includes(w))) matched.add(lane);
  }
  return LANE_PRIORITY.filter((lane) => matched.has(lane));
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function laneOwners(config) {
  const lanes = config?.advisor?.lanes ?? {};
  const owners = {};
  for (const lane of LANE_PRIORITY) owners[lane] = lanes[lane]?.owner ?? null;
  return owners;
}

/**
 * Selects the specialist council for a question.
 *
 * @param {string} question framed decision question
 * @param {object} [config] merged contextkit config (advisor.lanes + deliberations)
 * @returns {{ autoSelect: boolean, members: Array<{lane:string|null, agent:string|null}>, scale: {min:number,max:number,matched:number} }}
 */
export function selectCouncil(question, config = DEFAULT_CONFIG) {
  const delib = config?.deliberations ?? {};
  const council = delib.council ?? {};
  const min = Number.isInteger(council.min) ? council.min : 3;
  const max = Number.isInteger(council.max) ? council.max : 6;

  // autoSelect OFF → legacy flat roster: N generic, unnamed positions (ADR-0035 default).
  if (council.autoSelect === false) {
    const count = clamp(Number(delib.voices) || min, min, max);
    const members = Array.from({ length: count }, () => ({ lane: null, agent: null }));
    return { autoSelect: false, members, scale: { min, max, matched: 0 } };
  }

  const matched = classifyLanes(question);
  const owners = laneOwners(config);
  const seen = new Set();
  let members = [];
  for (const lane of matched) {
    const agent = owners[lane];
    if (!agent || seen.has(agent)) continue;
    seen.add(agent);
    members.push({ lane, agent });
  }
  // Pad up to `min` with distinct perspectives so there are always ≥ min voices.
  for (const agent of PAD_POOL) {
    if (members.length >= min) break;
    if (seen.has(agent)) continue;
    seen.add(agent);
    members.push({ lane: null, agent });
  }
  // Trim past `max`, keeping the highest-priority lanes (architecture/security survive).
  if (members.length > max) members = members.slice(0, max);

  return { autoSelect: true, members, scale: { min, max, matched: matched.length } };
}

/**
 * Resolves the tiered research plan (ADR-0070 §4). Scouts gather evidence cheaply,
 * voices + synthesizer argue at `reasoning`, verify runs on the powerful tier. When
 * `research.tiered` is false, returns `{ tiered: false }` — the voices read only the
 * bounded context-pack, as in the original ADR-0035 flow.
 *
 * @param {object} [config] merged config
 * @param {string} [host] dispatch host (claude|codex|agy)
 * @returns {object} the research plan with resolved model aliases (model may be null)
 */
export function planResearch(config = DEFAULT_CONFIG, host = 'claude') {
  const research = config?.deliberations?.research ?? {};
  if (research.tiered === false) return { tiered: false };
  const tierPlan = (tier) => {
    const { model, reasons } = aliasForTierSafe(tier, host);
    return { tier, model, reasons };
  };
  return {
    tiered: true,
    scouts: tierPlan(research.scoutTier || 'fast'),
    verify: tierPlan(research.verifyTier || 'powerful'),
    voices: tierPlan('reasoning'),
    synthesizer: tierPlan('reasoning'),
  };
}

/** aliasForTier wrapped so an absent routing-policy degrades to a null model (rule 8). */
function aliasForTierSafe(tier, host) {
  try {
    return aliasForTier(tier, { host });
  } catch {
    return { model: null, tier, reasons: ['routing-policy-absent'] };
  }
}

/**
 * Builds the full deliberation plan: the specialist council + the tiered research
 * plan, with each voice stamped at the `reasoning` tier (ADR-0052 — voices are
 * never downgraded; the agent supplies only the perspective).
 *
 * @param {string} question framed decision question
 * @param {{ config?: object, host?: string }} [opts]
 * @returns {object}
 */
export function buildPlan(question, opts = {}) {
  const config = opts.config ?? DEFAULT_CONFIG;
  const host = opts.host ?? 'claude';
  const { autoSelect, members, scale } = selectCouncil(question, config);
  const voiceTier = aliasForTierSafe('reasoning', host);
  const council = members.map((m) => ({ ...m, tier: 'reasoning', model: voiceTier.model }));
  return {
    question: String(question || ''),
    autoSelect,
    council,
    size: council.length,
    scale,
    research: planResearch(config, host),
  };
}

// ---------------------------------------------------------------- thin CLI
const isMain = process.argv[1] && process.argv[1].replaceAll('\\', '/').endsWith('deliberation-council.mjs');
if (isMain) {
  const argv = process.argv.slice(2);
  const flag = (name) => { const at = argv.indexOf(`--${name}`); return at >= 0 ? argv[at + 1] : null; };
  const has = (name) => argv.includes(`--${name}`);
  const verb = argv[0];
  if (verb !== 'plan') {
    console.error('Usage: deliberation-council.mjs plan --question "<text>" [--host claude|codex|agy] [--json]');
    process.exit(1);
  }
  const question = flag('question') || '';
  if (!question) { console.error('deliberation-council: --question is required'); process.exit(1); }
  let config;
  try { config = loadConfigSync(); } catch { config = DEFAULT_CONFIG; }
  const plan = buildPlan(question, { config, host: flag('host') ?? 'claude' });
  if (has('json')) { console.log(JSON.stringify(plan, null, 2)); }
  else {
    console.log(`\n🗣️  Deliberation council (${plan.size} voices · autoSelect=${plan.autoSelect})\n`);
    for (const m of plan.council) console.log(`  ${(m.agent ?? 'generic').padEnd(16)} ${m.lane ? `[${m.lane}]` : '[open]'}\t${m.model ?? 'reasoning'}`);
    if (plan.research.tiered) {
      console.log('\n  research (tiered):');
      console.log(`    scouts   ${plan.research.scouts.model ?? plan.research.scouts.tier}`);
      console.log(`    verify   ${plan.research.verify.model ?? plan.research.verify.tier}`);
      console.log(`    voices   ${plan.research.voices.model ?? plan.research.voices.tier}`);
    }
    console.log('');
  }
}
