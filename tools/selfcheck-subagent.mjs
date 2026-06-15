/**
 * selfcheck-subagent.mjs — SUBAGENT SCOPE evaluator invariants (CDK-041, ADR-0072).
 *
 * Table-driven unit cases for the PURE evaluate-subagent-scope.mjs:
 *   - in-scope write → allow (silent)
 *   - out-of-scope write → warn + detail.outOfScope
 *   - forbidden hit → warn + detail.forbiddenHits
 *   - advisory NEVER denies
 *   - guarded deny (reason codes present)
 *   - empty touched / empty declared+forbidden → allow
 *   - undeclared scope + non-forbidden write → allow (unobservable, anti-false-positive)
 *
 * Entry point: `runSubagentChecks(rep, { KIT })` where `rep = { ok, bad }`. Pure —
 * no fixture, no temp dir, no I/O. NOT wired into any runner here (the orchestrator
 * wires it into selfcheck-enforcement.mjs).
 */
import { resolve } from 'node:path';

const MODULE_PATH = (KIT) =>
  resolve(KIT, 'templates/contextkit/runtime/execution/evaluate-subagent-scope.mjs');

/**
 * Runs all subagent-scope evaluator invariant checks.
 *
 * @param {{ ok: (m: string) => void, bad: (m: string) => void }} rep reporter
 * @param {{ KIT: string }} ctx KIT is the repo root (parent of tools/)
 */
export async function runSubagentChecks(rep, { KIT }) {
  const { ok, bad } = rep;
  console.log('Checking subagent scope evaluator (CDK-041, ADR-0072)...');

  let mod;
  try {
    mod = await import('file://' + MODULE_PATH(KIT).replaceAll('\\', '/'));
  } catch (err) {
    bad(`evaluate-subagent-scope.mjs failed to import: ${err?.message ?? err}`);
    return;
  }

  const { evaluateSubagentScope, REASON_OUT_OF_SCOPE, REASON_FORBIDDEN_WRITE } = mod;
  typeof evaluateSubagentScope === 'function'
    ? ok('export: evaluateSubagentScope present')
    : bad('export: evaluateSubagentScope missing');
  REASON_OUT_OF_SCOPE === 'subagent-out-of-scope-write'
    ? ok('export: REASON_OUT_OF_SCOPE constant present')
    : bad('export: REASON_OUT_OF_SCOPE wrong/missing');
  REASON_FORBIDDEN_WRITE === 'subagent-forbidden-write'
    ? ok('export: REASON_FORBIDDEN_WRITE constant present')
    : bad('export: REASON_FORBIDDEN_WRITE wrong/missing');

  /**
   * Each case: { name, input, decision, reasonCodes?, outOfScope?, forbiddenHits? }.
   * Absent expectation arrays default to empty.
   */
  const cases = [
    {
      name: 'in-scope write → allow (silent)',
      input: { declared: ['src/'], touched: ['src/a.mjs'], forbidden: [], mode: 'advisory' },
      decision: 'allow',
    },
    {
      name: 'out-of-scope write → warn + detail.outOfScope',
      input: { declared: ['src/'], touched: ['lib/x.mjs'], forbidden: [], mode: 'advisory' },
      decision: 'warn',
      reasonCodes: [REASON_OUT_OF_SCOPE],
      outOfScope: ['lib/x.mjs'],
    },
    {
      name: 'forbidden hit → warn + detail.forbiddenHits',
      input: { declared: [], touched: ['agent-packages/a@1/manifest.json'], forbidden: ['agent-packages/**'], mode: 'advisory' },
      decision: 'warn',
      reasonCodes: [REASON_FORBIDDEN_WRITE],
      forbiddenHits: ['agent-packages/a@1/manifest.json'],
    },
    {
      name: 'advisory NEVER denies (forbidden + out-of-scope, advisory)',
      input: { declared: ['src/'], touched: ['lib/x.mjs', 'agent-packages/p@1/m.json'], forbidden: ['agent-packages/**'], mode: 'advisory' },
      decision: 'warn',
      reasonCodes: [REASON_FORBIDDEN_WRITE, REASON_OUT_OF_SCOPE],
      outOfScope: ['lib/x.mjs'],
      forbiddenHits: ['agent-packages/p@1/m.json'],
    },
    {
      name: 'guarded → deny when reason codes present',
      input: { declared: ['src/'], touched: ['lib/x.mjs'], forbidden: [], mode: 'guarded' },
      decision: 'deny',
      reasonCodes: [REASON_OUT_OF_SCOPE],
      outOfScope: ['lib/x.mjs'],
    },
    {
      name: 'strict → deny on forbidden hit',
      input: { declared: [], touched: ['agent-packages/p@1/m.json'], forbidden: ['agent-packages/**'], mode: 'strict' },
      decision: 'deny',
      reasonCodes: [REASON_FORBIDDEN_WRITE],
      forbiddenHits: ['agent-packages/p@1/m.json'],
    },
    {
      name: 'empty everything → allow (silent)',
      input: { declared: [], touched: [], forbidden: [], mode: 'advisory' },
      decision: 'allow',
    },
    {
      name: 'empty touched (declared+forbidden set) → allow',
      input: { declared: ['src/'], touched: [], forbidden: ['agent-packages/**'], mode: 'advisory' },
      decision: 'allow',
    },
    {
      name: 'undeclared scope + non-forbidden write → allow (unobservable, anti-false-positive)',
      input: { declared: [], touched: ['lib/x.mjs'], forbidden: ['agent-packages/**'], mode: 'advisory' },
      decision: 'allow',
    },
    {
      name: 'malformed input (no args) → allow, never throws',
      input: undefined,
      decision: 'allow',
    },
  ];

  for (const tc of cases) {
    let result;
    try {
      result = tc.input === undefined ? evaluateSubagentScope() : evaluateSubagentScope(tc.input);
    } catch (err) {
      bad(`${tc.name}: threw (${err?.message ?? err})`);
      continue;
    }
    assertCase(rep, tc, result);
  }
}

