#!/usr/bin/env node
/**
 * Integration test — installer Business-driven methodology auto-adoption
 * (BIZ-0001 / WF-0036; activates ADR-0125).
 *
 * Tests `maybeSeedMethodology` (tools/install/seed-methodology.mjs). Covers:
 *   A empty target          → seeds roots + READMEs + a valid BIZ-0001 scaffold + registry.
 *   B re-run                → idempotent (already_adopted), no duplicate BIZ dir, files unchanged.
 *   C config autoSeed=false → disabled, NOTHING written.
 *   D malformed root path    → fail-open (no throw escapes), returns a skip note.
 *
 * Run:  node tools/integration-test-methodology-seed.mjs
 */
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { reporter } from './it-helpers.mjs';

const KIT = dirname(dirname(fileURLToPath(import.meta.url)));
const rep = reporter();
const { ok, bad } = rep;

async function loadSeeder() {
  const filePath = resolve(KIT, 'tools/install/seed-methodology.mjs');
  return import('file:///' + filePath.replaceAll('\\', '/'));
}

async function loadValidator() {
  const filePath = resolve(KIT, 'templates/contextkit/runtime/work/schema-business.mjs');
  return import('file:///' + filePath.replaceAll('\\', '/'));
}

function makeTempDir() {
  const dir = mkdtempSync(join(tmpdir(), 'methseed-it-'));
  mkdirSync(join(dir, 'contextkit'), { recursive: true });
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

const bizRoot = (dir) => join(dir, 'contextkit', 'memory', 'business');
const opsRoot = (dir) => join(dir, 'contextkit', 'memory', 'operations');
const bizDirs = (dir) => { try { return readdirSync(bizRoot(dir)).filter((n) => /^BIZ-\d{4}-/.test(n)); } catch { return []; } };

// ── A. Empty target → full scaffold + valid business.json ────────────────────
async function caseA(maybeSeedMethodology, validateBusiness) {
  const { dir, cleanup } = makeTempDir();
  try {
    const result = await maybeSeedMethodology(dir, { name: 'Acme Platform' });

    result?.status === 'seeded'
      ? ok('A: status "seeded" on an empty target')
      : bad(`A: expected "seeded"; got ${JSON.stringify(result)}`);

    const dirs = bizDirs(dir);
    dirs.length === 1 && dirs[0].startsWith('BIZ-0001-')
      ? ok(`A: exactly one Root Business scaffolded (${dirs[0]})`)
      : bad(`A: expected one BIZ-0001-* dir; got ${JSON.stringify(dirs)}`);

    const required = ['business.json', 'business-case.md', 'growth.md', 'investment-decision.md'];
    const allPresent = dirs[0] && required.every((f) => existsSync(join(bizRoot(dir), dirs[0], f)));
    allPresent ? ok('A: BIZ-0001 contains business.json + 3 doc templates') : bad('A: BIZ-0001 missing required files');

    existsSync(join(bizRoot(dir), 'README.md')) && existsSync(join(opsRoot(dir), 'README.md'))
      ? ok('A: both work-context roots seeded WITH a README template')
      : bad('A: a root README is missing');

    existsSync(join(dir, 'contextkit', 'memory', 'work-context-registry.json'))
      ? ok('A: work-context registry rebuilt')
      : bad('A: work-context registry not written');

    if (dirs[0]) {
      const biz = JSON.parse(readFileSync(join(bizRoot(dir), dirs[0], 'business.json'), 'utf8'));
      const verdict = validateBusiness(biz);
      verdict.ok && biz.id === 'BIZ-0001' && biz.status === 'draft'
        ? ok('A: scaffolded business.json validates (id BIZ-0001, status draft)')
        : bad(`A: business.json invalid — ${JSON.stringify(verdict.errors ?? [])}`);
    }
  } finally {
    cleanup();
  }
}

// ── B. Re-run → idempotent, no duplicate, content preserved ──────────────────
async function caseB(maybeSeedMethodology) {
  const { dir, cleanup } = makeTempDir();
  try {
    await maybeSeedMethodology(dir, { name: 'Acme Platform' });
    const caseFile = join(bizRoot(dir), bizDirs(dir)[0], 'business-case.md');
    writeFileSync(caseFile, '# my real business case\n'); // simulate developer edits

    const result = await maybeSeedMethodology(dir, { name: 'Acme Platform' });
    result?.status === 'already_adopted'
      ? ok('B: status "already_adopted" on re-run')
      : bad(`B: expected "already_adopted"; got ${JSON.stringify(result)}`);

    bizDirs(dir).length === 1
      ? ok('B: no duplicate Root Business created')
      : bad(`B: duplicate BIZ dirs: ${JSON.stringify(bizDirs(dir))}`);

    readFileSync(caseFile, 'utf8').includes('my real business case')
      ? ok('B: developer-edited business-case.md preserved (write-if-missing)')
      : bad('B: developer content was clobbered');
  } finally {
    cleanup();
  }
}

// ── C. Opt-out via config → nothing written ──────────────────────────────────
async function caseC(maybeSeedMethodology) {
  const { dir, cleanup } = makeTempDir();
  try {
    writeFileSync(join(dir, 'contextkit', 'config.json'), JSON.stringify({ methodology: { autoSeed: false } }));
    const result = await maybeSeedMethodology(dir, { name: 'Acme Platform' });

    result?.status === 'disabled'
      ? ok('C: status "disabled" when methodology.autoSeed=false')
      : bad(`C: expected "disabled"; got ${JSON.stringify(result)}`);

    !existsSync(bizRoot(dir))
      ? ok('C: no business root created when opted out')
      : bad('C: business root was created despite opt-out');
  } finally {
    cleanup();
  }
}

// ── D. Fail-open — a broken target never throws ──────────────────────────────
async function caseD(maybeSeedMethodology) {
  // Point at a path whose "contextkit" is a FILE, so directory creation fails.
  const { dir, cleanup } = makeTempDir();
  try {
    rmSync(join(dir, 'contextkit'), { recursive: true, force: true });
    writeFileSync(join(dir, 'contextkit'), 'not a dir\n');
    let threw = false;
    let result;
    try {
      result = await maybeSeedMethodology(dir, { name: 'Acme Platform' });
    } catch {
      threw = true;
    }
    !threw
      ? ok('D: no exception escapes maybeSeedMethodology (fail-open)')
      : bad('D: exception escaped — must be caught internally');
    result?.status === 'failed'
      ? ok('D: returns a structured "failed" skip note')
      : bad(`D: expected "failed"; got ${JSON.stringify(result)}`);
  } finally {
    cleanup();
  }
}

// ── E. Deferred preflight → no writes (update-safety parity) ─────────────────
async function caseE(maybeSeedMethodology) {
  const { dir, cleanup } = makeTempDir();
  try {
    const result = await maybeSeedMethodology(dir, { name: 'Acme', preflight: { status: 'DEFERRED_ACTIVE_SESSIONS' } });
    result?.status === 'deferred'
      ? ok('E: status "deferred" when preflight is DEFERRED_ACTIVE_SESSIONS')
      : bad(`E: expected "deferred"; got ${JSON.stringify(result)}`);
    !existsSync(bizRoot(dir))
      ? ok('E: deferred run writes nothing under memory/business (no user-memory mutation)')
      : bad('E: deferred run mutated memory/business');
  } finally {
    cleanup();
  }
}

// ── F. No-op re-run → registry byte-identical (no churn) ──────────────────────
async function caseF(maybeSeedMethodology) {
  const { dir, cleanup } = makeTempDir();
  try {
    await maybeSeedMethodology(dir, { name: 'Acme Platform' });
    const reg = join(dir, 'contextkit', 'memory', 'work-context-registry.json');
    const before = readFileSync(reg, 'utf8');
    await maybeSeedMethodology(dir, { name: 'Acme Platform' }); // no-op re-run
    readFileSync(reg, 'utf8') === before
      ? ok('F: work-context registry is byte-identical after a no-op re-run')
      : bad('F: registry content changed on a no-op re-run');
  } finally {
    cleanup();
  }
}

(async () => {
  console.log('\n🌀 Integration test — methodology auto-adoption (BIZ-0001, ADR-0125/0126)\n');

  let maybeSeedMethodology;
  let validateBusiness;
  try {
    ({ maybeSeedMethodology } = await loadSeeder());
    ({ validateBusiness } = await loadValidator());
    ok('tools/install/seed-methodology.mjs imports cleanly');
  } catch (err) {
    bad(`import failed: ${err?.message ?? err}`);
    rep.finish('methodology auto-adoption (BIZ-0001)');
    return;
  }

  await caseA(maybeSeedMethodology, validateBusiness);
  await caseB(maybeSeedMethodology);
  await caseC(maybeSeedMethodology);
  await caseD(maybeSeedMethodology);
  await caseE(maybeSeedMethodology);
  await caseF(maybeSeedMethodology);

  rep.finish('methodology auto-adoption (BIZ-0001, ADR-0125/0126)');
})();
