/**
 * Self-check — EACP autonomy outcomes adapter (card #255 / EACP-20, ADR-0105).
 *
 * Asserts autonomy-outcomes.mjs derives honest usefulAutonomy records from the
 * state substrate's append-only events: in-flight (no qa event) → dropped;
 * actor:'qa'→terminal → green with externalCriteria+evaluatorNotOperator true;
 * post-approval re-open → materialErrorReopen (excluded); qa-reject (no terminal)
 * → qaGreen false; deriveOutcomes non-array → []; outcomesSummary counts; zero-dep.
 *
 * Cohesion note (constitution §1): one cohesive assertion suite for one module.
 * Zero runtime dependencies — node:* only.
 */
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

/** @private — verifies a module imports only node:* / relative specifiers. */
async function checkModuleZeroDep(modPath) {
  let content = '';
  try { content = await readFile(modPath, 'utf-8'); }
  catch (err) { return { error: `could not read: ${err?.message ?? err}` }; }
  const importRegex = /^import\s+(?:[^"'`]*\s+)?from\s+['"`]([^'"`]+)['"`]/gm;
  let match;
  while ((match = importRegex.exec(content)) !== null) {
    const spec = match[1];
    if (!spec.startsWith('.') && !spec.startsWith('node:')) return { error: `imports from "${spec}"` };
  }
  return { error: null };
}

/** Builds a task state with the given event tuples [from,to,actor]. */
function task(id, eventTuples) {
  return { kind: 'task', id, events: eventTuples.map(([from, to, actor]) => ({ from, to, actor })) };
}

/**
 * Runs the EACP autonomy-outcomes adapter self-checks.
 * @param {{ ok: (m: string) => void, bad: (m: string) => void }} reporter
 * @param {{ KIT: string }} ctx - repo root
 */
export async function runEacpOutcomesChecks({ ok, bad }, { KIT }) {
  console.log('Checking EACP autonomy outcomes adapter (card #255 / ADR-0105)...');
  const econ = 'templates/contextkit/tools/scripts/economics';
  const modPath = resolve(KIT, `${econ}/autonomy-outcomes.mjs`);

  let lib;
  try { lib = await import(pathToFileURL(modPath).href); ok('autonomy-outcomes.mjs imports cleanly'); }
  catch (err) { bad(`autonomy-outcomes.mjs import failed: ${err?.message ?? err}`); return; }

  const { AUTONOMY_OUTCOMES_SCHEMA_VERSION, outcomeForState, deriveOutcomes, outcomesSummary } = lib;

  AUTONOMY_OUTCOMES_SCHEMA_VERSION === 'eacp-autonomy-outcomes/1'
    ? ok('outcomes: SCHEMA_VERSION === "eacp-autonomy-outcomes/1"')
    : bad(`outcomes: SCHEMA_VERSION is "${AUTONOMY_OUTCOMES_SCHEMA_VERSION}"`);

  // ── outcomeForState ───────────────────────────────────────────────────────
  // In-flight: only human/auto events, no qa decision → null (not an outcome).
  outcomeForState(task('t1', [['backlog', 'working', 'auto'], ['working', 'testing', 'human']])) === null
    ? ok('outcomeForState: no qa event → null (in-flight, not counted)')
    : bad('outcomeForState: in-flight task should be null');
  outcomeForState(null) === null
    ? ok('outcomeForState: null → null') : bad('outcomeForState: null should be null');

  // QA approval to conclusion → durable green, independence flags true.
  const green = outcomeForState(task('t2', [['working', 'testing', 'human'], ['testing', 'conclusion', 'qa']]));
  green && green.qaGreen === true && green.acceptanceMet === true && green.testsRun === true &&
  green.externalCriteria === true && green.evaluatorNotOperator === true && green.materialErrorReopen === false
    ? ok('outcomeForState: actor:qa→conclusion → green with independence flags true')
    : bad(`outcomeForState: qa-approve record wrong: ${JSON.stringify(green)}`);

  // Approval then re-open (conclusion → working) → materialErrorReopen, not green.
  const reopened = outcomeForState(task('t3', [['testing', 'conclusion', 'qa'], ['conclusion', 'working', 'human']]));
  reopened && reopened.qaGreen === false && reopened.materialErrorReopen === true
    ? ok('outcomeForState: post-approval re-open → qaGreen false + materialErrorReopen true')
    : bad(`outcomeForState: reopen record wrong: ${JSON.stringify(reopened)}`);

  // QA decision but no terminal (a reject bounce) → emitted, qaGreen false, not independent.
  const rejected = outcomeForState(task('t4', [['testing', 'working', 'qa']]));
  rejected && rejected.qaGreen === false && rejected.externalCriteria === false && rejected.evaluatorNotOperator === false
    ? ok('outcomeForState: qa-reject (no terminal) → emitted, qaGreen false, not independent')
    : bad(`outcomeForState: reject record wrong: ${JSON.stringify(rejected)}`);

  // ── deriveOutcomes ────────────────────────────────────────────────────────
  const states = [
    task('a', [['testing', 'conclusion', 'qa']]),                                 // green
    task('b', [['backlog', 'working', 'auto']]),                                  // in-flight → dropped
    task('c', [['testing', 'conclusion', 'qa'], ['conclusion', 'testing', 'human']]), // reopened
    task('d', [['testing', 'working', 'qa']]),                                    // rejected
  ];
  const derived = deriveOutcomes(states);
  derived.length === 3 && derived.every((r) => typeof r.taskId === 'string')
    ? ok('deriveOutcomes: 4 states (1 in-flight dropped) → 3 outcome records')
    : bad(`deriveOutcomes: expected 3, got ${derived.length}`);
  Array.isArray(deriveOutcomes(null)) && deriveOutcomes(null).length === 0
    ? ok('deriveOutcomes: non-array → [] (graceful degrade)')
    : bad('deriveOutcomes: non-array should be []');

  // ── outcomesSummary ───────────────────────────────────────────────────────
  const sum = outcomesSummary(states);
  sum.schemaVersion === 'eacp-autonomy-outcomes/1' && sum.decided === 3 &&
  sum.green === 1 && sum.reopened === 1 && sum.rejected === 1 && sum.tasks.length === 3
    ? ok('outcomesSummary: decided 3 / green 1 / reopened 1 / rejected 1')
    : bad(`outcomesSummary: counts wrong: ${JSON.stringify({ d: sum.decided, g: sum.green, r: sum.reopened, x: sum.rejected })}`);

  // The derived tasks feed multiplierSummary: a green record passes usefulAutonomy.
  const am = await import(pathToFileURL(resolve(KIT, `${econ}/autonomy-multiplier.mjs`)).href);
  am.countUseful(sum.tasks).greenCount === 1
    ? ok('outcomes→multiplier: countUseful(derived tasks).greenCount === 1 (numerator now measured)')
    : bad(`outcomes→multiplier: countUseful wrong: ${JSON.stringify(am.countUseful(sum.tasks))}`);

  // ── Zero-dep invariant ────────────────────────────────────────────────────
  const zd = await checkModuleZeroDep(modPath);
  zd.error ? bad(`zero-dep: autonomy-outcomes.mjs ${zd.error}`)
           : ok('zero-dep invariant: autonomy-outcomes.mjs imports only node:/* or relative paths');
}
