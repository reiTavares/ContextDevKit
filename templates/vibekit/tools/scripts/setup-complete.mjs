#!/usr/bin/env node
/**
 * Marks VibeDevKit onboarding complete (stops the first-run trigger) and,
 * optionally, applies stack-tuned config produced by `detect-stack.mjs`.
 *
 * Usage:
 *   node vibekit/tools/scripts/setup-complete.mjs
 *       → just flips config.setup.completed = true
 *
 *   node vibekit/tools/scripts/setup-complete.mjs --detect
 *       → runs detect-stack.mjs itself and merges its suggestions, then flips
 *         the flag. Preferred — avoids shell-redirect encoding pitfalls.
 *
 *   node vibekit/tools/scripts/setup-complete.mjs --apply <report.json>
 *       → merges suggestions from a pre-generated report file, then flips.
 *
 * Keeping this in a script (not free-form JSON editing) guarantees the config
 * stays valid — the file is the contract the hooks read.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseJsonSafe, readJsonSafe } from '../../runtime/hooks/safe-io.mjs';
import { pathsFor } from '../../runtime/config/paths.mjs';

const ROOT = process.cwd();
const CONFIG = pathsFor(ROOT).config;

const readJson = (path, fallback = null) => readJsonSafe(path, fallback);

function runDetector() {
  try {
    const out = execFileSync('node', ['vibekit/tools/scripts/detect-stack.mjs'], { cwd: ROOT, encoding: 'utf-8' });
    return parseJsonSafe(out, null);
  } catch (err) {
    console.error(`detect-stack failed: ${err?.message ?? err}`);
    return null;
  }
}

function main() {
  const cfg = existsSync(CONFIG) ? readJson(CONFIG, {}) : {};

  const detect = process.argv.includes('--detect');
  const applyIdx = process.argv.indexOf('--apply');
  if (detect || applyIdx !== -1) {
    const report = detect ? runDetector() : readJson(resolve(ROOT, process.argv[applyIdx + 1] ?? ''), null);
    const suggested = report?.suggested;
    if (suggested) {
      cfg.ledger = cfg.ledger || {};
      if (Array.isArray(suggested.ledger?.important)) cfg.ledger.important = suggested.ledger.important;
      if (Array.isArray(suggested.ledger?.irrelevant)) cfg.ledger.irrelevant = suggested.ledger.irrelevant;
      if (!Array.isArray(cfg.ledger.registration)) cfg.ledger.registration = ['vibekit/memory/SESSIONS.md', 'docs/CHANGELOG.md'];
      cfg.l5 = cfg.l5 || {};
      if (Array.isArray(suggested.highRiskPaths)) cfg.l5.highRiskPaths = suggested.highRiskPaths;
      cfg.qa = cfg.qa || {};
      if (Array.isArray(suggested.qaCriticalPaths)) cfg.qa.criticalPaths = suggested.qaCriticalPaths;
      console.log(`Applied suggestions: ${cfg.ledger.important.length} important paths, ${cfg.l5.highRiskPaths.length} high-risk paths, ${(cfg.qa.criticalPaths || []).length} qa-critical paths.`);
    } else {
      console.log('No report supplied or report had no suggestions — only flipping setup flag.');
    }
  }

  cfg.setup = { ...(cfg.setup || {}), completed: true, completedAt: new Date().toISOString() };
  writeFileSync(CONFIG, JSON.stringify(cfg, null, 2) + '\n', 'utf-8');
  console.log('✅ VibeDevKit setup marked complete. The first-run trigger will no longer fire.');
}

main();
