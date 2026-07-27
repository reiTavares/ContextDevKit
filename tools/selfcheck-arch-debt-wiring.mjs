#!/usr/bin/env node
/**
 * OP-0012 (ADR-0122) — selftest for the arch-debt gate WIRING hotfix.
 *
 * The verdict engine was already correct and covered; what was broken was the
 * PLUMBING around it. Every check below would have FAILED before this hotfix and
 * passes after, which is the point (immutable rule 3):
 *
 *   A. change-evidence     — the per-file added/removed lines the security floor
 *                            consumes now exist at all, and the diff base is the
 *                            merge-base rather than only the working tree.
 *   B. enforcement-posture — the twelve dimensions resolve a REAL authority;
 *                            line count can never be promoted into blocking.
 *   C. resolver            — `enforcement`, `floorAuthorities` and the declared
 *                            evidence keys are actually emitted.
 *   D. pre-coding law      — the twelve dimensions are stated BEFORE the write,
 *                            and the self-applied tier is labelled honestly.
 *   E. gate end-to-end     — guarded BLOCKS a real regression; advisory,
 *                            `enabled:false` and a demoted dimension do not.
 *
 * Zero-dep, node:/relative only, Windows-safe. Standalone entrypoint (exit 0/1).
 */
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dir = resolve(fileURLToPath(import.meta.url), '..');
const KIT = resolve(__dir, '..');
let passes = 0, failures = 0;
const ok = (m) => { passes++; console.log('  ok ' + m); };
const bad = (m) => { failures++; console.error('  XX ' + m); };

const load = async (rel) => import(pathToFileURL(resolve(KIT, rel)).href);

let evidence, posture, resolver, law, lawGate, gate;
try {
  evidence = await load('templates/contextkit/tools/scripts/arch-debt/change-evidence.mjs');
  posture = await load('templates/contextkit/tools/scripts/arch-debt/enforcement-posture.mjs');
  resolver = await load('templates/contextkit/runtime/config/resolve-arch-debt-config.mjs');
  law = await load('templates/contextkit/runtime/execution/arch-debt-law.mjs');
  lawGate = await load('templates/contextkit/runtime/hooks/arch-debt-law-gate.mjs');
  gate = await load('templates/contextkit/tools/scripts/architecture-debt-gate.mjs');
} catch (err) {
  bad('Failed to import a wiring module: ' + (err && err.message || err));
  console.error('Aborting.');
  process.exit(1);
}

// ===========================================================================
// A. change-evidence — the input the security floor never used to receive
// ===========================================================================
console.log('\nA. change-evidence — real diff lines reach the floor');

const DIFF = [
  'diff --git a/src/db.js b/src/db.js',
  '--- a/src/db.js',
  '+++ b/src/db.js',
  '@@ -1,2 +1,2 @@',
  '+db.query("SELECT * FROM u WHERE id=" + userId)',
  '-const safe = 1;',
  'diff --git a/src/gone.js b/src/gone.js',
  '--- a/src/gone.js',
  '+++ /dev/null',
  '@@ -1 +0,0 @@',
  '-was here',
].join('\n');

const parsed = evidence.parseUnifiedDiff(DIFF);
parsed.length === 1
  ? ok('a deleted file (+++ /dev/null) contributes no scannable target')
  : bad(`expected 1 parsed file, got ${parsed.length}`);
const dbFile = parsed.find((f) => f.path === 'src/db.js');
dbFile ? ok('path parsed without the a/ b/ prefix') : bad('src/db.js not parsed');
dbFile && dbFile.addedLines.length === 1 && dbFile.addedLines[0].includes('SELECT')
  ? ok('added line CONTENT captured (this is what the floor scans)')
  : bad('added lines wrong: ' + JSON.stringify(dbFile && dbFile.addedLines));
dbFile && dbFile.removedLines.length === 1
  ? ok('removed line captured (AUTH_CHECK_REMOVED detection depends on it)')
  : bad('removed lines wrong: ' + JSON.stringify(dbFile && dbFile.removedLines));
