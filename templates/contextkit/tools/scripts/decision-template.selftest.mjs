/**
 * In-process self-test for the ADR template renderer (WF-0037, B1-T3).
 *
 * Zero-dependency, runs under plain `node`. Proves the acceptance criteria:
 *   (a) the business + operation + routine (+ emergency) templates render to a
 *       v2-schema-VALID ADR (validated by B1-T1's validateDecision);
 *   (b) render is byte-identical across two runs (deterministic);
 *   (c) the rendered output contains no leftover `{{ }}` tokens.
 *
 * Renders from the SOURCE templates dir (cwd = repo root) and writes nothing.
 * Exit 0 = all assertions held; exit 1 = a failure.
 */
import { resolve } from 'node:path';
import { renderDecisionFromTemplate, DECISION_TEMPLATES } from './decision-template.mjs';
import { readFrontMatter } from '../../runtime/work/front-matter.mjs';
import { validateDecision } from '../../runtime/work/schema-decision.mjs';

// The shipped templates live in the SOURCE tree at templates/contextkit/...; point
// the renderer's root there so pathsFor(root).decisions/_templates resolves to them.
// (In an installed project they ship to contextkit/memory/decisions/_templates via B4.)
const SOURCE_ROOT = resolve(process.cwd(), 'templates');

const failures = [];
/** Records a named assertion. @param {string} label @param {boolean} cond */
function assert(label, cond) {
  process.stdout.write(`  ${cond ? 'ok  ' : 'FAIL'} ${label}\n`);
  if (!cond) failures.push(label);
}

/** Field map per template kind — sample values that yield a valid v2 record. */
function fieldsFor(kind) {
  const base = {
    ID: 'ADR-0900',
    TITLE: 'Template render self-test',
    STATUS: 'accepted',
    PRIMARY_CONTEXT_ID: kind === 'business' ? 'BIZ-0001' : kind === 'operation' ? 'OP-0001' : 'contextdevkit',
    DECISION_KIND: kind === 'business' ? 'BUSINESS_AUTHORIZATION' : kind === 'operation' ? 'OPERATION_AUTHORIZATION' : 'POLICY',
    DECISION_SCOPE: 'operation',
    VALUE_INTENT_PRIMARY: 'ENABLE',
    PRODUCT_ID: 'contextdevkit',
    PRODUCT_AREA: 'decision-governance',
    PRODUCT_CAPABILITY: 'adr-templates',
    APPROVAL_ID: kind === 'business' ? 'BIZ-0001' : kind === 'operation' ? 'OP-0001' : 'contextdevkit',
    APPROVAL_REVISION: 1,
    DECISION_HASH: 'selftesthash',
    APPROVED_AT: '2026-06-19',
    CREATED_AT: '2026-06-19',
    ACCEPTED_AT: '2026-06-19',
    UPDATED_AT: '2026-06-19',
  };
  return base;
}

for (const kind of Object.keys(DECISION_TEMPLATES)) {
  const first = renderDecisionFromTemplate({ kind, fields: fieldsFor(kind), root: SOURCE_ROOT });
  assert(`${kind}: render ok (no missing tokens)`, first.ok && first.missing.length === 0);
  assert(`${kind}: no leftover {{ }} tokens`, !/\{\{\w+\}\}/.test(first.text));
  const parsed = readFrontMatter(first.text);
  assert(`${kind}: front matter parses`, parsed.ok && parsed.hasFrontMatter);
  const verdict = validateDecision(parsed.data);
  assert(`${kind}: rendered ADR is schema-v2-valid`, verdict.ok === true);
  if (!verdict.ok) process.stdout.write(`       errors: ${verdict.errors.join('; ')}\n`);
  const second = renderDecisionFromTemplate({ kind, fields: fieldsFor(kind), root: SOURCE_ROOT });
  assert(`${kind}: deterministic (byte-identical re-render)`, first.text === second.text);
}

// dry-run by default: a render with no apply reports applied:false and writes nothing.
const dry = renderDecisionFromTemplate({ kind: 'business', fields: fieldsFor('business'), root: SOURCE_ROOT });
assert('dry-run by default (applied:false)', dry.applied === false);
// missing token → refuse (ok:false), no write.
const partial = renderDecisionFromTemplate({ kind: 'business', fields: { ID: 'ADR-0901' }, root: SOURCE_ROOT });
assert('missing tokens refuse (ok:false)', partial.ok === false && partial.missing.length > 0);

process.stdout.write(failures.length ? `\nFAILED (${failures.length})\n` : '\nPASSED\n');
process.exit(failures.length ? 1 : 0);