/**
 * Asserts a single table case against the evaluator's result.
 *
 * @param {{ ok: Function, bad: Function }} rep
 * @param {object} tc expected case
 * @param {object} result evaluator output
 */
function assertCase(rep, tc, result) {
  const { ok, bad } = rep;
  const expectedReasons = (tc.reasonCodes ?? []).slice().sort();
  const actualReasons = (result.reasonCodes ?? []).slice().sort();
  const expectedOut = (tc.outOfScope ?? []).slice().sort();
  const actualOut = (result.detail?.outOfScope ?? []).slice().sort();
  const expectedForbidden = (tc.forbiddenHits ?? []).slice().sort();
  const actualForbidden = (result.detail?.forbiddenHits ?? []).slice().sort();

  const decisionOk = result.decision === tc.decision;
  const reasonsOk = sameList(expectedReasons, actualReasons);
  const outOk = sameList(expectedOut, actualOut);
  const forbiddenOk = sameList(expectedForbidden, actualForbidden);

  decisionOk && reasonsOk && outOk && forbiddenOk
    ? ok(`case: ${tc.name}`)
    : bad(
        `case: ${tc.name} — decision=${result.decision} (want ${tc.decision}), ` +
          `reasons=[${actualReasons}] (want [${expectedReasons}]), ` +
          `outOfScope=[${actualOut}] (want [${expectedOut}]), ` +
          `forbiddenHits=[${actualForbidden}] (want [${expectedForbidden}])`
      );
}

/** Shallow equality of two sorted string arrays. @param {string[]} a @param {string[]} b @returns {boolean} */
function sameList(a, b) {
  if (a.length !== b.length) return false;
  return a.every((value, i) => value === b[i]);
}
