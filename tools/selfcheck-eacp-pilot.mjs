/**
 * Self-check — benchmark-pilot evidence surface (economics/benchmark-pilot.mjs).
 *
 * Asserts the pilot-evidence reader/renderer is honest: absent file → ''; a valid
 * record → a line that ALWAYS says "claim: null" and labels n/reps (a pilot point
 * estimate can never read as a powered claim); invalid multiplier → ''; schema
 * version; zero-dep invariant.
 *
 * Zero runtime dependencies — node:* only.
 */
import { readFile } from 'node:fs/promises';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';

/** @private — verifies a module imports only node:* / relative specifiers. */
async function checkModuleZeroDep(modPath) {
  let content = '';
  try { content = await readFile(modPath, 'utf-8'); }
  catch (err) { return { error: `could not read: ${err?.message ?? err}` }; }
  const importRegex = /^import\s+(?:[^"'`]*\s+)?from\s+['"`]([^'"`]+)['"`]/gm;
  let match;
  while ((match = importRegex.exec(content)) !== null) {
    const spec = match[1];
    if (!spec.startsWith('.') && !spec.startsWith('node:')) return { error: `imports from "${spec}"` };
  }
  return { error: null };
}

/** Writes a benchmark-pilot.json into a fresh temp root; returns the root. */
function fixtureRoot(record) {
  const root = mkdtempSync(join(tmpdir(), 'pilot-'));
  mkdirSync(join(root, 'contextkit', 'memory'), { recursive: true });
  writeFileSync(join(root, 'contextkit', 'memory', 'benchmark-pilot.json'), JSON.stringify(record));
  return root;
}

/**
 * Runs the benchmark-pilot evidence-surface self-checks.
 * @param {{ ok: (m: string) => void, bad: (m: string) => void }} reporter
 * @param {{ KIT: string }} ctx - repo root
 */
export async function runEacpPilotChecks({ ok, bad }, { KIT }) {
  console.log('Checking benchmark-pilot evidence surface (#242/#176)...');
  const modPath = resolve(KIT, 'templates/contextkit/tools/scripts/economics/benchmark-pilot.mjs');

  let lib;
  try { lib = await import(pathToFileURL(modPath).href); ok('benchmark-pilot.mjs imports cleanly'); }
  catch (err) { bad(`benchmark-pilot.mjs import failed: ${err?.message ?? err}`); return; }

  const { BENCHMARK_PILOT_SCHEMA_VERSION, readPilotEvidence, presentPilot } = lib;

  BENCHMARK_PILOT_SCHEMA_VERSION === 'eacp-benchmark-pilot/1'
    ? ok('pilot: SCHEMA_VERSION === "eacp-benchmark-pilot/1"')
    : bad(`pilot: SCHEMA_VERSION is "${BENCHMARK_PILOT_SCHEMA_VERSION}"`);

  // Absent file → null / ''.
  const empty = mkdtempSync(join(tmpdir(), 'pilot-empty-'));
  readPilotEvidence(empty) === null ? ok('readPilotEvidence: absent file → null') : bad('readPilotEvidence: absent should be null');
  presentPilot(empty) === '' ? ok('presentPilot: absent → "" (no line)') : bad('presentPilot: absent should be ""');
  try { rmSync(empty, { recursive: true, force: true }); } catch { /* best-effort */ }

  // Valid record → a line with the ratio and ALWAYS claim: null.
  let root;
  try {
    root = fixtureRoot({ multiplier: 1.3983, n: 8, reps: 1, confidence: 'inferred', target: 'compozy',
      qaGreen: { a: 8, c: 8 }, claim: 0.42 /* even a non-null claim in the file must NOT surface */ });
    const line = presentPilot(root);
    line.includes('1.3983') && /\+39\.8%/.test(line)
      ? ok('presentPilot: renders the ratio (1.3983× / +39.8%)') : bad(`presentPilot: ratio wrong: ${line.slice(0, 120)}`);
    /claim:\s*null/i.test(line) && !/claim:\s*0?\.?42/.test(line)
      ? ok('presentPilot: ALWAYS "claim: null" even when the file carries a claim')
      : bad(`presentPilot: claim leaked: ${line}`);
    /n=8/.test(line) && /reps=1/.test(line) && /#243/.test(line)
      ? ok('presentPilot: labels n/reps + cites the #243 powered-run gate')
      : bad(`presentPilot: missing n/reps/gate: ${line}`);
  } catch (err) { bad(`presentPilot fixture threw: ${err?.message ?? err}`); }
  finally { if (root) { try { rmSync(root, { recursive: true, force: true }); } catch { /* best-effort */ } } }

  // Invalid multiplier → ''.
  const bad1 = fixtureRoot({ multiplier: 'x', n: 8 });
  presentPilot(bad1) === '' ? ok('presentPilot: invalid multiplier → "" (no fabricated line)') : bad('presentPilot: invalid multiplier should be ""');
  try { rmSync(bad1, { recursive: true, force: true }); } catch { /* best-effort */ }

  // Zero-dep invariant.
  const zd = await checkModuleZeroDep(modPath);
  zd.error ? bad(`zero-dep: benchmark-pilot.mjs ${zd.error}`)
           : ok('zero-dep invariant: benchmark-pilot.mjs imports only node:/* or relative paths');
}
