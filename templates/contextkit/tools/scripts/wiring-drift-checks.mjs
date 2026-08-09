/**
 * Wiring-drift dimension checkers (CDK-068, PKG-06).
 *
 * Responsible for the I/O-bearing per-dimension checks that `wiring-drift.mjs`
 * orchestrates. Each function loads installed artifacts (fail-open: a missing or
 * unreadable artifact → a 'skipped' row, never a thrown error or false-pass) and
 * delegates comparison to the pure core (`wiring-drift-core.mjs`).
 *
 * Split from `wiring-drift.mjs` at the I/O-vs-rendering seam so both files
 * stay within the 280-line principle (≤308 hard limit).
 *
 * Rule 4: no 'contextkit/...' literal in resolve()/join() calls. Paths are
 * computed via pathsFor() / import.meta.url-relative resolution or the
 * PLATFORM_DIR constant.
 *
 * @module wiring-drift-checks
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { diffWiring, diffConfigKeys, checkInstructionMarkers } from './wiring-drift-core.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Resolved runtime path relative to this script's position in the tree.
// tools/scripts → ../../runtime. Rule 4: no platform dir literal.
const RUNTIME = resolve(__dirname, '..', '..', 'runtime');
const COMPOSE_PATH  = resolve(RUNTIME, 'config', 'settings-compose.mjs');
const PATHS_PATH    = resolve(RUNTIME, 'config', 'paths.mjs');
const DEFAULTS_PATH = resolve(RUNTIME, 'config', 'defaults.mjs');

/** Hook command prefix — mirrors HOOK_PREFIX in host-parity-core. */
const HOOK_PREFIX = 'contextkit/runtime/hooks/';

/** Required CLAUDE.md managed markers (section-heading presence check only). */
const REQUIRED_CLAUDE_MARKERS = [
  '## Stack',
  '## ⛔ Immutable rules',
  '## 🤖 ContextDevKit',
];

// ────────────────────────────────────────────────────────────────────────────
// Shared I/O helpers (fail-open)
// ────────────────────────────────────────────────────────────────────────────

/**
 * Dynamically imports a module by absolute path; returns null on failure.
 *
 * @param {string} absPath
 * @returns {Promise<Record<string, any> | null>}
 */
async function tryImport(absPath) {
  try { return await import(pathToFileURL(absPath).href); }
  catch { return null; }
}

/**
 * Reads and JSON-parses a file, stripping a leading UTF-8 BOM. Returns null on any
 * failure (missing file, malformed JSON).
 *
 * @param {string} absPath
 * @returns {Record<string, any> | null}
 */
function tryReadJson(absPath) {
  try { return JSON.parse(readFileSync(absPath, 'utf-8').replace(/^﻿/, '')); }
  catch { return null; }
}

/**
 * Reads a text file; returns null on any failure.
 *
 * @param {string} absPath
 * @returns {string | null}
 */
function tryReadText(absPath) {
  try { return readFileSync(absPath, 'utf-8'); }
  catch { return null; }
}

// ────────────────────────────────────────────────────────────────────────────
// Types and factory
// ────────────────────────────────────────────────────────────────────────────

/**
 * @typedef {{ dimension: string, item: string, status: string, detail?: string }} DriftRow
 */

/**
 * Creates a 'skipped' row (artifact missing or unreadable — fail-open).
 *
 * @param {string} dimension
 * @param {string} reason
 * @returns {DriftRow}
 */
function skippedRow(dimension, reason) {
  return { dimension, item: dimension, status: 'skipped', detail: reason };
}

// ────────────────────────────────────────────────────────────────────────────
// Extractor (shared pattern with host-parity-core)
// ────────────────────────────────────────────────────────────────────────────

/**
 * Extracts hook script basenames from a composed or installed settings object.
 * Shape: `{ hooks: { [event]: [ { hooks: [{command}] } ] } }`
 *
 * @param {Record<string, any>} settings
 * @returns {Set<string>}
 */
function extractBasenames(settings) {
  const scripts = new Set();
  const hooks = settings?.hooks;
  if (!hooks || typeof hooks !== 'object') return scripts;
  for (const eventEntries of Object.values(hooks)) {
    if (!Array.isArray(eventEntries)) continue;
    for (const group of eventEntries) {
      for (const hook of group?.hooks ?? []) {
        const cmd = String(hook?.command ?? '');
        const idx = cmd.indexOf(HOOK_PREFIX);
        if (idx === -1) continue;
        const afterPrefix = cmd.slice(idx + HOOK_PREFIX.length).split(' ')[0].trim();
        if (afterPrefix) scripts.add(afterPrefix);
      }
    }
  }
  return scripts;
}

// ────────────────────────────────────────────────────────────────────────────
// Dimension checkers
// ────────────────────────────────────────────────────────────────────────────

/**
 * Resolves the effective level from the installed config (fallback: 2).
 *
 * @param {string} root project root
 * @returns {Promise<number>}
 */
export async function resolveLevel(root) {
  const pathsMod = await tryImport(PATHS_PATH);
  const configPath = pathsMod?.pathsFor
    ? pathsMod.pathsFor(root).config
    : resolve(root, (pathsMod?.PLATFORM_DIR ?? 'contextkit'), 'config.json');
  const cfg = tryReadJson(configPath);
  return Number(cfg?.level) || 2;
}

