/**
 * MCP-005 integration test — Purity, autonomy resolver, and secret-shape sub-suite.
 *
 * Covers:
 *   AC#2 — evaluateServer is PURE + deterministic (same input → same output, no I/O)
 *   AC#5 — Autonomy resolver consulted; substrate absent → "skipped" never false-pass
 *   AC#3 underpinning — looksLikeSecretValue heuristic coverage (secret-shape.mjs unit)
 *
 * Run:  node tools/integration-test-mcp-005-pure.mjs
 * Exits non-zero on any failure. Zero test-framework dependencies (node:* only).
 */
import { reporter } from './it-helpers.mjs';
import {
  loadModules,
  BASE_ENTRY, BASE_MANIFEST, AUTONOMY_CFG,
  makeEvalWith,
} from './integration-test-mcp-005-helpers.mjs';

const { ok, bad, finish } = reporter();
const { evaluateServer, looksLikeSecretValue, resolveAutonomy } = await loadModules();
const evalWith = makeEvalWith(evaluateServer, resolveAutonomy);

// ---------------------------------------------------------------------------
// [Suite 3] AC#2 — evaluateServer pure + deterministic
// ---------------------------------------------------------------------------
console.log('\n[Suite 3] evaluateServer pure + deterministic (AC#2)\n');

// Same inputs → identical output (run twice, deep compare)
const runA = evalWith(BASE_ENTRY, BASE_MANIFEST);
const runB = evalWith(BASE_ENTRY, BASE_MANIFEST);

JSON.stringify(runA) === JSON.stringify(runB)
  ? ok('evaluateServer is deterministic (two calls, identical input → identical output)')
  : bad(`evaluateServer is not deterministic:\nA=${JSON.stringify(runA)}\nB=${JSON.stringify(runB)}`);

runA.decision === 'allow'
  ? ok('clean base entry resolves to allow')
  : bad(`clean base entry: expected allow, got ${runA.decision} | ${runA.reasons.join('|')}`);

// Result shape is complete
['decision', 'reasons', 'riskClass', 'mode', 'allowedTools'].every((k) => k in runA)
  ? ok('evaluateServer result has all required keys')
  : bad(`evaluateServer result missing key(s): ${['decision','reasons','riskClass','mode','allowedTools'].filter((k)=>!(k in runA)).join(', ')}`);

Array.isArray(runA.reasons)
  ? ok('evaluateServer reasons is an array')
  : bad('evaluateServer reasons is not an array');

// TypeError when entry is not an object
let threwOnNull = false;
try { evaluateServer(null); } catch { threwOnNull = true; }
threwOnNull
  ? ok('evaluateServer throws TypeError when entry is null')
  : bad('evaluateServer should throw when entry is null');

let threwOnString = false;
try { evaluateServer('bad'); } catch { threwOnString = true; }
threwOnString
  ? ok('evaluateServer throws TypeError when entry is a string')
  : bad('evaluateServer should throw when entry is a string');

// ---------------------------------------------------------------------------
// [Suite 7] AC#5 — Autonomy resolver consulted; substrate absent → skipped
// ---------------------------------------------------------------------------
console.log('\n[Suite 7] Autonomy resolver (AC#5)\n');

// With resolver: reason string recorded
const withResolver = evalWith(BASE_ENTRY, BASE_MANIFEST);
withResolver.reasons.some((r) => /^autonomy:grade-/.test(r))
  ? ok('autonomy:grade-N reason recorded when resolver is present')
  : bad(`autonomy grade reason missing | reasons: ${withResolver.reasons.join(' | ')}`);

// Without resolver (substrate absent): skipped, NOT a false pass, NOT a crash
const noSubstrate = evaluateServer(BASE_ENTRY, BASE_MANIFEST, 'claude-code', {});
noSubstrate.reasons.some((r) => /autonomy:substrate-skipped/.test(r))
  ? ok('absent substrate → autonomy:substrate-skipped reason recorded')
  : bad(`substrate-skipped reason missing | reasons: ${noSubstrate.reasons.join(' | ')}`);

noSubstrate.decision === 'allow'
  ? ok('absent substrate: clean entry still allows (skipped ≠ deny)')
  : bad(`absent substrate: expected allow, got ${noSubstrate.decision}`);

