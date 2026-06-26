/**
 * MCP-005 integration test — Taxonomy sub-suite.
 *
 * Covers:
 *   AC#1 — R0..R5 canonical defaults (label, mode, requiresApproval, blocked)
 *   AC#6 — class-defaults.json projection matches risk-classes.mjs source of truth
 *   AC#2×AC#1 — evaluateServer result.riskClass matches resolved class + host wildcard paths
 *
 * Run:  node tools/integration-test-mcp-005-taxonomy.mjs
 * Exits non-zero on any failure. Zero test-framework dependencies (node:* only).
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { reporter } from './it-helpers.mjs';
import {
  loadModules,
  BASE_ENTRY, BASE_MANIFEST, APPROVAL_TOKEN,
  POLICIES, makeEvalWith,
} from './integration-test-mcp-005-helpers.mjs';

const { ok, bad, finish } = reporter();
const { evaluateServer, CLASS_DEFAULTS, RISK_CLASSES, classDefault,
  isHumanApprovalClass, resolveAutonomy } = await loadModules();
const evalWith = makeEvalWith(evaluateServer, resolveAutonomy);

// ---------------------------------------------------------------------------
// [Suite 1] AC#1 — R0..R5 canonical defaults
// ---------------------------------------------------------------------------
console.log('\n[Suite 1] R0..R5 canonical defaults (AC#1)\n');

const EXPECTED = Object.freeze({
  R0: { label: 'simple-activate',         mode: 'read-only', requiresApproval: false, blocked: false },
  R1: { label: 'allow-in-workspace',      mode: 'read-only', requiresApproval: false, blocked: false },
  R2: { label: 'approval+secrets-by-ref', mode: 'read-only', requiresApproval: false, blocked: false },
  R3: { label: 'guarded',                 mode: 'read-only', requiresApproval: false, blocked: false },
  R4: { label: 'human-approval',          mode: 'read-only', requiresApproval: true,  blocked: false },
  R5: { label: 'blocked-by-default',      mode: 'read-only', requiresApproval: true,  blocked: true  },
});

RISK_CLASSES.length === 6
  ? ok('RISK_CLASSES has exactly 6 members')
  : bad(`RISK_CLASSES length: expected 6, got ${RISK_CLASSES.length}`);

for (const rc of RISK_CLASSES) {
  const def = classDefault(rc);
  def.label === EXPECTED[rc].label
    ? ok(`${rc} label = '${EXPECTED[rc].label}'`)
    : bad(`${rc} label: expected '${EXPECTED[rc].label}', got '${def.label}'`);
  def.mode === 'read-only'
    ? ok(`${rc} default mode = read-only`)
    : bad(`${rc} default mode: expected 'read-only', got '${def.mode}'`);
  def.requiresApproval === EXPECTED[rc].requiresApproval
    ? ok(`${rc} requiresApproval = ${EXPECTED[rc].requiresApproval}`)
    : bad(`${rc} requiresApproval: expected ${EXPECTED[rc].requiresApproval}, got ${def.requiresApproval}`);
  def.blocked === EXPECTED[rc].blocked
    ? ok(`${rc} blocked = ${EXPECTED[rc].blocked}`)
    : bad(`${rc} blocked: expected ${EXPECTED[rc].blocked}, got ${def.blocked}`);
}

// isHumanApprovalClass predicate
isHumanApprovalClass('R4') === true  ? ok('isHumanApprovalClass(R4) = true')  : bad('isHumanApprovalClass(R4) should be true');
isHumanApprovalClass('R5') === true  ? ok('isHumanApprovalClass(R5) = true')  : bad('isHumanApprovalClass(R5) should be true');
isHumanApprovalClass('R3') === false ? ok('isHumanApprovalClass(R3) = false') : bad('isHumanApprovalClass(R3) should be false');
isHumanApprovalClass('R0') === false ? ok('isHumanApprovalClass(R0) = false') : bad('isHumanApprovalClass(R0) should be false');

// Unknown class falls back to R5 defaults (fail-closed, constitution §8)
const r9 = classDefault('R9');
r9.label === CLASS_DEFAULTS.R5.label && r9.blocked === true
  ? ok('classDefault(unknown) falls back to R5 (fail-closed)')
  : bad(`classDefault(R9) did not fall back to R5: ${JSON.stringify(r9)}`);

// ---------------------------------------------------------------------------
// [Suite 2] AC#6 — class-defaults.json matches runtime/mcp/risk-classes.mjs
// ---------------------------------------------------------------------------
console.log('\n[Suite 2] JSON class-defaults.json ↔ risk-classes.mjs sync (AC#6)\n');

const classDefaultsJson = JSON.parse(
  readFileSync(resolve(POLICIES, 'class-defaults.json'), 'utf-8').replace(/^﻿/, '')
);

for (const rc of RISK_CLASSES) {
  const mjs = CLASS_DEFAULTS[rc];
  const json = classDefaultsJson.classes?.[rc];
  json
    ? ok(`class-defaults.json has entry for ${rc}`)
    : bad(`class-defaults.json missing entry for ${rc}`);
  json?.label === mjs.label
    ? ok(`${rc} JSON label matches .mjs: '${mjs.label}'`)
    : bad(`${rc} label mismatch — JSON:'${json?.label}' vs .mjs:'${mjs.label}'`);
  json?.mode === mjs.mode
    ? ok(`${rc} JSON mode matches .mjs: '${mjs.mode}'`)
    : bad(`${rc} mode mismatch — JSON:'${json?.mode}' vs .mjs:'${mjs.mode}'`);
  json?.requiresApproval === mjs.requiresApproval
    ? ok(`${rc} JSON requiresApproval matches .mjs: ${mjs.requiresApproval}`)
    : bad(`${rc} requiresApproval mismatch — JSON:${json?.requiresApproval} vs .mjs:${mjs.requiresApproval}`);
  json?.blocked === mjs.blocked
    ? ok(`${rc} JSON blocked matches .mjs: ${mjs.blocked}`)
    : bad(`${rc} blocked mismatch — JSON:${json?.blocked} vs .mjs:${mjs.blocked}`);
}

// ---------------------------------------------------------------------------
// [Suite 3] AC#2×AC#1 — riskClass output + per-class allow paths + host wildcards
// ---------------------------------------------------------------------------
console.log('\n[Suite 3] riskClass output + per-class allow paths (AC#2 × AC#1)\n');

const APPROVAL = { recordedApproval: APPROVAL_TOKEN };

for (const rc of RISK_CLASSES) {
  const entry = { ...BASE_ENTRY, risk: rc };
  const opts = isHumanApprovalClass(rc) ? APPROVAL : {};
  const res = evalWith(entry, BASE_MANIFEST, 'claude-code', opts);
  res.riskClass === rc
    ? ok(`evaluateServer result.riskClass = '${rc}' for ${rc} entry`)
    : bad(`riskClass for ${rc} entry: expected '${rc}', got '${res.riskClass}'`);
}

// Wildcard host (*) in entry.allowedHosts allows any host
const wildcardAllowed = evalWith(BASE_ENTRY, BASE_MANIFEST, 'some-unknown-host', {
  allowedHosts: ['*'],
});
wildcardAllowed.reasons.some((r) => /host:not-in-allowedHosts/.test(r))
  ? bad('wildcard allowedHosts should allow any host')
  : ok('wildcard allowedHosts (*) permits any host');

// Wildcard from options beats the per-server entry restriction
const restrictedEntry = { ...BASE_ENTRY, allowedHosts: ['claude-code'] };
const wildcardOpts = evalWith(restrictedEntry, BASE_MANIFEST, 'cursor', {
  allowedHosts: ['*'],
});
wildcardOpts.reasons.some((r) => /host:not-in-allowedHosts/.test(r))
  ? bad('wildcard in options.allowedHosts should permit any host')
  : ok('options.allowedHosts = [*] overrides entry restriction for any host');

// Empty allowedHosts defaults to wildcard (permissive default in policy)
const emptyHostsOpts = evalWith(BASE_ENTRY, BASE_MANIFEST, 'cursor', {
  allowedHosts: [],
});
emptyHostsOpts.reasons.some((r) => /host:not-in-allowedHosts/.test(r))
  ? bad('empty options.allowedHosts should fall back to wildcard (* = allow all)')
  : ok('empty options.allowedHosts falls back to wildcard (allow all hosts)');

// ---------------------------------------------------------------------------
finish('MCP-005 taxonomy');
