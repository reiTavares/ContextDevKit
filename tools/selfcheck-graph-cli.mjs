#!/usr/bin/env node
/**
 * Self-test for graph.mjs CLI dispatch (IF2, WF-0072/BIZ-0004) — standalone
 * entrypoint (exit 0/1), sibling-dispatched like the other WF-0072 selfchecks.
 *
 * Asserts the dispatcher routes each subcommand to the right query over a real
 * fixture projection, throws on an unknown subcommand / missing arg, and (via a
 * real child-process run) returns exit 3 when the graph is absent, exit 2 on a
 * usage error, exit 0 on a resolved query.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dir = dirname(fileURLToPath(import.meta.url));
const KIT = resolve(__dir, '..');
const cliPath = resolve(KIT, 'templates/contextkit/tools/scripts/graph.mjs');

function fixtureRoot() {
  const root = mkdtempSync(join(tmpdir(), 'graph-cli-'));
  const dir = join(root, 'contextkit', 'memory', 'project-map', 'graph');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'graph.json'), JSON.stringify({
    schemaVersion: 1, graphSignature: 'sig',
    nodes: [{ id: 'sym:a#t' }, { id: 'sym:b#c' }],
    edges: [{ source: 'sym:b#c', target: 'sym:a#t', relation: 'calls' }],
  }) + '\n', 'utf-8');
  return root;
}

/** Runs the CLI as a child process in `cwd`; returns {code, stdout}. */
function runCli(cwd, argv) {
  try {
    const stdout = execFileSync('node', [cliPath, ...argv], { cwd, encoding: 'utf-8' });
    return { code: 0, stdout };
  } catch (err) {
    return { code: err.status ?? 1, stdout: err.stdout ? String(err.stdout) : '' };
  }
}

export async function runGraphCliChecks() {
  const results = [];
  const record = (name, pass, detail) => results.push({ name, pass, detail });

  let m;
  try { m = await import(pathToFileURL(cliPath).href); } catch (err) {
    record('module import', false, 'failed: ' + (err?.message ?? err));
    return results;
  }
  record('module import', true, 'graph CLI imported');

  const root = fixtureRoot();
  try {
    const callers = m.dispatch(root, 'callers', { flags: {}, positionals: ['sym:a#t'] });
    record('dispatch callers routes to reverseCallers', callers.available && JSON.stringify(callers.callers) === JSON.stringify(['sym:b#c']),
      JSON.stringify(callers.callers));

    const impact = m.dispatch(root, 'impact', { flags: {}, positionals: ['sym:a#t'] });
    record('dispatch impact returns blastRadius', impact.available && impact.blastRadius === 1, 'blast=' + impact.blastRadius);

    let threwUnknown = false;
    try { m.dispatch(root, 'nope', { flags: {}, positionals: [] }); } catch { threwUnknown = true; }
    record('dispatch throws on unknown subcommand', threwUnknown, threwUnknown ? 'threw' : 'did not throw');

    let threwMissing = false;
    try { m.dispatch(root, 'callers', { flags: {}, positionals: [] }); } catch { threwMissing = true; }
    record('dispatch throws on missing required arg', threwMissing, threwMissing ? 'threw' : 'did not throw');

    // Real child-process exit codes.
    const okRun = runCli(root, ['callers', 'sym:a#t']);
    record('CLI exit 0 on a resolved query', okRun.code === 0 && okRun.stdout.includes('sym:b#c'), 'code=' + okRun.code);

    const usageRun = runCli(root, []);
    record('CLI exit 2 on usage error (no subcommand)', usageRun.code === 2, 'code=' + usageRun.code);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }

  const empty = mkdtempSync(join(tmpdir(), 'graph-cli-empty-'));
  try {
    const absentRun = runCli(empty, ['callers', 'sym:x#f']);
    record('CLI exit 3 when graph absent (distinct from usage error)', absentRun.code === 3 && absentRun.stdout.includes('available'),
      'code=' + absentRun.code);
  } finally {
    rmSync(empty, { recursive: true, force: true });
  }

  const source = readFileSync(cliPath, 'utf-8');
  const bad = source.split(String.fromCharCode(10))
    .filter((l) => l.trim().indexOf('import ') === 0 && l.indexOf(' from ') !== -1)
    .map((l) => { const a = l.lastIndexOf('from '); const rest = l.slice(a + 5).trim(); return rest.slice(1, rest.indexOf(rest[0], 1)); })
    .filter((s) => s.indexOf('node:') !== 0 && s.charAt(0) !== '.');
  record('zero-dep invariant (node:* + relative siblings only)', bad.length === 0, bad.length === 0 ? 'clean' : bad.join(', '));

  return results;
}

if (process.argv[1]?.endsWith('selfcheck-graph-cli.mjs')) {
  const results = await runGraphCliChecks();
  let failCount = 0;
  for (const r of results) {
    console.log((r.pass ? '  ok ' : '  XX ') + r.name + ' -- ' + r.detail);
    if (!r.pass) failCount += 1;
  }
  console.log();
  console.log(results.length + ' checks -- ' + (results.length - failCount) + ' pass / ' + failCount + ' fail');
  console.log();
  console.log(failCount > 0 ? 'FAIL' : 'PASS');
  process.exit(failCount > 0 ? 1 : 0);
}