// Resolver throwing must not crash policy — treated as manual (fail-closed)
const throwingResolver = () => { throw new Error('resolver exploded'); };
let resolverErrorResult;
let resolverErrorCrashed = false;
try {
  resolverErrorResult = evaluateServer(BASE_ENTRY, BASE_MANIFEST, 'claude-code', {
    resolveAutonomyFn: throwingResolver,
    autonomyConfig: AUTONOMY_CFG,
  });
} catch {
  resolverErrorCrashed = true;
}
resolverErrorCrashed
  ? bad('policy must not propagate resolver errors (no crash allowed)')
  : ok('resolver error does not crash evaluateServer');

resolverErrorResult?.reasons?.some((r) => /autonomy:resolver-error-fail-closed/.test(r))
  ? ok('resolver error → autonomy:resolver-error-fail-closed reason recorded')
  : bad(`resolver-error reason missing | reasons: ${resolverErrorResult?.reasons?.join(' | ')}`);

// Autonomy manual floor + otherwise-allow → warn (cannot exceed human floor)
const manualFloorResolver = () => ({ mode: 'manual', grade: 1 });
const manualFloor = evaluateServer(BASE_ENTRY, BASE_MANIFEST, 'claude-code', {
  resolveAutonomyFn: manualFloorResolver,
  autonomyConfig: AUTONOMY_CFG,
});
manualFloor.reasons.some((r) => /autonomy:floor-requires-human-consent/.test(r))
  ? ok('autonomy manual floor on otherwise-allow → human-consent warn reason')
  : bad(`autonomy floor warn missing | reasons: ${manualFloor.reasons.join(' | ')}`);

manualFloor.decision !== 'deny'
  ? ok('autonomy manual floor alone does not escalate to deny (warn only)')
  : bad('autonomy manual floor should not be a deny by itself');

// ---------------------------------------------------------------------------
// [Suite 9] AC#3 — looksLikeSecretValue heuristic coverage (unit)
// ---------------------------------------------------------------------------
console.log('\n[Suite 9] secret-shape.mjs heuristics (underpins AC#3)\n');

const SECRET_VALUE_CASES = [
  ['GitHub PAT ghp_',  'ghp_ABCDEFGHIJKLMNOPQRSTUVWX', true],
  ['GitHub server ghs_', 'ghs_ABCDEFGHIJKLMNOPQRSTUVWX', true],
  ['OpenAI key sk-', 'sk-abcdefghijklmnopqrstuvwxyz', true],
  ['Slack xoxb token', 'xoxb-12345678901-ABCDEFGHIJKLMN-abc123def456ghi', true],
  ['base64 blob (40+)', 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmn', true],
  ['string with whitespace', 'MY SECRET TOKEN', true],
  ['lowercase env-var name', 'my_token', true],
  ['mixed-case env-var name', 'My_Token', true],
  // Valid env-var NAMES must NOT be flagged as values
  ['valid name GITHUB_TOKEN', 'GITHUB_TOKEN', false],
  ['valid name OPENAI_API_KEY', 'OPENAI_API_KEY', false],
  ['valid name MY_SECRET_REF', 'MY_SECRET_REF', false],
  ['valid single-letter A', 'A', false],
  ['valid name with digits MY_TOKEN_1', 'MY_TOKEN_1', false],
];

for (const [label, candidate, expectValue] of SECRET_VALUE_CASES) {
  const result = looksLikeSecretValue(candidate);
  result === expectValue
    ? ok(`looksLikeSecretValue('${candidate.slice(0, 20)}') = ${expectValue} — ${label}`)
    : bad(`looksLikeSecretValue('${candidate.slice(0, 20)}'): expected ${expectValue}, got ${result} — ${label}`);
}

// Non-string input is treated as a value (fail-closed)
looksLikeSecretValue(null) === true
  ? ok('looksLikeSecretValue(null) = true (fail-closed)')
  : bad('looksLikeSecretValue(null) should return true');
looksLikeSecretValue(42) === true
  ? ok('looksLikeSecretValue(42) = true (fail-closed)')
  : bad('looksLikeSecretValue(42) should return true');

// ---------------------------------------------------------------------------
finish('MCP-005 pure');