dbFile && !dbFile.addedLines.some((l) => l.startsWith('++') || l.startsWith('@@'))
  ? ok('diff headers/hunk markers excluded (cannot self-match a pattern)')
  : bad('a diff header leaked into the scanned lines');
evidence.parseUnifiedDiff(null).length === 0 && evidence.parseUnifiedDiff('').length === 0
  ? ok('malformed/empty diff → no evidence (never throws)')
  : bad('malformed diff not handled');

// Diff base ladder — an explicit base and the host PR base beat the working tree.
const gitOk = () => '';
const gitFail = () => null;
const explicit = evidence.resolveDiffBase({ CONTEXTKIT_DIFF_BASE: 'origin/dev' }, KIT, gitOk);
explicit.kind === 'merge-base' && explicit.range[0] === 'origin/dev...HEAD'
  ? ok('explicit CONTEXTKIT_DIFF_BASE → merge-base range')
  : bad('explicit base ignored: ' + JSON.stringify(explicit));
const pr = evidence.resolveDiffBase({ GITHUB_BASE_REF: 'main' }, KIT, gitOk);
pr.base === 'origin/main' && pr.kind === 'merge-base'
  ? ok('GITHUB_BASE_REF → origin/<ref> merge-base (a clean CI checkout is no longer blind)')
  : bad('PR base ignored: ' + JSON.stringify(pr));
const unknownRef = evidence.resolveDiffBase({ CONTEXTKIT_DIFF_BASE: 'nope' }, KIT, gitFail);
unknownRef.kind === 'working-tree'
  ? ok('an unverifiable ref falls back to the working tree (never a blind empty set)')
  : bad('unknown ref trusted: ' + JSON.stringify(unknownRef));
const noGit = evidence.collectChangeEvidence({ root: KIT, env: {}, runGit: gitFail });
noGit.available === false && noGit.securityChangedFiles.length === 0
  ? ok('git unavailable → available:false + empty evidence (skipped, never a PASS claim)')
  : bad('git failure not degraded: ' + JSON.stringify(noGit));

// ===========================================================================
// B. enforcement-posture — the twelve dimensions as configurable law
// ===========================================================================
console.log('\nB. enforcement-posture — real authority, with the two invariants intact');

const finding = (over = {}) => ({
  ruleId: 'F7.security-regression.injection_sink_introduced',
  dimension: 'SECURITY_PRIVACY',
  enforcement: 'BLOCKING',
  status: 'VIOLATION',
  evidence: { class: 'DETERMINISTIC' },
  ...over,
});
const one = (list) => (Array.isArray(list) && list.length === 1 ? list[0] : null);
const apply = (f, opts) => one(posture.applyEnforcementPosture([f], opts));

apply(finding(), { posture: 'guarded' }).enforcement === 'BLOCKING'
  ? ok('guarded keeps the declared authority — the dimension genuinely blocks')
  : bad('guarded did not preserve BLOCKING');
apply(finding(), { posture: 'advisory' }).enforcement === 'ADVISORY'
  ? ok('advisory demotes BLOCKING → ADVISORY (the documented opt-out)')
  : bad('advisory did not demote');
apply(finding({ enforcement: 'REVIEW_REQUIRED', status: 'WARNING' }), { posture: 'strict' }).enforcement === 'BLOCKING'
  ? ok('strict promotes REVIEW_REQUIRED → BLOCKING for deterministic evidence')
  : bad('strict did not promote');
apply(finding(), { posture: 'guarded', authorities: { SECURITY_PRIVACY: 'ADVISORY' } }).enforcement === 'ADVISORY'
  ? ok('per-dimension override wins — floors.security is no longer decorative')
  : bad('per-dimension override ignored');
apply(finding(), { posture: 'guarded', authorities: { SECURITY_PRIVACY: 'bogus' } }).enforcement === 'BLOCKING'
  ? ok('an invalid authority is dropped, never silently disarming the floor')
  : bad('invalid authority honoured');

