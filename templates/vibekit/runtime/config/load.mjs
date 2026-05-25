/**
 * Zero-dependency config loader for VibeDevKit.
 *
 * Contract:
 *   - `loadConfig()` / `loadConfigSync()` MUST NEVER throw. Hooks depend on
 *     them and a broken config file cannot be allowed to block real work.
 *     On any failure they log to stderr and return the deep-merged defaults.
 *   - No third-party deps. JSON.parse + a small recursive merge only. This is
 *     what lets Levels 1–3 run in a project that has installed nothing.
 *   - Strict validation (zod) is OPTIONAL and lives in `schema.mjs`, used
 *     solely by `/vibe-config`. It is never imported on a hook path.
 */
import { existsSync, readFileSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { DEFAULT_CONFIG } from './defaults.mjs';
import { CONFIG_FILE } from './paths.mjs';

export function configPathFor(root = process.cwd()) {
  return resolve(root, CONFIG_FILE);
}

/**
 * Deep-merges a partial override onto a base object. Arrays REPLACE (so a
 * project can fully redefine `ledger.important`), objects merge recursively.
 *
 * @param {Record<string, any>} base
 * @param {Record<string, any>} override
 */
function deepMerge(base, override) {
  if (!override || typeof override !== 'object') return base;
  const out = Array.isArray(base) ? [...base] : { ...base };
  for (const [key, value] of Object.entries(override)) {
    if (
      value &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      out[key] &&
      typeof out[key] === 'object' &&
      !Array.isArray(out[key])
    ) {
      out[key] = deepMerge(out[key], value);
    } else {
      out[key] = value;
    }
  }
  return out;
}

function parseRaw(buf, path) {
  try {
    // Strip a leading UTF-8 BOM — common when a file is written by a Windows
    // editor or PowerShell's `Set-Content -Encoding utf8` (PS 5.1 adds one).
    return JSON.parse(buf.replace(/^﻿/, ''));
  } catch (err) {
    process.stderr.write(`[vibe-config] malformed JSON in ${path} — using defaults: ${err?.message ?? err}\n`);
    return null;
  }
}

/** Async load + deep-merge over defaults. Never throws. */
export async function loadConfig(root = process.cwd()) {
  const path = configPathFor(root);
  let buf;
  try {
    buf = await readFile(path, 'utf-8');
  } catch {
    return structuredClone(DEFAULT_CONFIG);
  }
  const raw = parseRaw(buf, path);
  if (raw === null) return structuredClone(DEFAULT_CONFIG);
  return deepMerge(structuredClone(DEFAULT_CONFIG), raw);
}

/** Synchronous variant for hooks that cannot await. Never throws. */
export function loadConfigSync(root = process.cwd()) {
  const path = configPathFor(root);
  if (!existsSync(path)) return structuredClone(DEFAULT_CONFIG);
  let buf;
  try {
    buf = readFileSync(path, 'utf-8');
  } catch {
    return structuredClone(DEFAULT_CONFIG);
  }
  const raw = parseRaw(buf, path);
  if (raw === null) return structuredClone(DEFAULT_CONFIG);
  return deepMerge(structuredClone(DEFAULT_CONFIG), raw);
}

/** Reads only the active level (1–7). Defensive — defaults to 2. */
export function getLevel(root = process.cwd()) {
  const lvl = Number(loadConfigSync(root)?.level);
  return Number.isInteger(lvl) && lvl >= 1 && lvl <= 7 ? lvl : 2;
}

/**
 * Persists a config object. Used by `/vibe-config set`. NOT defensive by
 * design — surfaces write errors so the slash command can report them.
 */
export async function writeConfig(candidate, root = process.cwd()) {
  const payload = `${JSON.stringify(candidate, null, 2)}\n`;
  await writeFile(configPathFor(root), payload, 'utf-8');
  return candidate;
}
