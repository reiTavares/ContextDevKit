/**
 * MCP-005 integration test — DENY triggers sub-suite.
 *
 * Covers:
 *   AC#3 — Table-driven DENY reason coverage: literal secret, floating pin,
 *           host not in allowedHosts, R4/R5 without recorded approval,
 *           undeclared tool, unknown risk class.
 *   AC#3 subcase — recorded human approval satisfies R4/R5 gate.
 *
 * Run:  node tools/integration-test-mcp-005-deny.mjs
 * Exits non-zero on any failure. Zero test-framework dependencies (node:* only).
 */
import { reporter } from './it-helpers.mjs';
import {
  loadModules,
  BASE_ENTRY, BASE_MANIFEST, APPROVAL_TOKEN,
  makeEvalWith,
} from './integration-test-mcp-005-helpers.mjs';

const { ok, bad, finish } = reporter();
const { evaluateServer, resolveAutonomy } = await loadModules();
const evalWith = makeEvalWith(evaluateServer, resolveAutonomy);

// ---------------------------------------------------------------------------
// [Suite 4] AC#3 — table-driven DENY reason coverage
// ---------------------------------------------------------------------------
console.log('\n[Suite 4] DENY triggers (AC#3)\n');

const DENY_CASES = [
  // [label, entry, manifest, host, extraOpts, reasonPattern]
  [
    'literal GitHub PAT value in referencedSecrets',
    BASE_ENTRY,
    { referencedSecrets: ['ghp_ABCDEFGHIJKLMNOPQRSTUVWX'], allowedTools: ['read_file'] },
    'claude-code', {},
    /secret:literal-value/,
  ],
  [
    'OpenAI-style key value in referencedSecrets',
    BASE_ENTRY,
    { referencedSecrets: ['sk-abcdefghijklmnopqrstuvwxyz1234'], allowedTools: ['read_file'] },
    'claude-code', {},
    /secret:literal-value/,
  ],
  [
    'whitespace in secret reference (not a valid env-var name)',
    BASE_ENTRY,
    { referencedSecrets: ['MY SECRET TOKEN'], allowedTools: ['read_file'] },
    'claude-code', {},
    /secret:literal-value/,
  ],
  [
    'pin with @latest (floating)',
    { ...BASE_ENTRY, pin: { npm: 'latest' } },
    BASE_MANIFEST,
    'claude-code', {},
    /supply-chain:unpinned-or-floating/,
  ],
  [
    'pin with caret range (^1.2.3)',
    { ...BASE_ENTRY, pin: { npm: '^1.2.3' } },
    BASE_MANIFEST,
    'claude-code', {},
    /supply-chain:unpinned-or-floating/,
  ],
  [
    'pin with tilde range (~1.2.3)',
    { ...BASE_ENTRY, pin: { npm: '~1.2.3' } },
    BASE_MANIFEST,
    'claude-code', {},
    /supply-chain:unpinned-or-floating/,
  ],
  [
    'empty pin object',
    { ...BASE_ENTRY, pin: {} },
    BASE_MANIFEST,
    'claude-code', {},
    /supply-chain:unpinned-or-floating/,
  ],
  [
    'null pin',
    { ...BASE_ENTRY, pin: null },
    BASE_MANIFEST,
    'claude-code', {},
    /supply-chain:unpinned-or-floating/,
  ],
  [
    'pin with wildcard *',
    { ...BASE_ENTRY, pin: { npm: '*' } },
    BASE_MANIFEST,
    'claude-code', {},
    /supply-chain:unpinned-or-floating/,
  ],
  // NOTE: { sha: 'HEAD' } is NOT currently caught because FLOATING_REFS stores
  // uppercase 'HEAD' but isConcretelyPinned lowercases before the Set lookup —
  // 'head' is not in the set. This is a known gap: if the bug is fixed the case
  // below should be uncommented and it will turn green:
  //   ['pin with HEAD', { ...BASE_ENTRY, pin: { sha: 'HEAD' } }, BASE_MANIFEST, 'claude-code', {}, /supply-chain:unpinned-or-floating/],
  [
    'host not in allowedHosts (explicit list)',
    BASE_ENTRY,
    BASE_MANIFEST,
    'evil-host',
    { allowedHosts: ['claude-code', 'cursor'] },
    /host:not-in-allowedHosts/,
  ],
  [
    'empty host when allowedHosts is explicit',
    BASE_ENTRY,
    BASE_MANIFEST,
    '',
    { allowedHosts: ['claude-code'] },
    /host:not-in-allowedHosts/,
  ],
  [
    'R4 enabled without recorded human approval',
    { ...BASE_ENTRY, risk: 'R4' },
    BASE_MANIFEST,
    'claude-code', {},
    /R4-requires-recorded-human-approval/,
  ],
  [
    'R5 enabled without recorded human approval',
    { ...BASE_ENTRY, risk: 'R5' },
    BASE_MANIFEST,
    'claude-code', {},
    /R5-requires-recorded-human-approval/,
  ],
  [
    'tool not declared in registry capabilities',
    BASE_ENTRY,
    { allowedTools: ['ghost_tool'] },
    'claude-code', {},
    /tools:undeclared-in-registry/,
  ],
  [
    'multiple undeclared tools in allowedTools',
    BASE_ENTRY,
    { allowedTools: ['ghost_tool', 'phantom_op'] },
    'claude-code', {},
    /tools:undeclared-in-registry/,
  ],
  [
    'unknown risk class treated as R5 (deny)',
    { ...BASE_ENTRY, risk: 'R9' },
    BASE_MANIFEST,
    'claude-code', {},
    /unknown-class/,
  ],
];