// Invariant 1: line count can never block, in any posture, via any config.
const lineFinding = finding({
  ruleId: 'arch-debt.line-count', dimension: 'COMPLEXITY',
  enforcement: 'ADVISORY', status: 'OBSERVATION', evidence: { class: 'HEURISTIC' },
});
const hostile = apply(lineFinding, { posture: 'strict', authorities: { COMPLEXITY: 'BLOCKING' } });
hostile.enforcement !== 'BLOCKING'
  ? ok('line-count NEVER reaches BLOCKING even under strict + a hostile override')
  : bad('LINE COUNT REACHED BLOCKING — ADR-0143 invariant broken!');
posture.mayBlock(lineFinding) === false
  ? ok('mayBlock() refuses the line-count rule outright')
  : bad('mayBlock allowed line-count');

// Invariant 2: a model opinion may raise concern but never block.
const semantic = finding({ dimension: 'MODULARITY', evidence: { class: 'SEMANTIC' }, enforcement: 'REVIEW_REQUIRED', status: 'WARNING' });
apply(semantic, { posture: 'strict' }).enforcement === 'REVIEW_REQUIRED'
  ? ok('SEMANTIC evidence is never promoted to BLOCKING (fork-2 upheld on rewrite)')
  : bad('semantic finding was promoted to BLOCKING');
posture.applyEnforcementPosture([finding()], { posture: 'nonsense' })[0].enforcement === 'BLOCKING'
  ? ok('an unknown posture falls back to guarded (never silently disarmed)')
  : bad('unknown posture disarmed the gate');

// ===========================================================================
// C. resolver — the keys gate-context reads are finally produced
// ===========================================================================
console.log('\nC. resolver — emits what gate-context consumes');

const base = resolver.resolveArchDebtConfig({ architectureDebtGate: {} });
base.enforcement === 'guarded'
  ? ok('enforcement defaults to guarded (the gate ships enforcing)')
  : bad('default posture: ' + base.enforcement);
resolver.resolveArchDebtConfig({ architectureDebtGate: { enforcement: 'bogus' } }).enforcement === 'guarded'
  ? ok('an invalid posture resolves to guarded, not to advisory')
  : bad('invalid posture disarmed the gate');
'floorAuthorities' in base
  ? ok('floorAuthorities emitted (the dimension-keyed authority map)')
  : bad('floorAuthorities missing');
const mapped = resolver.resolveArchDebtConfig({
  architectureDebtGate: { floors: { security: 'ADVISORY', reliability: 'NOPE' } },
}).floorAuthorities;
mapped.SECURITY_PRIVACY === 'ADVISORY' && !('RELIABILITY' in mapped)
  ? ok('floors.* maps onto DIMENSION keys; an invalid value is dropped')
  : bad('floor mapping wrong: ' + JSON.stringify(mapped));
const declared = resolver.resolveArchDebtConfig({
  architectureDebtGate: {
    reliability: { migrations: [] },
    changedBehaviors: [{ path: 'a.js', critical: true }],
    impactedTests: { available: true, coveredPaths: ['a.js'] },
  },
});
declared.reliability && declared.changedBehaviors && declared.impactedTests
  ? ok('declared evidence (reliability/changedBehaviors/impactedTests) passes through')
  : bad('declared evidence dropped by the resolver');
base.reliability === undefined && base.changedBehaviors === undefined
  ? ok('undeclared evidence stays undefined — never INFERRED from a diff')
  : bad('resolver invented change evidence');

// ===========================================================================
// D. pre-coding law — stated before the write, labelled honestly
// ===========================================================================
console.log('\nD. pre-coding law — the standard arrives before the diff');

law.TWELVE_DIMENSIONS.length === 12
  ? ok('exactly twelve dimensions are stated')
  : bad('dimension count: ' + law.TWELVE_DIMENSIONS.length);
