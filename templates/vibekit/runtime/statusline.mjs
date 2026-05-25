#!/usr/bin/env node
/**
 * Status-line widget for Claude Code (wired as `settings.statusLine` at level >= 1).
 *
 * Prints ONE compact line about the VibeDevKit state of the current project:
 *   🌀 L6 · 11 sess · 5 ADR · 2 bklog
 *
 * It runs on every prompt, so it stays cheap (a few directory counts + one config
 * read) and zero-dependency. It NEVER throws — on any error it prints a minimal
 * fallback so the status line can't break the session. Claude Code pipes session
 * JSON on stdin; we don't need it (we read the project at `process.cwd()`).
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = process.cwd();

function count(dir, re) {
  try {
    return readdirSync(resolve(ROOT, dir)).filter((f) => re.test(f)).length;
  } catch {
    return 0;
  }
}

function level() {
  try {
    const lvl = Number(JSON.parse(readFileSync(resolve(ROOT, 'vibekit/config.json'), 'utf-8').replace(/^﻿/, '')).level);
    return Number.isInteger(lvl) ? lvl : null;
  } catch {
    return null;
  }
}

function main() {
  try {
    if (!existsSync(resolve(ROOT, 'vibekit'))) {
      process.stdout.write('🌀 vibedevkit');
      return;
    }
    const lvl = level();
    const sess = count('vibekit/memory/sessions', /^\d{4}-\d{2}-\d{2}-\d{2,}-.+\.md$/);
    const adrs = count('vibekit/memory/decisions', /^\d{4}-.+\.md$/);
    const bklog = count('vibekit/pipeline/backlog', /\.md$/);
    const parts = [lvl ? `L${lvl}` : null, `${sess} sess`, `${adrs} ADR`, `${bklog} bklog`].filter(Boolean);
    process.stdout.write(`🌀 ${parts.join(' · ')}`);
  } catch {
    process.stdout.write('🌀 vibedevkit');
  }
}

main();
