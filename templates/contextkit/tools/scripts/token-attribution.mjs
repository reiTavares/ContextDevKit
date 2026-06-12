/**
 * Per-agent / per-command token attribution (ADR-0044 D3).
 *
 * Pure, zero-dep. Given parsed transcript entries (each carrying `message.usage`),
 * splits token cost two ways:
 *   - by AGENT — main loop vs subagent **fan-out**, via the transcript's
 *     `isSidechain` flag (the cost frontier ADR-0041 named). This split is always
 *     available and is the honest input the grade-4 budget gate (ADR-0045) reads.
 *   - by COMMAND — via the transcript's `attributionSkill` field. This field is
 *     populated by the HOST only while a slash command / skill is the attribution
 *     context, so `commands` is legitimately empty on sessions that ran no
 *     attributed command. Treat it as a best-effort lens (the report omits the
 *     "Top commands" section when empty), NOT a guaranteed dimension.
 *   - by MODEL — via the transcript's `message.model` id (ADR-0052 Phase 2): the
 *     per-model spend split that makes cost-tiered routing measurable. Answers
 *     "did the fan-out actually run cheap, or was it all premium?" with data.
 *     A record with no model id buckets under `unknown` (never silently dropped).
 *
 * Both are derived ONLY from records `/token-report` already parses, so there is
 * NO new persisted artifact to inflate — the named failure mode in ADR-0044 is
 * structurally impossible here.
 */

/** A fresh zeroed token bucket. */
const emptyTotals = () => ({ input: 0, output: 0, cacheRead: 0, cacheCreate: 0, turns: 0 });

/** Grand total (input + output + both cache classes) of a bucket. */
export const totalOf = (bucket) => bucket.input + bucket.output + bucket.cacheRead + bucket.cacheCreate;

/** Folds one `message.usage` object into a bucket (missing fields count as 0). */
function fold(bucket, usage) {
  bucket.input += usage.input_tokens || 0;
  bucket.output += usage.output_tokens || 0;
  bucket.cacheRead += usage.cache_read_input_tokens || 0;
  bucket.cacheCreate += usage.cache_creation_input_tokens || 0;
  bucket.turns += 1;
}

/**
 * Attributes usage across the given transcript entries.
 *
 * @param {Array<{message?:{usage?:object, model?:string}, isSidechain?:boolean, attributionSkill?:string}>} entries
 *   already filtered to the scope the caller wants (e.g. this project, unless --all)
 * @returns {{ agents: { main: object, subagent: object }, commands: Record<string, object>, byModel: Record<string, object> }}
 *   `agents` always has both keys; `commands` keys are the `attributionSkill` values
 *   seen; `byModel` keys are the `message.model` ids seen (`unknown` for records
 *   without one).
 */
export function attribute(entries) {
  const agents = { main: emptyTotals(), subagent: emptyTotals() };
  const commands = {};
  const byModel = {};
  for (const entry of entries || []) {
    const usage = entry?.message?.usage;
    if (!usage) continue;
    fold(entry.isSidechain ? agents.subagent : agents.main, usage);
    const skill = entry.attributionSkill;
    if (typeof skill === 'string' && skill) {
      commands[skill] = commands[skill] || emptyTotals();
      fold(commands[skill], usage);
    }
    const model = (typeof entry?.message?.model === 'string' && entry.message.model) ? entry.message.model : 'unknown';
    byModel[model] = byModel[model] || emptyTotals();
    fold(byModel[model], usage);
  }
  return { agents, commands, byModel };
}

/**
 * Subagent fan-out share of total spend, 0..1 (0 when nothing was spent). The
 * single scalar the budget gate reads to answer "how much of this session went
 * to fan-out?" without re-deriving the split.
 *
 * @param {{ agents: { main: object, subagent: object } }} attribution
 * @returns {number}
 */
export function fanoutShare(attribution) {
  const main = totalOf(attribution.agents.main);
  const sub = totalOf(attribution.agents.subagent);
  const all = main + sub;
  return all > 0 ? sub / all : 0;
}