const brief = law.renderPrecodeLaw({ posture: 'guarded' });
brief.includes('SELF-APPLIED') && brief.includes('NO detector')
  ? ok('the four detector-less dimensions are labelled SELF-APPLIED (no theatre)')
  : bad('self-applied tier not disclosed');
/File size is not debt/i.test(brief)
  ? ok('the brief states file size is not debt (ADR-0143)')
  : bad('file-size clause missing from the brief');
brief.includes('architecture-debt-gate.mjs --ci')
  ? ok('the brief names the exact verification command')
  : bad('verification command missing');
law.renderPrecodeLaw({ posture: 'advisory' }).includes('advisory')
  ? ok('the brief reflects the ACTUAL posture, never overstating enforcement')
  : bad('advisory posture not reflected');

const deliver = (over) => lawGate.decideDelivery({
  level: 7, alreadyDelivered: false, toolName: 'Write', filePaths: ['src/app.js'], ...over,
});
deliver({}).deliver === true ? ok('first source write → law delivered') : bad('law not delivered on first source write');
deliver({ level: 3 }).deliver === false ? ok('below L4 → silent (gate capability floor)') : bad('delivered below L4');
deliver({ alreadyDelivered: true }).deliver === false ? ok('once per session (debounced, never a nag)') : bad('law repeated');
deliver({ toolName: 'Read' }).deliver === false ? ok('non-write tool → silent') : bad('delivered on a read');
deliver({ filePaths: ['docs/guide.md'] }).deliver === false
  ? ok('docs-only write → silent (no architectural weight)')
  : bad('delivered on a docs write');
deliver({ filePaths: ['contextkit/memory/x.json'] }).deliver === false
  ? ok('governance-memory write → silent')
  : bad('delivered on a memory write');

// HOST PARITY (regression): the law must be delivered on EVERY host's write
// tools, not only Claude's triple. Antigravity keeps its own tool names, so a
// hardcoded ['Edit','Write','MultiEdit'] registered the hook on three hosts but
// delivered on two — silently. This is the check that would have caught it.
for (const agyTool of ['write_to_file', 'replace_file_content', 'multi_replace_file_content']) {
  deliver({ toolName: agyTool }).deliver === true
    ? ok(`agy \`${agyTool}\` → law delivered (host parity)`)
    : bad(`agy ${agyTool} did NOT get the law — host parity broken`);
}
deliver({ toolName: 'write_to_file', filePaths: ['docs/x.md'] }).deliver === false
  ? ok('agy docs-only write → silent (parity of the exclusion too)')
  : bad('agy docs write got the law');

// ===========================================================================
// E. gate end-to-end — the posture ladder over the real composition root
// ===========================================================================
console.log('\nE. gate end-to-end — guarded blocks, the escapes do not');

const injection = [{
  path: 'src/db.js',
  addedLines: ['db.query("SELECT * FROM u WHERE id=" + userId)'],
  removedLines: [],
}];
const runWith = (config) => gate.runGate({
  root: KIT,
  model: { modules: [], fileCount: 1 },
  fileMetrics: [],
  insights: { cycles: [] },
  readChangedFiles: () => ['src/db.js'],
  config,
});

const guarded = await runWith({ enforcement: 'guarded', securityChangedFiles: injection });
guarded.outcome === 'BLOCKED' && guarded.exitCode === 1
  ? ok('guarded + injection on a changed line → BLOCKED, exit 1 (the whole point)')
  : bad(`guarded did not block: ${guarded.outcome}/${guarded.exitCode}`);
const advisoryRun = await runWith({ enforcement: 'advisory', securityChangedFiles: injection });
advisoryRun.exitCode === 0
  ? ok('advisory → exit 0 (documented opt-out still works)')
  : bad('advisory blocked: ' + advisoryRun.outcome);
const off = await runWith({ enabled: false, securityChangedFiles: injection });
off.exitCode === 0
  ? ok('enabled:false → exit 0 (the master switch is no longer inert)')
  : bad('enabled:false still blocked: ' + off.outcome);