/**
 * Dimension 1 — Wiring drift.
 *
 * Compares hook script basenames from `composeSettings(null, level)` (source
 * expectation) against those extracted from the installed `.claude/settings.json`.
 *
 * @param {string} root project root
 * @param {number} level active level (1–7)
 * @returns {Promise<DriftRow[]>}
 */
export async function checkWiringDrift(root, level) {
  const composerMod = await tryImport(COMPOSE_PATH);
  if (!composerMod?.composeSettings) {
    return [skippedRow('wiring', 'composer (settings-compose.mjs) could not be loaded')];
  }
  const expected = extractBasenames(composerMod.composeSettings(null, level));

  const settingsPath = resolve(root, '.claude', 'settings.json');
  if (!existsSync(settingsPath)) {
    return [skippedRow('wiring', '.claude/settings.json not found in project root')];
  }
  const installedSettings = tryReadJson(settingsPath);
  if (!installedSettings) {
    return [skippedRow('wiring', '.claude/settings.json could not be parsed')];
  }

  const installed = extractBasenames(installedSettings);
  const { missing, unexpected } = diffWiring(expected, installed);
  const rows = [];

  if (missing.length === 0 && unexpected.length === 0) {
    rows.push({ dimension: 'wiring', item: 'hook scripts', status: 'ok',
      detail: `${expected.size} expected, ${installed.size} installed — no drift` });
  }
  for (const script of missing) {
    rows.push({ dimension: 'wiring', item: script, status: 'missing',
      detail: `expected at level ${level} but absent from installed settings.json` });
  }
  for (const script of unexpected) {
    rows.push({ dimension: 'wiring', item: script, status: 'unexpected',
      detail: 'present in installed settings.json but not expected by source composer at this level' });
  }
  return rows;
}

/**
 * Dimension 2 — Config drift.
 *
 * Compares top-level keys of the installed `contextkit/config.json` against the
 * DEFAULT_CONFIG key set.
 *
 * @param {string} root project root
 * @returns {Promise<DriftRow[]>}
 */
export async function checkConfigDrift(root) {
  const defaultsMod = await tryImport(DEFAULTS_PATH);
  if (!defaultsMod?.DEFAULT_CONFIG) {
    return [skippedRow('config', 'defaults.mjs could not be loaded — known keys unavailable')];
  }
  const knownKeys = new Set(Object.keys(defaultsMod.DEFAULT_CONFIG));

  const pathsMod = await tryImport(PATHS_PATH);
  const configPath = pathsMod?.pathsFor
    ? pathsMod.pathsFor(root).config
    : resolve(root, (pathsMod?.PLATFORM_DIR ?? 'contextkit'), 'config.json');

  if (!existsSync(configPath)) {
    return [skippedRow('config', 'contextkit/config.json not found in project root')];
  }
  const installedConfig = tryReadJson(configPath);
  if (!installedConfig) {
    return [skippedRow('config', 'contextkit/config.json could not be parsed')];
  }

  const installedKeys = new Set(Object.keys(installedConfig));
  const { unknown, missing } = diffConfigKeys(installedKeys, knownKeys);
  const rows = [];

  // Only UNKNOWN keys are genuine config drift (a stale/removed key or a typo).
  // Absent-but-defaulted keys are NOT drift: config.json is partial-by-design and
  // every absent key falls back to DEFAULT_CONFIG at runtime. Counting those as
  // drift floods the advisory with false positives, so the defaulted keys are
  // surfaced only as an informational count on the 'ok' row.
  if (unknown.length === 0) {
    rows.push({ dimension: 'config', item: 'config keys', status: 'ok',
      detail: `${installedKeys.size} key(s) present, ${missing.length} using DEFAULT_CONFIG default(s) — no drift` });
  } else {
    for (const key of unknown) {
      rows.push({ dimension: 'config', item: key, status: 'unknown-key',
        detail: 'present in installed config.json but absent from DEFAULT_CONFIG — stale key or custom extension' });
    }
  }
  return rows;
}

/**
 * Dimension 3 — Instruction drift.
 *
 * Checks the installed `CLAUDE.md` for the presence of required managed-section
 * markers. Lightweight substring check only — no content-equivalence comparison
 * to avoid false positives from user customisations.
 *
 * @param {string} root project root
 * @returns {DriftRow[]}
 */
export function checkInstructionDrift(root) {
  const claudeMdPath = resolve(root, 'CLAUDE.md');
  if (!existsSync(claudeMdPath)) {
    return [skippedRow('instruction', 'CLAUDE.md not found in project root')];
  }
  const text = tryReadText(claudeMdPath);
  if (text === null) {
    return [skippedRow('instruction', 'CLAUDE.md could not be read')];
  }

  const rows = [];
  const { missing } = checkInstructionMarkers(text, REQUIRED_CLAUDE_MARKERS);
  if (missing.length === 0) {
    rows.push({ dimension: 'instruction', item: 'CLAUDE.md markers', status: 'ok',
      detail: `all ${REQUIRED_CLAUDE_MARKERS.length} required markers found` });
  }
  for (const marker of missing) {
    rows.push({ dimension: 'instruction', item: marker, status: 'missing-marker',
      detail: 'required managed section not found in CLAUDE.md — may indicate an outdated install' });
  }
  return rows;
}
