#!/usr/bin/env node
/**
 * Conservative test:impact selector (TEA-004, SPEC §4) — pure, deterministic,
 * explainable. Maps a changed-file set → the minimal suite set that change can
 * affect, and is **false-negative-averse**: any uncertainty escalates to the
 * FULL suite list. It is an inner-loop accelerator ONLY — never the release gate
 * (CI keeps `ci:full`, card 300).
 *
 * Public seam (matched by `tools/run-suites.mjs` Wave 1): `selectSuites({ changed,
 * suites })` returns a `Suite[]`. An empty/non-array return makes the runner fail
 * safe to the full list; this module additionally NEVER returns empty when there
 * are changes (it returns the full list instead), so the contract holds on both
 * sides.
 *
 * Broadening rules (any match widens; SPEC §4.3): a change under
 * `runtime/config/**` / `config/paths.mjs` / the core loader ⇒ FULL; under
 * `install.mjs` / `tools/install/**` ⇒ the installer+core cluster; under
 * `templates/**` host/bridge ⇒ the hosts tier; under test-infra
 * (`it-helpers` / `run-suites` / `test-suites` / `test-impact`) ⇒ FULL; an
 * unmapped path, a missing Project Map, or an empty diff on a dirty tree ⇒ FULL.
 *
 * Zero runtime deps; `node:*` only. Windows-safe: paths are normalised to
 * forward slashes before matching; the CLI diff read is defensive (fail-safe to
 * full). Keep ≤280 lines.
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const KIT = dirname(dirname(fileURLToPath(import.meta.url)));
const PROJECT_MAP = join(KIT, 'contextkit', 'memory', 'project-map', 'manifest.json');

/** Forward-slash a path so Windows separators match the `touches[]` seeds. */
const norm = (path) => String(path).replace(/\\/g, '/').replace(/^\.\//, '');

/**
 * Prefixes that, when touched, force the FULL suite list (highest-severity
 * broadening — config/loader and the test infrastructure itself). A change here
 * can alter what or how ANY suite runs, so we cannot reason about a subset.
 * @type {readonly string[]}
 */
const FULL_PREFIXES = Object.freeze([
  'templates/contextkit/runtime/config/',
  'tools/it-helpers.mjs',
  'tools/run-suites.mjs',
  'tools/test-suites.mjs',
  'tools/test-suites-touches.mjs',
  'tools/test-impact.mjs',
]);

/** Installer-cluster suite ids — the install/update/migrate path + its core. */
const INSTALLER_IDS = Object.freeze([
  'integration-test', 'tooling', 'migrate', 'update-safety', 'guards', 'install-cycle',
]);

/**
 * Decide whether a changed path forces FULL via the highest-severity rule: a
 * change under config/loader or the test infrastructure itself. Checked before
 * any other mapping because it can alter what or how every suite runs.
 * @param {string} path - normalised changed path.
 * @returns {string|null} a reason string when full is forced, else null.
 */
function fullPrefixReason(path) {
  for (const prefix of FULL_PREFIXES) {
    if (path === prefix || path.startsWith(prefix)) return `rule:full (test-infra/config '${prefix}')`;
  }
  return null;
}

/**
 * Is this path a SOURCE path the suites can exercise? Markdown, the contextkit
 * memory/pipeline ledger, and run artefacts are NOT source — a change there does
 * not force full on its own (avoids escalating docs-only PRs).
 * @param {string} path - normalised changed path.
 * @returns {boolean}
 */
function isSourcePath(path) {
  if (path.endsWith('.md')) return false;
  if (path.startsWith('contextkit/memory/') || path.startsWith('contextkit/pipeline/')) return false;
  if (path.startsWith('runs/') || path.startsWith('reports/')) return false;
  if (path.startsWith('docs/')) return false;
  return /\.(mjs|js|cjs|json)$/.test(path) || path.startsWith('templates/') || path.startsWith('tools/');
}

/**
 * Build the touches→suite resolver: given a changed path, return the ids of every
 * suite whose `touches[]` prefix-matches it.
 * @param {ReadonlyArray<{id:string,touches:string[]}>} suites
 * @returns {(path:string)=>string[]}
 */
function makeMapPath(suites) {
  return (path) => suites
    .filter((suite) => (suite.touches || []).some((seed) => path.startsWith(norm(seed))))
    .map((suite) => suite.id);
}

/**
 * Apply the installer broadening rule: a change under `install.mjs` or
 * `tools/install/**` selects the whole installer cluster (install/update/migrate
 * + its core integration suite).
 * @param {string} path - normalised changed path.
 * @returns {string[]} suite ids (possibly empty).
 */
function installerBroadening(path) {
  if (path === 'install.mjs' || path.startsWith('install.mjs')) return [...INSTALLER_IDS];
  if (path.startsWith('tools/install/')) return [...INSTALLER_IDS];
  return [];
}

/**
 * Apply the hosts broadening rule: a change under a host/bridge template selects
 * the whole hosts tier (parity is checked across hosts, so one host's change can
 * ripple to the shared bridge/parity suites).
 * @param {string} path - normalised changed path.
 * @param {ReadonlyArray<{id:string,tier:string}>} suites
 * @returns {string[]} suite ids (possibly empty).
 */
function hostsBroadening(path, suites) {
  const isHostPath = /^templates\/contextkit\/runtime\/(antigravity|codex|providers)\//.test(path)
    || /^templates\/(ctx|cdx)\.mjs$/.test(path);
  if (!isHostPath) return [];
  return suites.filter((suite) => suite.tier === 'integration:hosts').map((suite) => suite.id);
}

/**
 * Probe whether the Project Map is present on disk. Its ABSENCE is an uncertainty
 * signal (SPEC §4.4) → the caller escalates to full. We only need presence here;
 * the manifest is module-coarse, so importer closure degrades to "missing ⇒ full".
 *
 * NOTE: `contextkit/` is gitignored, so the map is absent in a clean CI checkout —
 * there the selector correctly runs full. Tests inject the signal (below) instead
 * of depending on the ambient filesystem, so they stay hermetic across machines.
 * @returns {boolean}
 */
function probeProjectMap() {
  return existsSync(PROJECT_MAP);
}

/**
 * Core selection. Pure: no I/O beyond the Project-Map presence probe (which the
 * caller may override via `projectMapPresent` to stay hermetic in tests/CI).
 * Returns BOTH the chosen suites and a structured explanation for the CLI.
 * @param {{changed:string[],suites:ReadonlyArray<object>,projectMapPresent?:boolean}} input
 * @returns {{selected:object[],included:Map<string,string>,excluded:Map<string,string>,confidence:string,full:boolean,fullReason:string|null}}
 */
function decide({ changed, suites, projectMapPresent }) {
  const all = Array.isArray(suites) ? suites : [];
  const byId = new Map(all.map((suite) => [suite.id, suite]));
  const mapPath = makeMapPath(all);
  const paths = (Array.isArray(changed) ? changed : []).map(norm).filter(Boolean);

  // Uncertainty: empty diff on a (presumed) dirty tree, or no Project Map → full.
  // `projectMapPresent` (boolean) overrides the FS probe so tests are hermetic.
  if (paths.length === 0) return fullSelection(all, 'rule:full (empty diff / dirty tree, uncertainty)');
  const hasMap = typeof projectMapPresent === 'boolean' ? projectMapPresent : probeProjectMap();
  if (!hasMap) return fullSelection(all, 'rule:full (Project Map missing, uncertainty)');

  const included = new Map();
  for (const path of paths) {
    const forced = fullPrefixReason(path);
    if (forced) return fullSelection(all, forced);
    const touched = mapPath(path);
    const installer = installerBroadening(path);
    const hosts = hostsBroadening(path, all);
    for (const id of touched) if (!included.has(id)) included.set(id, `matched touches for '${path}'`);
    for (const id of installer) if (!included.has(id)) included.set(id, `rule:installer ('${path}')`);
    for (const id of hosts) if (!included.has(id)) included.set(id, `rule:hosts ('${path}')`);
    // An unmapped SOURCE change (no touches, no broadening) is uncertainty → full.
    if (touched.length === 0 && installer.length === 0 && hosts.length === 0 && isSourcePath(path)) {
      return fullSelection(all, 'rule:full (unmapped source path, uncertainty)');
    }
  }

  // Never return empty on a dirty tree (cardinal sin): no mapping ⇒ full.
  if (included.size === 0) return fullSelection(all, 'rule:full (changes mapped to no suite, uncertainty)');

  const excluded = new Map();
  for (const suite of all) if (!included.has(suite.id)) excluded.set(suite.id, 'no changed path touches it');
  const selected = all.filter((suite) => included.has(suite.id));
  // Confidence: high when a single suite is hit; medium for a broadened subset.
  const confidence = selected.length === 1 ? 'high' : 'medium';
  return { selected, included, excluded, confidence, full: false, fullReason: null };
}

/**
 * Build a "run everything" result with a single shared reason. Confidence is
 * `low` for full runs (full is the fail-safe, not a precise selection).
 * @param {ReadonlyArray<object>} all
 * @param {string} reason
 * @returns {{selected:object[],included:Map<string,string>,excluded:Map<string,string>,confidence:string,full:boolean,fullReason:string}}
 */
function fullSelection(all, reason) {
  const included = new Map(all.map((suite) => [suite.id, reason]));
  return { selected: [...all], included, excluded: new Map(), confidence: 'low', full: true, fullReason: reason };
}

/**
 * Public selector seam (consumed by `tools/run-suites.mjs --impact`). Returns the
 * suites to run; NEVER an empty array when there are changes (full instead).
 * @param {{changed:string[],suites:ReadonlyArray<object>,projectMapPresent?:boolean}} input
 * @returns {object[]} the selected suites (full list on any uncertainty).
 */
export function selectSuites({ changed, suites, projectMapPresent } = {}) {
  return decide({ changed, suites, projectMapPresent }).selected;
}

/**
 * Full explanation for the CLI / tests: the selected suites plus per-suite
 * include/exclude reasons and an overall confidence.
 * @param {{changed:string[],suites:ReadonlyArray<object>,projectMapPresent?:boolean}} input
 * @returns {{selected:object[],included:Map<string,string>,excluded:Map<string,string>,confidence:string,full:boolean,fullReason:string|null}}
 */
export function explainSelection({ changed, suites, projectMapPresent } = {}) {
  return decide({ changed, suites, projectMapPresent });
}

/**
 * Read changed files from git (vs HEAD) for the CLI. Defensive: any failure
 * yields [] so the selector applies its empty-diff fail-safe (full).
 * @returns {string[]}
 */
function gitChanged() {
  try {
    const diff = spawnSync('git', ['diff', '--name-only', 'HEAD'], { cwd: KIT, encoding: 'utf-8' });
    if (diff.status !== 0 || !diff.stdout) return [];
    return diff.stdout.split('\n').map((line) => line.trim()).filter(Boolean);
  } catch {
    return [];
  }
}

/**
 * Parse `--changed a,b,c` out of argv (injectable diff for tests/CI). Absent ⇒
 * null (the CLI falls back to the git diff).
 * @param {string[]} argv
 * @returns {string[]|null}
 */
function parseChangedArg(argv) {
  const idx = argv.indexOf('--changed');
  if (idx === -1) return null;
  return (argv[idx + 1] ?? '').split(',').map((s) => s.trim()).filter(Boolean);
}

/**
 * CLI entry: compute the changed set, print the explanation, exit 0. Read-only;
 * it selects + explains, it does not run anything.
 * @returns {Promise<void>}
 */
async function main() {
  const { SUITES } = await import('./test-suites.mjs');
  const injected = parseChangedArg(process.argv.slice(2));
  const changed = injected ?? gitChanged();
  const report = explainSelection({ changed, suites: SUITES });

  console.log(`\n🎯 test:impact — ${changed.length} changed path(s)\n`);
  if (report.full) console.log(`  FULL run forced: ${report.fullReason}`);
  for (const [id, reason] of report.included) console.log(`  included: ${id} <- ${reason}`);
  if (!report.full) for (const [id, reason] of report.excluded) console.log(`  excluded: ${id} <- ${reason}`);
  console.log(`\n  confidence: ${report.confidence}${report.confidence === 'low' ? ' (escalates to full)' : ''}`);
  console.log(`  selected ${report.selected.length}/${SUITES.length} suite(s).\n`);
}

if (import.meta.url === `file://${process.argv[1]}` || norm(process.argv[1] || '').endsWith('tools/test-impact.mjs')) {
  main().catch((err) => {
    console.error('test-impact crashed:', err?.message ?? err);
    process.exit(1);
  });
}
