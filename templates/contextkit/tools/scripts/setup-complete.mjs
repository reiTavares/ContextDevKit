#!/usr/bin/env node
/**
 * Marks ContextDevKit onboarding complete (stops the first-run trigger) and,
 * optionally, applies stack-tuned config produced by `detect-stack.mjs`.
 *
 * Usage:
 *   node contextkit/tools/scripts/setup-complete.mjs
 *       -> just flips config.setup.completed = true
 *
 *   node contextkit/tools/scripts/setup-complete.mjs --detect
 *       -> runs detect-stack.mjs itself and merges its suggestions, then flips
 *          the flag. Preferred -- avoids shell-redirect encoding pitfalls.
 *
 *   node contextkit/tools/scripts/setup-complete.mjs --apply <report.json>
 *       -> merges suggestions from a pre-generated report file, then flips.
 *
 * Keeping this in a script (not free-form JSON editing) guarantees the config
 * stays valid -- the file is the contract the hooks read.
 *
 * PMB-02: after completing setup, generates the project-map baseline when the
 * project has source files (skip on greenfield). Fail-open -- a generation
 * failure never prevents the setup flag from being written.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseJsonSafe, readJsonSafe } from '../../runtime/hooks/safe-io.mjs';
import { pathsFor } from '../../runtime/config/paths.mjs';

const ROOT = process.cwd();
const PATHS = pathsFor(ROOT);
const CONFIG = PATHS.config;

const readJson = (path, fallback = null) => readJsonSafe(path, fallback);

/**
 * Returns true when the project has recognisable source (i.e. is not greenfield).
 * Mirrors the heuristic from detect-stack.mjs: greenfield means no known source
 * directory (src/, app/, apps/, ...) AND no language-indicator config file.
 * Root-level kit bridge files (cdx.mjs, ctx.mjs) are intentionally ignored.
 * @returns {boolean}
 */
function hasSourceFiles() {
  const SOURCE_DIRS = [
    'src', 'app', 'apps', 'packages', 'lib', 'components', 'pages',
    'server', 'client', 'cmd', 'internal', 'pkg', 'tests', 'test', 'spec',
    'api', 'core', 'modules',
  ];
  const LANG_INDICATORS = [
    'package.json', 'tsconfig.json', 'tsconfig.base.json',
    'pyproject.toml', 'requirements.txt', 'setup.py', 'go.mod',
    'Cargo.toml', 'pom.xml', 'build.gradle', 'build.gradle.kts',
    'Gemfile', 'composer.json',
  ];

  const hasSourceDir = SOURCE_DIRS.some((d) => {
    try { return readdirSync(resolve(ROOT, d)).length > 0; } catch { return false; }
  });
  if (hasSourceDir) return true;

  return LANG_INDICATORS.some((f) => existsSync(resolve(ROOT, f)));
}

/**
 * Generates the project-map baseline when the project has source files and one
 * does not already exist. Fail-open: any error is reported but never throws.
 * @returns {void}
 */
function maybeGenerateBaseline() {
  const manifestPath = resolve(PATHS.projectMap, 'manifest.json');
  if (existsSync(manifestPath)) {
    console.log('info  Project-map baseline already present -- skipping generation.');
    return;
  }
  if (!hasSourceFiles()) {
    console.log('info  Greenfield project -- skipping project-map baseline generation.');
    return;
  }
  try {
    execFileSync('node', ['contextkit/tools/scripts/project-map.mjs'], { cwd: ROOT, encoding: 'utf-8', stdio: 'inherit' });
  } catch (err) {
    console.error(`warn  project-map baseline generation failed (setup still complete): ${err?.message ?? err}`);
  }
}

function runDetector() {
  try {
    const out = execFileSync('node', ['contextkit/tools/scripts/detect-stack.mjs'], { cwd: ROOT, encoding: 'utf-8' });
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
      if (!Array.isArray(cfg.ledger.registration)) cfg.ledger.registration = ['contextkit/memory/SESSIONS.md', 'docs/CHANGELOG.md'];
      cfg.l5 = cfg.l5 || {};
      if (Array.isArray(suggested.highRiskPaths)) cfg.l5.highRiskPaths = suggested.highRiskPaths;
      cfg.qa = cfg.qa || {};
      if (Array.isArray(suggested.qaCriticalPaths)) cfg.qa.criticalPaths = suggested.qaCriticalPaths;
      console.log(`Applied suggestions: ${cfg.ledger.important.length} important paths, ${cfg.l5.highRiskPaths.length} high-risk paths, ${(cfg.qa.criticalPaths || []).length} qa-critical paths.`);
    } else {
      console.log('No report supplied or report had no suggestions -- only flipping setup flag.');
    }
  }

  cfg.setup = { ...(cfg.setup || {}), completed: true, completedAt: new Date().toISOString() };
  writeFileSync(CONFIG, JSON.stringify(cfg, null, 2) + '\n', 'utf-8');
  console.log('OK  ContextDevKit setup marked complete. The first-run trigger will no longer fire.');

  try {
    execFileSync('node', ['contextkit/tools/scripts/squad.mjs', 'generate-playbooks'], { cwd: ROOT });
  } catch (err) {
    /* fail-silent */
  }

  maybeGenerateBaseline();
}

main();