const demoted = await runWith({
  enforcement: 'guarded', securityChangedFiles: injection,
  floorAuthorities: { SECURITY_PRIVACY: 'ADVISORY' },
});
demoted.exitCode === 0
  ? ok('a demoted dimension → exit 0 (per-dimension authority is real)')
  : bad('demotion ignored: ' + demoted.outcome);
const clean = await runWith({
  enforcement: 'guarded',
  securityChangedFiles: [{ path: 'src/db.js', addedLines: ['const total = 1;'], removedLines: [] }],
});
clean.exitCode === 0 && clean.blocking.length === 0
  ? ok('a clean change passes — the gate is not a blanket refusal')
  : bad('clean change blocked: ' + clean.outcome);

// ===========================================================================
// F. baseline population + repayment status (regression, OP-0012)
// ===========================================================================
// Persisting the store and feeding it back as the ratchet baseline introduced two
// real defects that a PASS on a clean tree did NOT catch:
//   1. Population asymmetry — the store holds OBSERVE_ONLY findings, the verdict
//      set excludes them, so every OBSERVE_ONLY entry looked VANISHED and got
//      re-injected as repayment, dragging its stale UNKNOWN into the verdict.
//   2. Repaid findings kept their OLD status, so debt that was actually FIXED
//      could still fail the gate.
console.log('\nF. baseline population + repayment status (the store-as-baseline trap)');

const observeOnlyPrior = [{
  id: 'arch-debt.change-amplification:src/legacy.js:UNKNOWN',
  ruleId: 'arch-debt.change-amplification',
  dimension: 'MODULARITY',
  status: 'UNKNOWN',
  enforcement: 'OBSERVE_ONLY',
  evidence: { class: 'GRAPH_DERIVED', source: 's', ref: 'r' },
  path: 'src/legacy.js',
}];
const withObservePrior = await gate.runGate({
  root: KIT,
  model: { modules: [], fileCount: 1 },
  fileMetrics: [],
  insights: { cycles: [] },
  readChangedFiles: () => ['src/db.js'],
  config: { enforcement: 'guarded' },
  findingsBaseline: observeOnlyPrior,
});
withObservePrior.outcome !== 'UNKNOWN' && withObservePrior.exitCode === 0
  ? ok('an OBSERVE_ONLY baseline entry cannot drag UNKNOWN into the verdict')
  : bad(`OBSERVE_ONLY baseline poisoned the verdict: ${withObservePrior.outcome}`);

const fixedViolationPrior = [{
  id: 'F7.security-regression.injection_sink_introduced:src/old.js:file',
  ruleId: 'F7.security-regression.injection_sink_introduced',
  dimension: 'SECURITY_PRIVACY',
  status: 'VIOLATION',
  enforcement: 'BLOCKING',
  evidence: { class: 'DETERMINISTIC', source: 's', ref: 'r' },
  risk: { securityFloor: true },
  path: 'src/old.js',
}];
const repaid = await gate.runGate({
  root: KIT,
  model: { modules: [], fileCount: 1 },
  fileMetrics: [],
  insights: { cycles: [] },
  readChangedFiles: () => ['src/db.js'],
  config: { enforcement: 'guarded' },
  findingsBaseline: fixedViolationPrior,
});
repaid.exitCode === 0 && repaid.blocking.length === 0
  ? ok('a REPAID violation no longer blocks (repayment is not punished)')
  : bad(`a fixed violation still blocked: ${repaid.outcome}/${repaid.blocking.length}`);
repaid.positive.length > 0
  ? ok('the repayment still surfaces as positive evidence (§26 visible, not silent)')
  : bad('repayment evidence was lost entirely');

console.log(`\n${passes + failures} checks -- ${passes} pass / ${failures} fail`);
if (failures) {
  console.error('\nFAIL — OP-0012 arch-debt wiring selftest');
  process.exit(1);
}
console.log('\nPASS — OP-0012 arch-debt wiring selftest');
