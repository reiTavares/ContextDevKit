/**
 * Self-check — SOURCE / STRUCTURAL invariants.
 *
 * Owns the static-pattern checks that scan SHIPPED source files for
 * properties that would silently regress if removed:
 *   - `checkSourceInvariants`  — required patterns per file (timeouts,
 *     atomic writes, sid sanitization, single-sourced labels, etc.).
 *   - `checkNoHardcodedPaths`  — rule 4 enforcement (no `vibekit/` path
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
import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';

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
  const cases = [
    ['network git calls time out (git.mjs)', 'templates/vibekit/tools/scripts/git.mjs', /timeout:\s*\w/],
    ['network git calls time out (pre-push.mjs)', 'templates/vibekit/runtime/git-hooks/pre-push.mjs', /timeout:\s*\w/],
    ['ledger writes are atomic', 'templates/vibekit/runtime/hooks/ledger.mjs', /writeFileAtomic/],
    ['pipeline writers are atomic', 'templates/vibekit/tools/scripts/pipeline.mjs', /writeFileAtomicSync/],
    ['workspace-sync write is atomic', 'templates/vibekit/tools/scripts/workspace-sync.mjs', /writeFileAtomic/],
    ['pipeline allocates ids with exclusive create', 'templates/vibekit/tools/scripts/pipeline.mjs', /flag:\s*'wx'/],
    ['claim sanitizes the session id', 'templates/vibekit/tools/scripts/claim.mjs', /sanitizeSid/],
    ['release sanitizes the session id', 'templates/vibekit/tools/scripts/release.mjs', /sanitizeSid/],
    ['track-edits sanitizes the session id', 'templates/vibekit/runtime/hooks/track-edits.mjs', /sanitizeSid/],
    ['session-start guards live ledgers from deletion', 'templates/vibekit/runtime/hooks/session-start.mjs', /maybeLive/],
    ['config schema is passthrough', 'templates/vibekit/runtime/config/schema.mjs', /\.passthrough\(\)/],
    ['config schema bounds level by MAX_LEVEL', 'templates/vibekit/runtime/config/schema.mjs', /max\(MAX_LEVEL\)/],
    ['installer labels single-sourced from levels.mjs', 'tools/install/cli.mjs', /levels\.mjs/],
    ['vibe-level labels single-sourced from levels.mjs', 'templates/vibekit/tools/scripts/vibe-level.mjs', /levels\.mjs/],
    ['squad detection single-sourced (squad.mjs)', 'templates/vibekit/tools/scripts/squad.mjs', /squad-meta/],
    ['squad detection single-sourced (agent-tuning.mjs)', 'templates/vibekit/tools/scripts/agent-tuning.mjs', /squad-meta/],
    ['installer backs up an existing git hook', 'tools/install/git.mjs', /\.bak/],
    ['agent-forge yaml loader uses optional dynamic import', 'templates/vibekit/squads/agent-forge/lib/yaml.mjs', /import\(\s*['"]yaml['"]\s*\)/],
    ['installer copies the agent-forge squad at L>=4', 'install.mjs', /copyTree\(join\(TPL, 'vibekit', 'squads', 'agent-forge'\)/],
    ['installer copies curated-stack starters', 'install.mjs', /copyTree\(join\(TPL, 'vibekit', 'starters'\)/],
    ['detect-stack recognises TanStack family', 'templates/vibekit/tools/scripts/detect-stack.mjs', /@tanstack\/react-router/],
    ['tanstack playbook present', 'templates/vibekit/workflows/playbooks/tanstack.md', /Playbook — TanStack/],
    ['tanstack starter declares react-router dep', 'templates/vibekit/starters/tanstack/package.json', /@tanstack\/react-router/],
    ['tanstack starter declares react-query dep', 'templates/vibekit/starters/tanstack/package.json', /@tanstack\/react-query/],
    ['tanstack starter mounts QueryClientProvider', 'templates/vibekit/starters/tanstack/src/main.tsx', /QueryClientProvider/],
    ['tanstack starter mounts RouterProvider', 'templates/vibekit/starters/tanstack/src/main.tsx', /RouterProvider/],
  ];
  for (const [label, rel, re] of cases) {
    re.test(await srcText(rel)) ? ok(label) : bad(`${label} — pattern ${re} missing in ${rel}`);
  }
}

/** Rule 4: no shipped runtime/script constructs a `vibekit/` path via resolve/join. */
async function checkNoHardcodedPaths(rep, KIT) {
  const { ok, bad } = rep;
  console.log('Checking platform paths are single-sourced (rule 4)...');
  const re = /\b(resolve|join)\(.*['"]vibekit\//;
  const offenders = [];
  for (const d of ['templates/vibekit/runtime', 'templates/vibekit/tools/scripts']) {
    for (const file of await listMjs(resolve(KIT, d))) {
      const lines = (await readFile(file, 'utf-8').catch(() => '')).split('\n');
      lines.forEach((line, i) => {
        if (/^\s*(\*|\/\/)/.test(line)) return;
        if (re.test(line)) offenders.push(`${file.replace(KIT, '').replaceAll('\\', '/')}:${i + 1}`);
      });
    }
  }
  offenders.length === 0
    ? ok('no hardcoded vibekit/ path construction (all via pathsFor/PLATFORM_DIR)')
    : offenders.forEach((o) => bad(`hardcoded vibekit/ path: ${o}`));
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

/** Runs every source/structural check in order. `ctx` = { KIT }. */
export async function runSourceChecks(rep, { KIT }) {
  await checkSourceInvariants(rep, KIT);
  await checkNoHardcodedPaths(rep, KIT);
  await checkWorkflowsPinned(rep, KIT);
}
