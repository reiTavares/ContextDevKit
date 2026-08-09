#!/usr/bin/env node
/**
 * Self-check — WF-0069 / OP-0008 Finding #2: ADR allocator blind to the
 * canonical `ADR-####-*.md` filename format (card #372).
 *
 * WHY this gate exists: `maxAdrInDir` (templates/contextkit/tools/scripts/
 * registry/ids.mjs) used `/^(\d{4})[-.]/`, which matches the legacy
 * `NNNN-*.md` / `NNNN.md` spellings but MISSES the canonical `ADR-####-*.md`
 * spelling produced by every recent ADR. Live symptom: `nextAdrNumber()`
 * returned `0125` while the real disk max was `ADR-0130` — the allocator was
 * silently reusing numbers already taken by canonically-named ADRs. WF/BIZ/OP
 * allocators were unaffected (they already check both formats); only the ADR
 * allocator was blind. This selftest is the permanent regression guard: it
 * fails loudly (exit 1) if the allocator ever again misses a canonically
 * named `ADR-####-*.md` file when computing the next free number.
 *
 * Exercises the REAL exported allocator (`nextAdrNumber`) against an isolated
 * temp fixture (no git repo, so fleet reconciliation collapses to the local
 * root alone) — never the installed `contextkit/` copy.
 *
 * Standalone runnable: `node tools/selfcheck-wf0069-adr-allocator.mjs`
 * Exit 0 on all-pass, exit 1 on any failure. Zero runtime deps — node:* only.
 */
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const KIT = resolve(__dirname, '..');
const IDS_URL = pathToFileURL(resolve(KIT, 'templates/contextkit/tools/scripts/registry/ids.mjs')).href;

/** Builds an isolated temp root with `contextkit/memory/decisions/<name>: content` files. */
function buildFixture(files) {
  const root = resolve(tmpdir(), `selfcheck-wf0069-adr-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  const decisions = resolve(root, 'contextkit/memory/decisions');
  mkdirSync(decisions, { recursive: true });
  for (const [name, content] of Object.entries(files)) {
    writeFileSync(resolve(decisions, name), content);
  }
  return root;
}

function cleanFixture(root) {
  try { rmSync(root, { recursive: true, force: true }); } catch { /* best-effort */ }
}

/**
 * Runs the WF-0069 ADR allocator regression checks.
 * @param {{ ok: (m: string) => void, bad: (m: string) => void }} reporter
 * @param {{ KIT: string }} ctx - repo root (unused directly; ids.mjs is loaded via IDS_URL)
 */
export async function runWf0069AdrAllocatorChecks({ ok, bad }) {
  console.log('Checking WF-0069 ADR allocator — canonical ADR-####-*.md recognition...');

  let nextAdrNumber;
  try {
    ({ nextAdrNumber } = await import(IDS_URL));
    ok('ids.mjs imports cleanly');
  } catch (err) {
    bad(`ids.mjs import failed: ${err?.message ?? err}`);
    return;
  }

  // 1. Mixed dir: canonical ADR-0130-*.md is the true max, legacy 0109 and a
  //    non-ADR README.md must not confuse it. The bug this guards against:
  //    the old regex would silently skip ADR-0130-foo.md and return 0110.
  const mixedRoot = buildFixture({
    'ADR-0130-foo.md': '# ADR-0130 — Foo\n',
    '0109-legacy.md': '# 0109 — Legacy\n',
    'README.md': '# Not an ADR\n',
  });
  try {
    const next = nextAdrNumber(mixedRoot);
    next === '0131'
      ? ok(`nextAdrNumber sees canonical ADR-0130-foo.md as the max → next="${next}"`)
      : bad(`nextAdrNumber should return "0131" (max=130+1), got "${next}" — canonical ADR-####-*.md not recognised`);
  } finally {
    cleanFixture(mixedRoot);
  }

  // 2. Legacy-only dir: pre-existing `NNNN-*.md` behaviour must not regress.
  const legacyRoot = buildFixture({
    '0109-legacy.md': '# 0109 — Legacy\n',
  });
  try {
    const next = nextAdrNumber(legacyRoot);
    next === '0110'
      ? ok(`nextAdrNumber still recognises legacy 0109-legacy.md → next="${next}" (no regression)`)
      : bad(`nextAdrNumber legacy regression: expected "0110", got "${next}"`);
  } finally {
    cleanFixture(legacyRoot);
  }

  // 3. Canonical-only dir with a `.md`-dotted legacy spelling alongside it.
  const dottedRoot = buildFixture({
    'ADR-0042-bar.md': '# ADR-0042 — Bar\n',
    '0007.md': '# 0007\n',
  });
  try {
    const next = nextAdrNumber(dottedRoot);
    next === '0043'
      ? ok(`nextAdrNumber picks the higher canonical number over a dotted legacy file → next="${next}"`)
      : bad(`nextAdrNumber dotted-legacy case: expected "0043", got "${next}"`);
  } finally {
    cleanFixture(dottedRoot);
  }
}

// ---------------------------------------------------------------------------
// Standalone guard — mirrors selfcheck-tc-accept.mjs pattern
// ---------------------------------------------------------------------------
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  let failures = 0;
  const ok  = (m) => console.log(`  ✓ ${m}`);
  const bad = (m) => { failures += 1; console.error(`  ✗ ${m}`); };
  runWf0069AdrAllocatorChecks({ ok, bad })
    .then(() => {
      console.log(
        failures === 0
          ? '\n  PASS — WF-0069 ADR allocator self-check: all checks passed.\n'
          : `\n  FAIL — WF-0069 ADR allocator self-check: ${failures} check(s) failed.\n`,
      );
      process.exit(failures === 0 ? 0 : 1);
    })
    .catch((err) => { console.error('selfcheck-wf0069-adr-allocator: unexpected error:', err); process.exit(1); });
}
