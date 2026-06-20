#!/usr/bin/env node
/**
 * Self-check — STATIC wiring for the BIZ-0001 / WF-0036 Wave A1 runtime modules.
 *
 * Backs Gate G-A1's "wired into the harness" requirement: it asserts the kit's
 * structural contracts around the A1 surface WITHOUT exercising end-to-end
 * behaviour (that lives in `tools/integration-test-workflow-bdm.mjs`). Concretely:
 *   1. `paths.mjs` exposes every new methodology root the A1 modules resolve.
 *   2. The new runtime/work + tools/scripts (work* + registry/*) import cleanly
 *      and export their documented API.
 *   3. No new A1 source file breaches the constitution's hard 308-line ceiling.
 *   4. No new RUNTIME module hardcodes the platform-folder literal (immutable
 *      rule 4) — the folder name must live only in `PLATFORM_DIR`.
 *
 * Wave A2 (BIZ-0001/WF-0036, ADR-0102) extends this with the methodology layer's
 * static wiring: the classifier + matcher + proposal-store + methodology modules
 * import cleanly and export their documented API, `paths.mjs` exposes the new
 * `workClassification` key, the `policy/work-classification.json` data file ships,
 * and no A2 source file breaches the 308-line ceiling (immutable rule 3). The
 * behavioural end-to-end lives in `tools/integration-test-classify-bdm.mjs`.
 *
 * Standalone runnable: node tools/selfcheck-bdm.mjs
 * Exit 0 on all-pass, exit 1 on any failure. Zero runtime deps — node:* only.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const KIT = dirname(dirname(fileURLToPath(import.meta.url)));
const RUNTIME = resolve(KIT, 'templates/contextkit/runtime');
const SCRIPTS = resolve(KIT, 'templates/contextkit/tools/scripts');
const EXEC = resolve(RUNTIME, 'execution');

let failures = 0;
const ok = (msg) => console.log(`  ✓ ${msg}`);
const bad = (msg) => { console.error(`  ✗ ${msg}`); failures += 1; };
const urlFor = (abs) => pathToFileURL(abs).href;

/** Absolute path of every A1 source file, grouped for line-budget + import checks. */
const RUNTIME_FILES = [
  'work/enums.mjs', 'work/schema-business.mjs', 'work/schema-operation.mjs',
].map((rel) => ({ rel, abs: resolve(RUNTIME, rel) }));

const SCRIPT_FILES = [
  'work.mjs', 'work-io.mjs', 'work-operation.mjs', 'work-render.mjs', 'work-templates.mjs',
  'registry/serialize.mjs', 'registry/ids.mjs', 'registry/work-context.mjs', 'registry/workflow.mjs',
  // A3 (WF-0036) — Business lifecycle & Growth source modules.
  'business-growth-validator.mjs', 'business-render.mjs', 'business-templates.mjs',
  'business-template-strings.mjs', 'work-business-lifecycle.mjs', 'work-business-gate.mjs',
  'work-business-dispatch.mjs', 'work-decision-hash.mjs',
  // A4 (WF-0036) — workflow nesting & migration planning.
  'migration-plan.mjs',
  // B3 (WF-0037) — lifecycle integration: mirroring/supersession/coverage.
  'work-decision-mirror.mjs', 'work-decision-supersede.mjs', 'work-decision-ownership.mjs',
  'decision-coverage.mjs',
  // A5 (WF-0036) — intelligence & outcomes: forecast adapter + recurrence/outcomes.
  'economics/investment-forecast-core.mjs', 'economics/investment-forecast.mjs',
  'operation-recurrence-core.mjs', 'operation-recurrence.mjs',
  // B4 (WF-0037) — legacy ADR tooling: indexing, migration, anti-redundancy.
  'adr-index.mjs', 'adr-migrate.mjs', 'adr-migrate-core.mjs', 'adr-redundancy.mjs', 'adr-redundancy-core.mjs',
  // B5 (WF-0037) — program-governance validator.
  'program-governance.mjs',
].map((rel) => ({ rel, abs: resolve(SCRIPTS, rel) }));

