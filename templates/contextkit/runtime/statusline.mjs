#!/usr/bin/env node
/**
 * Status-line widget for Claude Code (wired as `settings.statusLine` at level >= 1).
 *
 * Prints ONE compact line about the ContextDevKit state of the current project:
 *   🌀 L6 · 11 sess · 5 ADR · 2 bklog
 *
 * It runs on every prompt, so it stays cheap (a few directory counts + one config
 * read) and zero-dependency. It NEVER throws — on any error it prints a minimal
 * fallback so the status line can't break the session. Claude Code pipes session
 * JSON on stdin; we don't need it (we read the project at `process.cwd()`).
 */
import { existsSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathsFor } from './config/paths.mjs';
import { readAutonomyOverride, resolveAutonomy } from './config/resolve-autonomy.mjs';
import { readJsonSafe } from './hooks/safe-io.mjs';

const ROOT = process.cwd();
const P = pathsFor(ROOT);

function count(dir, re) {
  try {
    return readdirSync(resolve(ROOT, dir)).filter((f) => re.test(f)).length;
  } catch {
    return 0;
  }
}

function level() {
  const lvl = Number(readJsonSafe(P.config, {}).level);
  return Number.isInteger(lvl) ? lvl : null;
}

/** Effective dial grade for display — derived from the resolver (ADR-0042 §6:
 * displayed grade ≡ enforced grade); degrades to null, never breaks the line. */
function autonomyGrade() {
  try {
    return resolveAutonomy('edit', readJsonSafe(P.config, {}), readAutonomyOverride(ROOT)).grade;
  } catch {
    return null;
  }
}

function main() {
  try {
    if (!existsSync(P.platform)) {
      process.stdout.write('🌀 contextdevkit');
      return;
    }
    const lvl = level();
    const sess = count('contextkit/memory/sessions', /^\d{4}-\d{2}-\d{2}-\d{2,}-.+\.md$/);
    const adrs = count('contextkit/memory/decisions', /^\d{4}-.+\.md$/);
    const bklog = count('contextkit/pipeline/backlog', /\.md$/);
    const grade = autonomyGrade();
    const parts = [lvl ? `L${lvl}` : null, grade ? `A${grade}` : null, `${sess} sess`, `${adrs} ADR`, `${bklog} bklog`].filter(Boolean);
    process.stdout.write(`🌀 ${parts.join(' · ')}`);
  } catch {
    process.stdout.write('🌀 contextdevkit');
  }
}

main();
