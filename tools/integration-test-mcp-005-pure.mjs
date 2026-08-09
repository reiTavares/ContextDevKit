/**
 * MCP-005 integration test — purity, direct safety policy, and secret-shape sub-suite.
 *
 * Covers:
 *   AC#2 — evaluateServer is PURE + deterministic (same input → same output, no I/O)
 *   AC#5 — no governance grade or resolver participates in MCP safety
 *   AC#3 underpinning — looksLikeSecretValue heuristic coverage (secret-shape.mjs unit)
 *
 * Run:  node tools/integration-test-mcp-005-pure.mjs
 * Exits non-zero on any failure. Zero test-framework dependencies (node:* only).
 */
import { reporter } from './it-helpers.mjs';
import {
  loadModules,
  BASE_ENTRY, BASE_MANIFEST,
  makeEvalWith,
} from './integration-test-mcp-005-helpers.mjs';

const { ok, bad, finish } = reporter();
const { evaluateServer, looksLikeSecretValue } = await loadModules();
const evalWith = makeEvalWith(evaluateServer);

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
// [Suite 7] AC#5 — direct MCP safety has no governance-grade dependency
// ---------------------------------------------------------------------------
console.log('\n[Suite 7] Direct MCP safety, no governance grade (AC#5)\n');

const directPolicy = evaluateServer(BASE_ENTRY, BASE_MANIFEST, 'claude-code', {});
directPolicy.decision === 'allow'
  ? ok('clean entry is decided by direct MCP safety controls')
  : bad(`clean entry unexpectedly refused: ${directPolicy.reasons.join(' | ')}`);
directPolicy.reasons.every((reason) => !/autonomy|grade|readiness/i.test(reason))
  ? ok('policy emits no governance-grade or readiness reason')
  : bad(`legacy governance reason leaked into MCP policy: ${directPolicy.reasons.join(' | ')}`);

const ignoredLegacyOptions = evaluateServer(BASE_ENTRY, BASE_MANIFEST, 'claude-code', { unusedLegacyHint: 1 });
JSON.stringify(ignoredLegacyOptions) === JSON.stringify(directPolicy)
  ? ok('extraneous legacy options cannot alter or gate the MCP verdict')
  : bad('legacy options still influence MCP safety policy');

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