const ALL_FILES = [...RUNTIME_FILES, ...SCRIPT_FILES];

// ---------------------------------------------------------------------------
// 1. paths.mjs exposes the new methodology roots.
// ---------------------------------------------------------------------------
console.log('\n[A1] paths.mjs — new methodology roots exposed\n');
try {
  const paths = await import(urlFor(resolve(RUNTIME, 'config/paths.mjs')));
  const resolved = paths.pathsFor('/tmp/bdm-probe');
  const requiredKeys = [
    'business', 'operations',
    'decisionsBusiness', 'decisionsOperations', 'decisionsLegacy',
    'workContextRegistry', 'workflowRegistry', 'decisionRegistry',
  ];
  for (const key of requiredKeys) {
    typeof resolved[key] === 'string' && resolved[key].length > 0
      ? ok(`pathsFor() exposes "${key}"`)
      : bad(`pathsFor() missing/empty root "${key}"`);
  }
  // Roots must be anchored under the methodology memory tree, not invented.
  resolved.business.includes('memory') && resolved.business.endsWith('business')
    ? ok('business root anchored under memory/')
    : bad(`business root not under memory/: ${resolved.business}`);
  resolved.decisionsLegacy.includes('decisions')
    ? ok('decisionsLegacy nested under decisions/')
    : bad(`decisionsLegacy not under decisions/: ${resolved.decisionsLegacy}`);
} catch (err) {
  bad(`paths.mjs probe threw: ${err?.message ?? err}`);
}

// ---------------------------------------------------------------------------
// 2. Every A1 module imports cleanly + exports its documented API.
// ---------------------------------------------------------------------------
console.log('\n[A1] modules import + export the documented API\n');

/** Imports `abs` and asserts every name in `names` is exported. */
async function assertExports(abs, label, names) {
  try {
    const mod = await import(urlFor(abs));
    const missing = names.filter((name) => mod[name] === undefined);
    missing.length === 0
      ? ok(`${label}: exports ${names.join(', ')}`)
      : bad(`${label}: missing export(s) ${missing.join(', ')}`);
    return mod;
  } catch (err) {
    bad(`${label}: import threw — ${err?.message ?? err}`);
    return null;
  }
}

await assertExports(resolve(RUNTIME, 'work/enums.mjs'), 'work/enums',
  ['VALUE_INTENTS', 'RELATION_TYPES', 'EXECUTION_MODES', 'isNonEmptyString', 'stripBom']);
await assertExports(resolve(RUNTIME, 'work/schema-business.mjs'), 'work/schema-business',
  ['BUSINESS_SCHEMA_VERSION', 'BUSINESS_ID_PATTERN', 'validateBusiness', 'checkValueIntents', 'checkRelations']);
await assertExports(resolve(RUNTIME, 'work/schema-operation.mjs'), 'work/schema-operation',
  ['OPERATION_SCHEMA_VERSION', 'OPERATION_ID_PATTERN', 'validateOperation']);

await assertExports(resolve(SCRIPTS, 'work.mjs'), 'work', ['dispatch']);
await assertExports(resolve(SCRIPTS, 'work-io.mjs'), 'work-io',
  ['parseArgs', 'resolvePosture', 'slugify', 'writeFileEnsured', 'makeReceipt', 'formatReceipt',
    'writeFileAtomicSync', 'updateManagedBlock', 'readManagedBlock', 'writeIfChanged']);
await assertExports(resolve(SCRIPTS, 'work-operation.mjs'), 'work-operation',
  ['resolveCreateInputs', 'planOperationPackage', 'runOperationCreate']);
await assertExports(resolve(SCRIPTS, 'work-render.mjs'), 'work-render',
  ['renderOperationTasks', 'renderTasksFile', 'operationTasksMarkers']);
await assertExports(resolve(SCRIPTS, 'work-templates.mjs'), 'work-templates',
  ['OPERATION_TASKS_BLOCK', 'buildOperationJson', 'buildReasonMd', 'buildTasksMd']);

