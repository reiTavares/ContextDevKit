/**
 * Self-check — SOURCE / STRUCTURAL invariants.
 *
 * Owns the static-pattern checks that scan SHIPPED source files for
 * properties that would silently regress if removed:
 *   - `checkSourceInvariants`  — required patterns per file (timeouts,
 *     atomic writes, sid sanitization, single-sourced labels, etc.).
 *   - `checkNoHardcodedPaths`  — rule 4 enforcement (no `contextkit/` path
 *     constructed via `resolve(...)`/`join(...)` in shipped runtime/scripts).
 *   - `checkWorkflowsPinned`   — shipped GitHub Actions are SHA-pinned;
 *     CI declares least-privilege permissions.
 *
 * Split out of the legacy `selfcheck-checks.mjs` (ADR-0016 H1 / task 037 —
 * by invariant category). The recursive-`.mjs`-listing helper `listMjs`
 * lives here because this is the module that scans source trees; it is
 * imported by `selfcheck-agent-forge.mjs` for the same reason.
 *
 * Every function takes the reporter `rep` ({ ok, bad }) plus only what it
 * needs. Entry point: `runSourceChecks(rep, ctx)` where `ctx = { KIT }`.
 */
import { existsSync } from 'node:fs';
import { readFile, readdir } from 'node:fs/promises';
import { dirname, relative, resolve, basename } from 'node:path';
import { pathToFileURL } from 'node:url';
import { SOURCE_INVARIANT_CASES } from './selfcheck-source-cases.mjs';
import { SOURCE_INVARIANT_CASES_RECENT } from './selfcheck-source-cases-recent.mjs';
import { SOURCE_INVARIANT_CASES_LATEST } from './selfcheck-source-cases-latest.mjs';

const srcTextFor = (KIT) => (rel) => readFile(resolve(KIT, rel), 'utf-8').catch(() => '');

