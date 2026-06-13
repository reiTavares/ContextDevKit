#!/usr/bin/env node
/**
 * pre-commit git hook (Level >= 3).
 *
 * Goal: keep the derived indices (`contextkit/memory/SESSIONS.md` and
 * `WORKSPACE.md`) in sync with their source-of-truth files, FAST (< 1s).
 * Heavy validation (type-check, lint, tests) belongs in CI, not here.
 *
 * Invoked by `.git/hooks/pre-commit` (a thin wrapper the installer drops).
 * Bypass: `git commit --no-verify`.
 */
import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadConfigSync } from '../config/load.mjs';
import { pathsFor } from '../config/paths.mjs';

const ROOT = process.cwd();
const P = pathsFor(ROOT);

/** Source extensions the project-map counts — gates the auto-refresh (ADR-0046). */
const MAP_SOURCE_RE = /\.(ts|tsx|js|jsx|mjs|cjs|vue|svelte|py|go|rs|java|kt|rb|php|cs|sql)$/;

function safeRun(cmd) {
  try {
    execSync(cmd, { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'], timeout: 10_000 });
  } catch {
    /* never block the commit on a derived-doc regen failure */
  }
}

/** True when the staged changeset touches a mapped source file (else skip the scan). */
function stagedTouchesSource() {
  try {
    return execSync('git diff --cached --name-only', { cwd: ROOT, encoding: 'utf-8', timeout: 5_000 })
      .split('\n')
      .some((f) => MAP_SOURCE_RE.test(f.trim()));
  } catch {
    return false;
  }
}

function main() {
  console.log('› pre-commit: regenerating derived docs...');

  if (existsSync(resolve(ROOT, 'docs'))) {
    safeRun('node contextkit/tools/scripts/docs-refresh.mjs');
    safeRun('git add docs/README.md docs/tutorials/README.md docs/how-to/README.md docs/reference/README.md docs/explanation/README.md');
  }
  if (existsSync(P.sessions)) {
    safeRun('node contextkit/tools/scripts/session-reindex.mjs');
    safeRun('git add contextkit/memory/SESSIONS.md');
  }
  if (existsSync(P.deliberations)) {
    safeRun('node contextkit/tools/scripts/deliberations-reindex.mjs');
    safeRun('git add contextkit/memory/DELIBERATIONS.md');
  }
  if (existsSync(resolve(ROOT, '.claude/.workspace'))) {
    safeRun('node contextkit/tools/scripts/workspace-sync.mjs');
    safeRun('git add contextkit/memory/WORKSPACE.md');
  }
  if (existsSync(P.pipeline)) {
    safeRun('node contextkit/tools/scripts/pipeline.mjs sync');
    safeRun('git add contextkit/pipeline/devpipeline.md contextkit/pipeline/known-bugs.md');
  }
  // Project-map auto-refresh (ADR-0046) — grade-blind derived doc, like the indices
  // above. Only when a map already exists, the staged changeset touches source, and
  // the toggle is on. Deterministic ⇒ no-op stage when nothing structural changed.
  if (existsSync(resolve(P.projectMap, 'manifest.json')) && loadConfigSync(ROOT)?.projectMap?.autoRefresh !== false && stagedTouchesSource()) {
    safeRun('node contextkit/tools/scripts/project-map.mjs');
    safeRun('git add contextkit/memory/project-map');
  }

  console.log('✓ pre-commit done.');
}

main();
