#!/usr/bin/env node
/**
 * Integration test — WF-0070 / ADR-0132: memory-accessibility VCS posture split
 * + the F-D dogfood/self-host BLOCKER guard.
 *
 * Proves the highest-blast-radius requirement of WF-0070: narrowing the managed
 * `info/exclude` block so a NON-dogfood install versions `contextkit/memory/**`
 * MUST NEVER un-ignore memory in the ContextDevKit repo itself (self-hosting),
 * or a human `git add -A && git push` would leak the private-mirror record.
 *
 * Checks (each a real git `check-ignore` receipt, not a claim):
 *   A. Non-self-host posture: memory trackable, machinery + regenerable indices ignored.
 *   B. Self-host GUARD (BLOCKER): `/contextkit/` re-excluded wholesale → memory ignored.
 *   C. `detectSelfHost` correctness: identity, fingerprint, and a plain project.
 *   D. Byte-idempotency: BLOCK_BEGIN/END rewritten in place on a re-run.
 *   E. Exclude-set invariants: default omits `/contextkit/` but keeps machinery
 *      subpaths; self-host set is `/contextkit/` wholesale.
 *
 * Run:  node tools/integration-test-memory-posture.mjs   (exit 0 = healthy)
 */
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { reporter, git } from './it-helpers.mjs';
import {
  applyDogfoodExclude,
  excludePathsFor,
  EXCLUDED_PATHS,
  SELF_HOST_EXCLUDED_PATHS,
} from './install/exclude.mjs';
import { detectSelfHost } from './install/update-preflight.mjs';

const KIT = dirname(dirname(fileURLToPath(import.meta.url)));
const rep = reporter();
const { ok, bad } = rep;
console.log('\n🧠 ContextDevKit integration test — memory posture + F-D dogfood guard (WF-0070 / ADR-0132)\n');

/** Fresh throwaway git repo. `check-ignore` needs a real repo to evaluate rules. */
function tmpGitRepo() {
  const proj = mkdtempSync(join(tmpdir(), 'contextkit-mem-'));
  git(['init', '-b', 'main'], proj);
  git(['config', 'user.email', 'it@example.com'], proj);
  git(['config', 'user.name', 'IT'], proj);
  return proj;
}
/** True when git would ignore `relPath` in `proj` (check-ignore exits 0 on a match). */
const isIgnored = (proj, relPath) => git(['check-ignore', relPath], proj).status === 0;

// ── E. exclude-set invariants (pure) ─────────────────────────────────────────
function checkInvariants() {
  !EXCLUDED_PATHS.includes('/contextkit/')
    ? ok('default EXCLUDED_PATHS no longer contains the wholesale /contextkit/')
    : bad('default EXCLUDED_PATHS still contains /contextkit/ — memory would be excluded at the parent');
  const machinery = ['/contextkit/runtime/', '/contextkit/tools/', '/contextkit/policy/', '/contextkit/pipeline/'];
  machinery.every((p) => EXCLUDED_PATHS.includes(p))
    ? ok('default set retains each machinery subpath (runtime/tools/policy/pipeline)')
    : bad(`default set missing a machinery subpath: ${machinery.filter((p) => !EXCLUDED_PATHS.includes(p)).join(', ')}`);
  !EXCLUDED_PATHS.some((p) => p.includes('contextkit/memory'))
    ? ok('default set does not exclude contextkit/memory/')
    : bad('default set excludes contextkit/memory/ — must stay trackable');
  SELF_HOST_EXCLUDED_PATHS.includes('/contextkit/')
    ? ok('self-host set excludes /contextkit/ wholesale (private-mirror guard)')
    : bad('self-host set does NOT exclude /contextkit/ — dogfood memory could leak');
  excludePathsFor(true) === SELF_HOST_EXCLUDED_PATHS && excludePathsFor(false) === EXCLUDED_PATHS
    ? ok('excludePathsFor selects self-host vs default set correctly')
    : bad('excludePathsFor selection is wrong');
}

