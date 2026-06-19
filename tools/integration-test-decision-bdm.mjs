#!/usr/bin/env node
/**
 * Integration suite — BIZ-0001 / WF-0037 Wave B1 (Decision contracts & registry).
 *
 * Backs Gate G-B1 end-to-end against the shipped SOURCE modules:
 *   1. schema v2 validator accepts the real ADR-0102 + rejects malformed records
 *      + accepts the legacy front-matter shape;
 *   2. decision-registry indexes the live tree (new ADR-0102 + legacy ADRs) and
 *      rebuild is byte-idempotent;
 *   3. all four ADR templates render to schema-v2-valid, deterministic markdown.
 *
 * Zero-dependency, `node:*` only, Windows-safe. Exit 0 = pass, 1 = fail.
 */
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { validateDecision, classifyDecisionFile } from '../templates/contextkit/runtime/work/schema-decision.mjs';
import { readFrontMatter } from '../templates/contextkit/runtime/work/front-matter.mjs';
import { stripBom } from '../templates/contextkit/runtime/work/enums.mjs';
import { buildDecisionRegistry } from '../templates/contextkit/tools/scripts/registry/decision.mjs';
import { serializeRegistry } from '../templates/contextkit/tools/scripts/registry/serialize.mjs';
import { renderDecisionFromTemplate, DECISION_TEMPLATES } from '../templates/contextkit/tools/scripts/decision-template.mjs';

const KIT = dirname(dirname(fileURLToPath(import.meta.url)));
const SOURCE_ROOT = resolve(KIT, 'templates');
let failures = 0;
const ok = (m) => console.log(`  ✓ ${m}`);
const bad = (m) => { console.error(`  ✗ ${m}`); failures += 1; };
const check = (m, cond) => (cond ? ok(m) : bad(m));

console.log('\n🌀 WF-0037 B1 — decision contracts & registry\n');

// 1. schema v2 validator on the real ADR-0102.
const adr0102Path = resolve(KIT, 'contextkit/memory/decisions/business/ADR-0102-business-driven-methodology.md');
try {
  const front = readFrontMatter(stripBom(readFileSync(adr0102Path, 'utf-8')));
  check('ADR-0102 front matter parses (schemaVersion 2)', front.ok && front.data && front.data.schemaVersion === 2);
  check('ADR-0102 validates under schema v2', validateDecision(front.data).ok === true);
} catch {
  bad('ADR-0102 unreadable (live decision tree missing)');
}
check('malformed record rejected', validateDecision({ schemaVersion: 2, id: 'bad' }).ok === false);
check('legacy front-matter shape accepted', validateDecision({
  schemaVersion: 2, id: 'ADR-0001', title: 'x', status: 'legacy', contextType: 'legacy', primaryContext: null,
  decisionKind: 'ARCHITECTURE', decisionScope: 'platform', valueIntents: { primary: 'ENABLE' },
  product: { productId: 'x' }, approvalSource: { type: 'platform', id: 'x', revision: 1, decisionHash: 'h', approvedAt: '2026-01-01', actor: 'human' },
  governs: { workflows: [], operations: [], business: [] }, supersededBy: null,
  createdAt: '2026-01-01', acceptedAt: '2026-01-01', updatedAt: '2026-01-01',
}).ok === true);
check('plain legacy ADR classified legacy', classifyDecisionFile('0099-x.md', '# ADR-0099\n\n- **Status:** Accepted\n').kind === 'legacy');

// 2. decision-registry over the live tree + byte-idempotent rebuild.
try {
  const built = buildDecisionRegistry(KIT);
  check('registry indexes the live tree', built.decisions.length >= 1);
  check('registry has a new ADR (ADR-0102)', built.decisions.some((r) => r.format === 'new' && r.id === 'ADR-0102'));
  check('registry has legacy ADRs', built.decisions.some((r) => r.format === 'legacy'));
  const ids = built.decisions.map((r) => String(r.id));
  check('registry sorted by id', ids.slice().sort().join() === ids.join());
  check('rebuild byte-idempotent', serializeRegistry(buildDecisionRegistry(KIT)) === serializeRegistry(buildDecisionRegistry(KIT)));
} catch (err) {
  bad(`registry build failed: ${err && err.message}`);
}

// 3. all four templates render valid + deterministic.
const FIELDS = {
  ID: 'ADR-0900', TITLE: 'Suite render', STATUS: 'accepted', PRIMARY_CONTEXT_ID: 'contextdevkit',
  DECISION_KIND: 'POLICY', DECISION_SCOPE: 'operation', VALUE_INTENT_PRIMARY: 'ENABLE',
  PRODUCT_ID: 'contextdevkit', PRODUCT_AREA: 'decision-governance', PRODUCT_CAPABILITY: 'adr-templates',
  APPROVAL_ID: 'contextdevkit', APPROVAL_REVISION: 1, DECISION_HASH: 'h', APPROVED_AT: '2026-06-19',
  CREATED_AT: '2026-06-19', ACCEPTED_AT: '2026-06-19', UPDATED_AT: '2026-06-19',
};
for (const kind of Object.keys(DECISION_TEMPLATES)) {
  // business/operation need an agreeing primaryContext id + kind; supply per-kind overrides.
  const fields = { ...FIELDS };
  if (kind === 'business') { fields.PRIMARY_CONTEXT_ID = 'BIZ-0001'; fields.APPROVAL_ID = 'BIZ-0001'; fields.DECISION_KIND = 'BUSINESS_AUTHORIZATION'; }
  if (kind === 'operation') { fields.PRIMARY_CONTEXT_ID = 'OP-0001'; fields.APPROVAL_ID = 'OP-0001'; fields.DECISION_KIND = 'OPERATION_AUTHORIZATION'; }
  const first = renderDecisionFromTemplate({ kind, fields, root: SOURCE_ROOT });
  const valid = first.ok && !/\{\{\w+\}\}/.test(first.text) && validateDecision(readFrontMatter(first.text).data).ok;
  const deterministic = first.text === renderDecisionFromTemplate({ kind, fields, root: SOURCE_ROOT }).text;
  check(`template ${kind}: renders schema-valid + deterministic`, valid && deterministic);
}

console.log(failures === 0 ? '\n✅ B1 decision suite passed.\n' : `\n❌ ${failures} check(s) failed.\n`);
process.exit(failures === 0 ? 0 : 1);
