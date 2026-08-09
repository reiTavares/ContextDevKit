#!/usr/bin/env node
/** Canonical v4 lineage advisory-rule self-check. */
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';

const directory = dirname(fileURLToPath(import.meta.url));
const kitRoot = resolve(directory, '..');
const corePath = resolve(kitRoot, 'templates/contextkit/tools/scripts/lineage-rules-core.mjs');
const cliPath = resolve(kitRoot, 'templates/contextkit/tools/scripts/lineage-rules.mjs');
const { DEFAULT_RULES, evaluateRules } = await import(pathToFileURL(corePath).href);

let failures = 0;
const check = (condition, message) => {
  if (condition) console.log(`  ✓ ${message}`);
  else { console.error(`  ✗ ${message}`); failures += 1; }
};

const graph = {
  nodes: [
    { id: 'adr:0001', type: 'adr', ref: { status: 'Accepted' } },
    { id: 'wf:alpha', type: 'workflow', ref: { id: 'WF-0001', slug: 'alpha' } },
    { id: 'card:DONE', type: 'card', ref: { id: 'DONE', scopeRef: 'WF-0001', status: 'done', evidenceRefs: [], reportRefs: [] } },
    { id: 'card:ORPHAN', type: 'card', ref: { id: 'ORPHAN', scopeRef: 'WF-0002', status: 'working', evidenceRefs: [], reportRefs: [] } },
  ],
  edges: [{ from: 'wf:alpha', to: 'card:DONE', rel: 'ships', confidence: 'direct' }],
};
const verdict = evaluateRules(graph, DEFAULT_RULES);
const byId = Object.fromEntries(verdict.results.map((result) => [result.id, result]));
check(byId.R1.status === 'fail' && byId.R1.offenders.includes('adr:0001'), 'R1 finds accepted ADR without workflow link');
check(byId.R2.status === 'fail' && byId.R2.offenders.includes('card:DONE'), 'R2 finds done task without evidence refs');
check(byId.R3.status === 'fail' && byId.R3.offenders.includes('card:ORPHAN'), 'R3 finds workflow task without ships edge');
check(byId.R4.status === 'pass', 'R4 accepts workflow with a task');

const evidencedGraph = {
  nodes: [{
    id: 'card:DONE', type: 'card',
    ref: { id: 'DONE', scopeRef: 'WF-0001', status: 'done', evidenceRefs: ['reports/qa.md'], reportRefs: [] },
  }],
  edges: [],
};
const evidencedR2 = evaluateRules(evidencedGraph, DEFAULT_RULES).results.find((result) => result.id === 'R2');
check(evidencedR2.status === 'pass', 'R2 accepts factual evidenceRefs in canonical task');

const emptyVerdict = evaluateRules({ nodes: [], edges: [] }, DEFAULT_RULES);
check(emptyVerdict.results.every((result) => result.status === 'skipped'), 'missing source data is skipped, never passed');
check(verdict.summary.pass + verdict.summary.fail + verdict.summary.skipped === DEFAULT_RULES.length,
  'rule summary accounts for every rule');

const cli = spawnSync(process.execPath, [cliPath, '--json'], { cwd: kitRoot, encoding: 'utf8', timeout: 30_000 });
check(cli.status === 0, 'lineage rules CLI exits zero');
try {
  const parsed = JSON.parse(cli.stdout);
  check(Array.isArray(parsed.results) && typeof parsed.summary === 'object', 'lineage rules CLI emits JSON');
} catch (error) {
  check(false, `lineage rules CLI JSON parse failed: ${error.message}`);
}

console.log(failures === 0 ? '\n  PASS — canonical v4 lineage rules\n' : `\n  FAIL — lineage rules: ${failures}\n`);
process.exit(failures === 0 ? 0 : 1);