await assertExports(resolve(SCRIPTS, 'registry/serialize.mjs'), 'registry/serialize',
  ['sortKeysDeep', 'serializeRegistry']);
await assertExports(resolve(SCRIPTS, 'registry/ids.mjs'), 'registry/ids',
  ['nextBusinessId', 'nextOperationId', 'nextWorkflowNumber', 'workflowRoots']);
await assertExports(resolve(SCRIPTS, 'registry/work-context.mjs'), 'registry/work-context',
  ['WORK_CONTEXT_REGISTRY_VERSION', 'buildWorkContextRegistry', 'writeWorkContextRegistry']);
await assertExports(resolve(SCRIPTS, 'registry/workflow.mjs'), 'registry/workflow',
  ['WORKFLOW_REGISTRY_VERSION', 'buildWorkflowRegistry', 'resolveWorkflow', 'writeWorkflowRegistry']);

// ---------------------------------------------------------------------------
// 3. Line-budget — no A1 file breaches the hard 308-line ceiling.
// ---------------------------------------------------------------------------
console.log('\n[A1] line budget — no file over the 308 hard ceiling\n');
const HARD_CEILING = 308;
for (const { rel, abs } of ALL_FILES) {
  let lines = 0;
  try { lines = readFileSync(abs, 'utf-8').split('\n').length; } catch (err) { bad(`${rel}: unreadable — ${err?.message ?? err}`); continue; }
  lines <= HARD_CEILING
    ? ok(`${rel}: ${lines} ≤ ${HARD_CEILING}`)
    : bad(`${rel}: ${lines} lines — over the ${HARD_CEILING} hard ceiling`);
}

