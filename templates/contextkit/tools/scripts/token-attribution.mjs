/**
 * Per-agent / per-command token attribution (ADR-0044 D3).
 *
 * Pure, zero-dep. Given parsed transcript entries (each carrying `message.usage`),
 * splits token cost two ways:
 *   - by AGENT — main loop vs subagent **fan-out**, via the transcript's
 *     `isSidechain` flag (the cost frontier ADR-0041 named);
 *   - by COMMAND — via the transcript's `attributionSkill` field (which slash
 *     command / skill was active when the tokens were spent).
 *
 * Both are derived ONLY from records `/token-report` already parses, so there is
 * NO new persisted artifact to inflate — the named failure mode in ADR-0044 is
 * structurally impossible here. This is the honest input the grade-4 budget gate
 * (ADR-0045) consumes and the proof-of-savings instrument for the fan-out economy.
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
 * @param {Array<{message?:{usage?:object}, isSidechain?:boolean, attributionSkill?:string}>} entries
 *   already filtered to the scope the caller wants (e.g. this project, unless --all)
 * @returns {{ agents: { main: object, subagent: object }, commands: Record<string, object> }}
 *   `agents` always has both keys; `commands` keys are the `attributionSkill` values seen.
 */
export function attribute(entries) {
  const agents = { main: emptyTotals(), subagent: emptyTotals() };
  const commands = {};
  for (const entry of entries || []) {
    const usage = entry?.message?.usage;
    if (!usage) continue;
    fold(entry.isSidechain ? agents.subagent : agents.main, usage);
    const skill = entry.attributionSkill;
    if (typeof skill === 'string' && skill) {
      commands[skill] = commands[skill] || emptyTotals();
      fold(commands[skill], usage);
    }
  }
  return { agents, commands };
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
