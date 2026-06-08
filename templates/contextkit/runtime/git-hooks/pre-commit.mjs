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
import { pathsFor } from '../config/paths.mjs';

const ROOT = process.cwd();
const P = pathsFor(ROOT);

function safeRun(cmd) {
  try {
    execSync(cmd, { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'], timeout: 10_000 });
  } catch {
    /* never block the commit on a derived-doc regen failure */
  }
}

function main() {
  console.log('› pre-commit: regenerating derived docs...');

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

  console.log('✓ pre-commit done.');
}

main();
