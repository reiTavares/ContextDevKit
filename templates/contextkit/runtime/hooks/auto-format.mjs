/**
 * auto-format.mjs — PostToolUse format/lint hook (ADR-0061, parity import F1).
 *
 * WHY: keep code formatted+linted *in the session* (right after each Edit/Write)
 * instead of only at push time, so the agent never accumulates a "chore: format"
 * debt. It is ADVISORY: it auto-fixes when a toolchain is present and ALWAYS
 * exits 0 — a formatter problem must never break the agent's real work (rule 2).
 *
 * Zero runtime deps (rule 1): only `node:*`. Reuses the host-adapter to read the
 * edited path across Claude/Antigravity/Codex, and a stack/PM detection mirroring
 * `scaffold-tests.mjs`. Reports skipped (never a false pass/fail) when no tool is
 * found or the feature is disabled/below level (rule 8).
 *
 * Wiring: `PostToolUse Edit|Write|MultiEdit → auto-format.mjs` at level >= minLevel
 * (default 4), composed into the three hosts. Config: `autoFormat` in config.json.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { emitAdvisory, hookHost, normalizeToolPayload } from './host-adapter.mjs';

const ROOT = process.cwd();
const HOST = hookHost();

/** Reads the full hook payload from stdin (JSON). Returns {} on any problem. */
function readStdin() {
  try {
    const raw = readFileSync(0, 'utf-8');
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

/** Reads contextkit/config.json (BOM-safe). Returns {} when absent/invalid. */
function readConfig() {
  try {
    const file = join(ROOT, 'contextkit', 'config.json');
    if (!existsSync(file)) return {};
    return JSON.parse(readFileSync(file, 'utf-8').replace(/^﻿/, ''));
  } catch {
    return {};
  }
}

/** Reads a JSON file relative to ROOT (BOM-safe). Returns null when absent. */
function readJson(rel) {
  try {
    const file = join(ROOT, rel);
    if (!existsSync(file)) return null;
    return JSON.parse(readFileSync(file, 'utf-8').replace(/^﻿/, ''));
  } catch {
    return null;
  }
}

const has = (rel) => existsSync(join(ROOT, rel));

/** Detects the Node package manager from the committed lockfile. */
function detectPackageManager() {
  if (has('pnpm-lock.yaml')) return 'pnpm';
  if (has('yarn.lock')) return 'yarn';
  if (has('bun.lockb') || has('bun.lock')) return 'bun';
  return 'npm';
}

/** Builds the run-script invocation for a package manager. */
function pmRun(pm, script) {
  if (pm === 'npm') return ['npm', ['run', script]];
  if (pm === 'bun') return ['bun', ['run', script]];
  return [pm, [script]]; // pnpm <script> / yarn <script>
}

/** Returns true when the command exists on PATH. */
function commandExists(cmd) {
  const probe = process.platform === 'win32' ? spawnSync('where', [cmd]) : spawnSync('command', ['-v', cmd], { shell: true });
  return probe.status === 0;
}

/**
 * Resolves the [command, args] to run for the detected stack, or null when no
 * usable toolchain is present (→ skipped).
 */
function resolveCommand() {
  const pkg = readJson('package.json');
  if (pkg) {
    const scripts = pkg.scripts || {};
    const pm = detectPackageManager();
    if (scripts.format) return pmRun(pm, 'format');
    if (scripts['lint:fix']) return pmRun(pm, 'lint:fix');
    if (scripts.lint) {
      const [bin, base] = pmRun(pm, 'lint');
      return [bin, [...base, pm === 'npm' || pm === 'bun' ? '--' : '', '--fix'].filter(Boolean)];
    }
    return null;
  }
  if (has('go.mod') && commandExists('gofmt')) return ['gofmt', ['-w', '.']];
  if (has('pyproject.toml') || has('requirements.txt') || has('setup.py')) {
    if (commandExists('ruff')) return ['ruff', ['check', '--fix', '.']];
    if (commandExists('black')) return ['black', ['.']];
  }
  if (has('Cargo.toml') && commandExists('cargo')) return ['cargo', ['fmt']];
  return null;
}

/** True when `filePath` sits under any excluded prefix. */
function isExcluded(filePath, excludePaths) {
  const normalized = String(filePath).replace(/\\/g, '/');
  return excludePaths.some((prefix) => normalized.includes(prefix.replace(/\\/g, '/')));
}

function main() {
  const config = readConfig();
  const auto = config.autoFormat || {};
  const level = Number(config.level || 1);

  // Opt-out paths: disabled, or below the activation level. Silent (rule 8).
  if (auto.enabled === false) return;
  if (level < Number(auto.minLevel ?? 4)) return;

  const payload = readStdin();
  const { filePaths } = normalizeToolPayload(payload);
  if (!filePaths.length) return;

  const excludePaths = Array.isArray(auto.excludePaths) ? auto.excludePaths : [];
  if (filePaths.every((p) => isExcluded(p, excludePaths))) return;

  const resolved = resolveCommand();
  if (!resolved) return; // no toolchain → skipped, never an error

  const [cmd, args] = resolved;
  try {
    const run = spawnSync(cmd, args, { cwd: ROOT, timeout: 60_000, encoding: 'utf-8', shell: process.platform === 'win32' });
    if (run.status !== 0) {
      // Advisory only — never block (rule 2).
      emitAdvisory(`auto-format: ${cmd} reported issues (advisory, not blocking).\n`, HOST, 'PostToolUse');
    }
  } catch {
    /* never break the agent's work */
  }
}

try {
  main();
} catch {
  /* defensive: any failure is silent and non-blocking */
}
process.exit(0);
