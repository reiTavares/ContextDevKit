#!/usr/bin/env node
/**
 * Self-test for blast-radius.mjs (GC1-T1, WF-0071/BIZ-0004) -- standalone
 * entrypoint (exit 0/1), sibling-dispatched like selfcheck-projmap-signals.mjs.
 *
 * Asserts: (1) reverseConsumers gives the correct transitive, sorted set on a
 * fixture chain; (2) blastRadiusFor degrades to available:false (never a
 * fabricated empty consumers:[] counted as pass) when no manifest exists;
 * (3) output is deterministic across repeated calls; (4) the zero-dependency
 * invariant on blast-radius.mjs own source (only node:* + the two relative
 * siblings -- no third-party import creeps onto the hot path).
 */
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dir = dirname(fileURLToPath(import.meta.url));
const KIT = resolve(__dir, '..');
const SCRIPTS = 'templates/contextkit/tools/scripts';
const blastRadiusPath = resolve(KIT, SCRIPTS + '/blast-radius.mjs');
const signalsPath = resolve(KIT, SCRIPTS + '/project-map-signals.mjs');

/**
 * Runs every blast-radius assertion and returns the result set.
 *
 * @returns {Promise<Array<{name:string, pass:boolean, detail:string}>>}
 */
export async function runBlastRadiusChecks() {
  const results = [];
  const record = (name, pass, detail) => results.push({ name, pass, detail });

  let reverseConsumers, blastRadiusFor;
  try {
    ({ reverseConsumers } = await import(pathToFileURL(signalsPath).href));
    ({ blastRadiusFor } = await import(pathToFileURL(blastRadiusPath).href));
  } catch (err) {
    record('module import', false, 'failed to import blast-radius/project-map-signals: ' + (err?.message ?? err));
    return results;
  }
  record('module import', true, 'reverseConsumers and blastRadiusFor imported');

  // 1. reverseConsumers -- transitive, sorted, cycle-safe chain a->b->c.
  const chain = [{ path: 'a', deps: ['b'] }, { path: 'b', deps: ['c'] }, { path: 'c', deps: [] }];
  const chainResult = reverseConsumers(chain, 'c');
  const chainOk = JSON.stringify(chainResult.consumers) === JSON.stringify(['a', 'b'])
    && chainResult.evidenceClass === 'GRAPH_DERIVED';
  record('reverseConsumers transitive+sorted', chainOk,
    chainOk ? 'consumers of c: [a, b]' : 'got ' + JSON.stringify(chainResult));

  // 2. blastRadiusFor degradation -- no manifest on disk must NEVER fabricate
  //    an empty available:true result (the whole point of the contract).
  const emptyRoot = resolve(tmpdir(), 'blast-radius-selfcheck-no-manifest-' + process.pid);
  const degraded = blastRadiusFor(emptyRoot, 'c');
  const degradedOk = degraded.available === false
    && typeof degraded.reason === 'string' && degraded.reason.length > 0
    && degraded.evidenceClass === 'GRAPH_DERIVED'
    && !('consumers' in degraded);
  record('blastRadiusFor degrades (no fabricated empty set)', degradedOk, JSON.stringify(degraded));

  // 3. Determinism -- two calls on the same fixture must be deeply equal.
  const first = reverseConsumers(chain, 'c').consumers;
  const second = reverseConsumers(chain, 'c').consumers;
  const deterministic = JSON.stringify(first) === JSON.stringify(second);
  record('deterministic output across calls', deterministic, JSON.stringify({ first, second }));

  // 4. Zero-dependency invariant on blast-radius.mjs's own source.
  const source = readFileSync(blastRadiusPath, 'utf-8');
  const importRe = /^import\s+(?:[^"'`]*\s+)?from\s+["'`]([^"'`]+)["'`]/gm;
  const violations = [];
  let match;
  while ((match = importRe.exec(source)) !== null) {
    const specifier = match[1];
    if (!specifier.startsWith('node:') && !specifier.startsWith('.')) violations.push(specifier);
  }
  record('zero-dep invariant (node:* + relative siblings only)', violations.length === 0,
    violations.length === 0 ? 'no third-party imports' : 'violations: ' + violations.join(', '));

  return results;
}

if (process.argv[1]?.endsWith('selfcheck-blast-radius.mjs')) {
  const results = await runBlastRadiusChecks();
  let failCount = 0;
  for (const r of results) {
    console.log((r.pass ? '  ok ' : '  XX ') + r.name + ' -- ' + r.detail);
    if (!r.pass) failCount += 1;
  }
  console.log('\n' + results.length + ' checks -- ' + (results.length - failCount) + ' pass / ' + failCount + ' fail');
  console.log(failCount > 0 ? '\nFAIL' : '\nPASS');
  process.exit(failCount > 0 ? 1 : 0);
}