// ── A. non-self-host posture (the default for user projects) ──────────────────
async function checkNonSelfHost() {
  const proj = tmpGitRepo();
  try {
    const wrote = await applyDogfoodExclude(proj, { selfHost: false });
    // Reproduce the committed .gitignore machinery the installer would also add,
    // so the disposable-state receipt is honest (info/exclude alone doesn't list it).
    writeFileSync(join(proj, '.gitignore'), 'contextkit/pipeline/state/\n', 'utf-8');
    wrote ? ok('applyDogfoodExclude wrote the block (non-self-host)') : bad('applyDogfoodExclude did not write');
    !isIgnored(proj, 'contextkit/memory/decisions/ADR-0001-x.md')
      ? ok('receipt: contextkit/memory/decisions/*.md is NOT ignored (trackable)')
      : bad('contextkit/memory/decisions/*.md is ignored — memory must be trackable');
    !isIgnored(proj, 'contextkit/memory/workflows/WF-0070-x/spec.md')
      ? ok('receipt: contextkit/memory/workflows/**/spec.md is NOT ignored')
      : bad('memory workflows are ignored — must be trackable');
    isIgnored(proj, 'contextkit/runtime/hooks/session-start.mjs')
      ? ok('receipt: contextkit/runtime/** machinery IS ignored')
      : bad('machinery contextkit/runtime/** should be ignored');
    isIgnored(proj, 'contextkit/pipeline/state/board.json')
      ? ok('receipt: contextkit/pipeline/state/* disposable IS ignored')
      : bad('disposable pipeline state should be ignored');
    // Kit-generated bookkeeping (review blocker): .engine-version churns every
    // release, so it must stay excluded even though contextkit/memory/ is trackable.
    isIgnored(proj, 'contextkit/.engine-version')
      ? ok('receipt: contextkit/.engine-version bookkeeping IS ignored (no per-release churn)')
      : bad('contextkit/.engine-version leaked — machinery bookkeeping must stay ignored');
    isIgnored(proj, 'contextkit/.install-manifest.json')
      ? ok('receipt: contextkit/.install-manifest.json IS ignored')
      : bad('contextkit/.install-manifest.json leaked — must stay ignored');
  } finally {
    rmSync(proj, { recursive: true, force: true });
  }
}

// ── B. self-host GUARD (the BLOCKER) ──────────────────────────────────────────
async function checkSelfHostGuard() {
  const proj = tmpGitRepo();
  try {
    await applyDogfoodExclude(proj, { selfHost: true });
    isIgnored(proj, 'contextkit/memory/decisions/ADR-0132-x.md')
      ? ok('BLOCKER receipt: self-host keeps contextkit/memory/**  IGNORED (no public leak)')
      : bad('BLOCKER FAIL: self-host un-ignored contextkit/memory/** — private memory could leak on a push');
    isIgnored(proj, 'contextkit/runtime/hooks/x.mjs')
      ? ok('self-host still ignores machinery')
      : bad('self-host should ignore machinery');
  } finally {
    rmSync(proj, { recursive: true, force: true });
  }
}

// ── C. detectSelfHost correctness ─────────────────────────────────────────────
function checkDetectSelfHost() {
  detectSelfHost(KIT, KIT) === true
    ? ok('detectSelfHost: identity (target === kitRoot) → true')
    : bad('detectSelfHost failed the identity case');
  const fp = mkdtempSync(join(tmpdir(), 'contextkit-fp-'));
  try {
    writeFileSync(join(fp, 'install.mjs'), '// marker\n', 'utf-8');
    mkdirSync(join(fp, 'templates', 'contextkit'), { recursive: true });
    detectSelfHost(fp, KIT) === true
      ? ok('detectSelfHost: fingerprint (install.mjs + templates/contextkit) → true')
      : bad('detectSelfHost missed the self-host fingerprint');
  } finally {
    rmSync(fp, { recursive: true, force: true });
  }
  const plain = mkdtempSync(join(tmpdir(), 'contextkit-plain-'));
  try {
    detectSelfHost(plain, KIT) === false
      ? ok('detectSelfHost: a plain unrelated project → false (narrowing applies)')
      : bad('detectSelfHost false-positived on a plain project — would wrongly ignore user memory');
  } finally {
    rmSync(plain, { recursive: true, force: true });
  }
}

// ── D. byte-idempotency of the managed block ─────────────────────────────────
async function checkIdempotency() {
  const proj = tmpGitRepo();
  try {
    await applyDogfoodExclude(proj, { selfHost: false });
    const excludePath = join(proj, '.git', 'info', 'exclude');
    const first = existsSync(excludePath) ? readFileSync(excludePath, 'utf-8') : '';
    await applyDogfoodExclude(proj, { selfHost: false });
    const second = existsSync(excludePath) ? readFileSync(excludePath, 'utf-8') : '';
    first === second && first.includes('ContextDevKit install (managed block')
      ? ok('BLOCK_BEGIN/END is byte-idempotent on a re-run')
      : bad('exclude block changed on a second run (not idempotent)');
  } finally {
    rmSync(proj, { recursive: true, force: true });
  }
}

// Run every block in a deterministic sequence, then finish (sets the exit code).
try {
  checkInvariants();
  await checkNonSelfHost();
  await checkSelfHostGuard();
  checkDetectSelfHost();
  await checkIdempotency();
} catch (err) {
  bad(`unexpected failure: ${err && err.stack ? err.stack : err}`);
}
rep.finish('memory posture + F-D dogfood guard (WF-0070 / ADR-0132)');