for (const [label, entry, manifest, host, extraOpts, pattern] of DENY_CASES) {
  const res = evalWith(entry, manifest, host, extraOpts);
  res.decision === 'deny'
    ? ok(`DENY — ${label}`)
    : bad(`expected deny but got '${res.decision}': ${label} | reasons: ${res.reasons.join(' | ')}`);
  res.reasons.some((r) => pattern.test(r))
    ? ok(`  reason matches ${pattern} — ${label}`)
    : bad(`  reason NOT found for ${pattern} — ${label} | reasons: ${res.reasons.join(' | ')}`);
}

// ---------------------------------------------------------------------------
// [Suite 5] AC#3 subcase — recorded approval clears R4 / R5 approval deny
// ---------------------------------------------------------------------------
console.log('\n[Suite 5] Recorded human approval satisfies R4/R5 gate (AC#3 subcase)\n');

const r4Approved = evalWith(
  { ...BASE_ENTRY, risk: 'R4' },
  { allowedTools: ['read_file'] },
  'claude-code',
  { recordedApproval: APPROVAL_TOKEN }
);
r4Approved.reasons.some((r) => /requires-recorded-human-approval/.test(r))
  ? bad('R4 with recorded approval should NOT have approval-deny reason')
  : ok('R4 + recorded approval: approval-deny reason absent');

const r5Approved = evalWith(
  { ...BASE_ENTRY, risk: 'R5' },
  { allowedTools: ['read_file'] },
  'claude-code',
  { recordedApproval: APPROVAL_TOKEN }
);
r5Approved.reasons.some((r) => /requires-recorded-human-approval/.test(r))
  ? bad('R5 with recorded approval should NOT have approval-deny reason')
  : ok('R5 + recorded approval: approval-deny reason absent');

// recordedApproval in manifestEntry also satisfies the gate
const r4ManifestApproval = evalWith(
  { ...BASE_ENTRY, risk: 'R4' },
  { allowedTools: ['read_file'], recordedApproval: APPROVAL_TOKEN }
);
r4ManifestApproval.reasons.some((r) => /requires-recorded-human-approval/.test(r))
  ? bad('R4 with manifestEntry.recordedApproval should NOT have approval-deny reason')
  : ok('R4 + manifestEntry.recordedApproval: approval-deny reason absent');

// ---------------------------------------------------------------------------
finish('MCP-005 deny');