/** All `.mjs` under a directory, recursively. Shared with the agent-forge selfcheck. */
export async function listMjs(absDir) {
  const out = [];
  let entries = [];
  try {
    entries = await readdir(absDir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    const p = resolve(absDir, e.name);
    if (e.isDirectory()) out.push(...(await listMjs(p)));
    else if (e.name.endsWith('.mjs')) out.push(p);
  }
  return out;
}

/** Source-level invariants — structural guarantees that would silently regress. */
async function checkSourceInvariants(rep, KIT) {
  const { ok, bad } = rep;
  const srcText = srcTextFor(KIT);
  console.log('Checking source-level invariants...');
  const cases = [...SOURCE_INVARIANT_CASES, ...SOURCE_INVARIANT_CASES_RECENT, ...SOURCE_INVARIANT_CASES_LATEST];
  for (const [label, rel, re] of cases) {
    re.test(await srcText(rel)) ? ok(label) : bad(`${label} — pattern ${re} missing in ${rel}`);
  }
}

/** Rule 4: no shipped runtime/script constructs a `contextkit/` path via resolve/join. */
async function checkNoHardcodedPaths(rep, KIT) {
  const { ok, bad } = rep;
  console.log('Checking platform paths are single-sourced (rule 4)...');
  const re = /\b(resolve|join)\(.*['"]contextkit\//;
  const offenders = [];
  for (const d of ['templates/contextkit/runtime', 'templates/contextkit/tools/scripts']) {
    for (const file of await listMjs(resolve(KIT, d))) {
      const lines = (await readFile(file, 'utf-8').catch(() => '')).split('\n');
      lines.forEach((line, i) => {
        if (/^\s*(\*|\/\/)/.test(line)) return;
        if (re.test(line)) offenders.push(`${file.replace(KIT, '').replaceAll('\\', '/')}:${i + 1}`);
      });
    }
  }
  offenders.length === 0
    ? ok('no hardcoded contextkit/ path construction (all via pathsFor/PLATFORM_DIR)')
    : offenders.forEach((o) => bad(`hardcoded contextkit/ path: ${o}`));
}

/** Shipped GitHub Actions must be SHA-pinned; CI must be least-privilege. */
async function checkWorkflowsPinned(rep, KIT) {
  const { ok, bad } = rep;
  const srcText = srcTextFor(KIT);
  console.log('Checking GitHub Actions are SHA-pinned...');
  const files = [
    '.github/workflows/ci.yml',
    '.github/workflows/release.yml',
    'templates/github/workflows/quality.yml',
    'templates/github/workflows/security.yml',
  ];
  const floating = /uses:\s*[\w./-]+@v\d/;
  for (const rel of files) {
    const text = await srcText(rel);
    if (!text) {
      bad(`workflow missing: ${rel}`);
      continue;
    }
    floating.test(text) ? bad(`${rel} has an unpinned (floating) action tag`) : ok(`${rel} actions are SHA-pinned`);
  }
  /permissions:[\s\S]*?contents:\s*read/.test(await srcText('.github/workflows/ci.yml'))
    ? ok('ci.yml declares least-privilege permissions (contents: read)') : bad('ci.yml missing contents:read permissions');
}

/** Top-level `.md` files of a dir (non-recursive). */
async function topLevelMd(absDir) {
  const out = [];
  let entries = [];
  try {
    entries = await readdir(absDir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) if (e.isFile() && e.name.endsWith('.md')) out.push(resolve(absDir, e.name));
  return out;
}

/** All `.md` under a dir, recursively. */
async function listMdFiles(absDir) {
  const out = [];
  let entries = [];
  try {
    entries = await readdir(absDir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    const p = resolve(absDir, e.name);
    if (e.isDirectory()) out.push(...(await listMdFiles(p)));
    else if (e.name.endsWith('.md')) out.push(p);
  }
  return out;
}

/**
 * ADR-0030 — cross-doc link integrity. Scans the seeded engine docs
 * (`templates/contextkit/*.md`) plus the whole `docs/` tree for relative markdown
 * links to other `.md` files and asserts each target exists, so deleted/renamed
 * docs (the rot the `review-protocol.md` seed gap caused) fail the build. Links
 * resolve relative to the SOURCE file's directory.
 *
 * Gitignored dogfood artifacts are NOT in the repo (CI never checks them out), so a
 * link into them resolves locally but not in CI — skip them so local matches CI:
 * `CHANGELOG.md`, and any target under the ROOT `contextkit/` (the self-install).
 * The tracked SOURCE tree `templates/contextkit/` is deliberately NOT skipped.
 */
async function checkDocLinks(rep, KIT) {
  const { ok, bad } = rep;
  console.log('Checking cross-doc markdown links resolve (ADR-0030)...');
  const linkRe = /\[[^\]]*\]\(([^)]+)\)/g;
  const dogfoodDir = resolve(KIT, 'contextkit');
  const files = [...(await topLevelMd(resolve(KIT, 'templates/contextkit'))), ...(await listMdFiles(resolve(KIT, 'docs')))];
  const offenders = [];
  let checked = 0;
  for (const file of files) {
    if (file.endsWith('CHANGELOG.md')) continue;
    const text = await readFile(file, 'utf-8').catch(() => '');
    let m;
    while ((m = linkRe.exec(text))) {
      let target = m[1].trim().split(/\s+/)[0]; // drop an optional "title"
      if (!target || target.startsWith('http') || target.startsWith('#') || target.startsWith('<') || target.startsWith('mailto')) continue;
      target = target.split('#')[0]; // strip an anchor
      if (!target.endsWith('.md') || target.endsWith('CHANGELOG.md')) continue;
      const abs = resolve(dirname(file), target);
      const fromDogfood = relative(dogfoodDir, abs); // '' or no leading '..' ⇒ inside the gitignored install
      if (fromDogfood === '' || !fromDogfood.startsWith('..')) continue;
      checked += 1;
      if (!existsSync(abs)) offenders.push(`${relative(KIT, file).replaceAll('\\', '/')} → ${target}`);
    }
  }
  offenders.length === 0
    ? ok(`cross-doc markdown links resolve (${checked} checked)`)
    : offenders.forEach((o) => bad(`dangling doc link: ${o}`));
}

/**
 * ADR-0031 — enforce the zero-runtime-dependency invariant (rule 1) as a TEST, not
 * a promise: `package.json` must declare no `dependencies`. `zod` is optional and
 * lives behind a dynamic import / optionalDependencies, never a hard runtime dep.
 */
async function checkZeroRuntimeDeps(rep, KIT) {
  const { ok, bad } = rep;
  console.log('Checking the zero-runtime-dependency invariant (rule 1)...');
  let pkg = {};
  try {
    pkg = JSON.parse(await readFile(resolve(KIT, 'package.json'), 'utf-8'));
  } catch {
    /* unreadable — handled below */
  }
  const deps = Object.keys(pkg.dependencies || {});
  deps.length === 0
    ? ok('package.json declares zero runtime dependencies (rule 1)')
    : bad(`runtime dependencies present (rule 1 violated): ${deps.join(', ')}`);
}

/**
 * Every `bin` target must EXIST and be PUBLISHED (covered by `files`). A bin pointing
 * at a gitignored / files-excluded path ships a broken global command — npm only
 * warns ("No bin file found"), so it slips through. Caught the `agy` → root `ctx.mjs`
 * (dogfood, never in the tarball) regression [bug 097].
 */
async function checkBinTargets(rep, KIT) {
  const { ok, bad } = rep;
  console.log('Checking package.json bin targets exist + are published...');
  let pkg = {};
  try {
    pkg = JSON.parse(await readFile(resolve(KIT, 'package.json'), 'utf-8'));
  } catch {
    bad('package.json unreadable — cannot verify bin targets');
    return;
  }
  const files = pkg.files || [];
  const isPublished = (p) => files.some((f) => f === p || p.startsWith(f.endsWith('/') ? f : `${f}/`));
  for (const [name, target] of Object.entries(pkg.bin || {})) {
    if (!existsSync(resolve(KIT, target))) bad(`bin "${name}" → ${target} does not exist`);
    else if (!isPublished(target)) bad(`bin "${name}" → ${target} is NOT covered by package.json files (won't ship)`);
    else ok(`bin "${name}" → ${target} exists + ships`);
  }
}

/**
 * Drift-guard (ticket 084 + 140): templates/antigravity is GENERATED from
 * templates/claude (+ contextkit/workflows) by `npm run build:antigravity`.
 * Two layers:
 *   1. NAME parity — every Claude command/agent has its Antigravity twin at
 *      the same relative path, no orphans (a top-level README.md is the one
 *      allowed extra).
 *   2. CONTENT parity (ticket 140) — each twin is byte-identical to an
 *      in-memory conversion of the current Claude source through the SAME
 *      convert-core functions convert-all.mjs uses. Name parity alone let
 *      body edits ship a stale host with CI green.
 */
async function checkAntigravityParity(rep, KIT) {
  const { ok, bad } = rep;
  console.log('Checking templates/antigravity tracks templates/claude (ticket 084 + 140)...');
  let core = null;
  try {
    core = await import(
      pathToFileURL(resolve(KIT, 'templates/contextkit/runtime/antigravity/convert-core.mjs')).href
    );
  } catch (err) {
    bad(`convert-core.mjs unimportable — content-parity gate cannot run: ${err.message}`);
  }
  const listMd = async (dir, base = dir) => {
    let out = [];
    let entries = [];
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return out;
    }
    for (const e of entries) {
      const full = resolve(dir, e.name);
      if (e.isDirectory()) out = out.concat(await listMd(full, base));
      else if (e.name.endsWith('.md')) out.push(relative(base, full).replaceAll('\\', '/'));
    }
    return out;
  };
  const pairs = [
    ['templates/claude/commands', 'templates/antigravity/skills', (f) => f !== 'README.md', core?.convertCommandToSkill],
    ['templates/claude/agents', 'templates/antigravity/agents', () => true, core?.convertAgentToPersona],
  ];
  for (const [srcRel, dstRel, includeSrc, convert] of pairs) {
    const src = (await listMd(resolve(KIT, srcRel))).filter(includeSrc);
    const dst = await listMd(resolve(KIT, dstRel));
    const missing = src.filter((f) => !dst.includes(f));
    const orphans = dst.filter((f) => {
      if (f === 'README.md') return false;
      if (src.includes(f)) return false;
      // Accept flat root duplicates of nested files in templates/antigravity/skills
      return !src.some((s) => basename(s) === f);
    });
    missing.length === 0 && orphans.length === 0
      ? ok(`${dstRel} tracks ${srcRel} 1:1 (${src.length} file(s))`)
      : bad(
          `${dstRel} drifted from ${srcRel} — run \`npm run build:antigravity\`` +
            (missing.length ? `; missing: ${missing.slice(0, 5).join(', ')}${missing.length > 5 ? '…' : ''}` : '') +
            (orphans.length ? `; orphans: ${orphans.slice(0, 5).join(', ')}${orphans.length > 5 ? '…' : ''}` : ''),
        );

    // Layer 2 (ticket 140): regenerate each twin in memory and demand identity.
    if (!convert) continue; // core unimportable already reported above — skip ≠ pass
    const stale = [];
    for (const rel of src.filter((f) => dst.includes(f))) {
      const raw = await readFile(resolve(KIT, srcRel, rel), 'utf-8').catch(() => null);
      const twin = await readFile(resolve(KIT, dstRel, rel), 'utf-8').catch(() => null);
      if (raw === null || twin === null || convert(raw, rel) !== twin) stale.push(rel);
    }
    stale.length === 0
      ? ok(`${dstRel} content matches an in-memory rebuild of ${srcRel} (ticket 140)`)
      : bad(
          `${dstRel} content is STALE vs ${srcRel} — run \`npm run build:antigravity\`; ` +
            `stale: ${stale.slice(0, 5).join(', ')}${stale.length > 5 ? ` …+${stale.length - 5}` : ''}`,
        );
  }
}

/** Runs every source/structural check in order. `ctx` = { KIT }. */
export async function runSourceChecks(rep, { KIT }) {
  await checkSourceInvariants(rep, KIT);
  await checkNoHardcodedPaths(rep, KIT);
  await checkWorkflowsPinned(rep, KIT);
  await checkDocLinks(rep, KIT);
  await checkZeroRuntimeDeps(rep, KIT);
  await checkBinTargets(rep, KIT);
  await checkAntigravityParity(rep, KIT);
}