// ---------------------------------------------------------------------------
// 4. No hardcoded platform-folder literal in the new RUNTIME modules
//    (immutable rule 4 — the folder name lives only in PLATFORM_DIR).
// ---------------------------------------------------------------------------
console.log('\n[A1] portability — no hardcoded platform-folder literal in runtime\n');
const LITERAL = /['"`][^'"`]*contextkit\//;
for (const { rel, abs } of RUNTIME_FILES) {
  let body = '';
  try { body = readFileSync(abs, 'utf-8'); } catch { bad(`${rel}: unreadable`); continue; }
  LITERAL.test(body)
    ? bad(`${rel}: hardcodes a "contextkit/" path literal (use PLATFORM_DIR / pathsFor)`)
    : ok(`${rel}: no hardcoded platform-folder literal`);
}

// ---------------------------------------------------------------------------
// 5. [A2] methodology layer — modules import + export the documented API.
// ---------------------------------------------------------------------------
console.log('\n[A2] methodology modules import + export the documented API\n');

await assertExports(resolve(EXEC, 'work-classify-signals.mjs'), 'work-classify-signals',
  ['scoreCategory', 'scoreTable', 'pickWinner', 'pickSecondary', 'tokenize', 'STOPWORDS']);
await assertExports(resolve(EXEC, 'work-classifier.mjs'), 'work-classifier',
  ['classifyWork', 'loadWorkPolicy', 'DEFAULT_WORK_CLASSIFICATION']);
await assertExports(resolve(EXEC, 'business-matcher.mjs'), 'business-matcher',
  ['matchBusiness']);
await assertExports(resolve(EXEC, 'intake-proposal-store.mjs'), 'intake-proposal-store',
  ['buildIntakeProposal', 'saveIntakeProposal', 'readIntakeProposal', 'proposalsDir', 'proposalPath',
    'INTAKE_PROPOSAL_VERSION', 'PROPOSAL_STATUSES']);
await assertExports(resolve(EXEC, 'intake-methodology.mjs'), 'intake-methodology',
  ['resolveProposedAction', 'renderMethodologyLine', 'runMethodology']);

// ---------------------------------------------------------------------------
// 6. [A2] paths.mjs exposes the new policy key + the policy data file ships.
// ---------------------------------------------------------------------------
console.log('\n[A2] paths.workClassification + policy data file present\n');
try {
  const paths = await import(urlFor(resolve(RUNTIME, 'config/paths.mjs')));
  const path = paths.pathsFor('/tmp/bdm-probe').workClassification;
  typeof path === 'string' && path.replaceAll('\\', '/').endsWith('policy/work-classification.json')
    ? ok('pathsFor() exposes "workClassification"')
    : bad(`pathsFor() missing/odd workClassification key: ${path}`);
} catch (err) {
  bad(`paths.mjs A2 probe threw: ${err?.message ?? err}`);
}
const POLICY_FILE = resolve(KIT, 'templates/contextkit/policy/work-classification.json');
if (existsSync(POLICY_FILE)) {
  try {
    const parsed = JSON.parse(readFileSync(POLICY_FILE, 'utf-8').replace(/^﻿/, ''));
    parsed && parsed.nature && parsed.valueIntent && parsed.businessMatch
      ? ok('policy/work-classification.json parses with the required sections')
      : bad('policy/work-classification.json missing required sections');
  } catch (err) {
    bad(`policy/work-classification.json is not valid JSON: ${err?.message ?? err}`);
  }
} else {
  bad('policy/work-classification.json is missing from the template tree');
}

// ---------------------------------------------------------------------------
// 7. [A2] line budget — no methodology source file breaches the 308 ceiling.
// ---------------------------------------------------------------------------
console.log('\n[A2] line budget — no methodology file over the 308 hard ceiling\n');
const A2_FILES = [
  'work-classify-signals.mjs', 'work-classifier.mjs', 'business-matcher.mjs',
  'intake-proposal-store.mjs', 'intake-methodology.mjs',
].map((rel) => ({ rel, abs: resolve(EXEC, rel) }));
for (const { rel, abs } of A2_FILES) {
  let lines = 0;
  try { lines = readFileSync(abs, 'utf-8').split('\n').length; } catch (err) { bad(`${rel}: unreadable — ${err?.message ?? err}`); continue; }
  lines <= HARD_CEILING ? ok(`${rel}: ${lines} ≤ ${HARD_CEILING}`) : bad(`${rel}: ${lines} lines — over the ${HARD_CEILING} hard ceiling`);
}

// ---------------------------------------------------------------------------
// 8. [B2] line budget — decision-intelligence source files (WF-0037 Wave B2).
// ---------------------------------------------------------------------------
console.log('\n[B2] line budget — no decision-intelligence file over the 308 hard ceiling\n');
const B2_FILES = [
  { rel: 'execution/decision-need-classifier.mjs', abs: resolve(RUNTIME, 'execution/decision-need-classifier.mjs') },
  { rel: 'execution/materiality-score.mjs', abs: resolve(RUNTIME, 'execution/materiality-score.mjs') },
  { rel: 'execution/decision-triple.mjs', abs: resolve(RUNTIME, 'execution/decision-triple.mjs') },
  { rel: 'execution/decision-routine-coverage.mjs', abs: resolve(RUNTIME, 'execution/decision-routine-coverage.mjs') },
  { rel: 'scripts/decision-search-match.mjs', abs: resolve(SCRIPTS, 'decision-search-match.mjs') },
  { rel: 'scripts/decision-search-score.mjs', abs: resolve(SCRIPTS, 'decision-search-score.mjs') },
];
for (const { rel, abs } of B2_FILES) {
  let lines = 0;
  try { lines = readFileSync(abs, 'utf-8').split('\n').length; } catch (err) { bad(`${rel}: unreadable — ${err?.message ?? err}`); continue; }
  lines <= HARD_CEILING ? ok(`${rel}: ${lines} ≤ ${HARD_CEILING}`) : bad(`${rel}: ${lines} lines — over the ${HARD_CEILING} hard ceiling`);
}

// ---------------------------------------------------------------------------
console.log(
  failures === 0
    ? '\n  PASS — A1+A2+B2 (BIZ-0001/WF-0036+WF-0037) static self-check: all checks passed.\n'
    : `\n  FAIL — A1+A2+B2 static self-check: ${failures} check(s) failed.\n`,
);
process.exit(failures === 0 ? 0 : 1);
