/**
 * MCP Project Manifest — atomic read/write for the per-project manifest file.
 *
 * Contract:
 *   - Read is fault-tolerant: a missing file returns an empty manifest.
 *   - Write is ATOMIC: tmp file written first, then renamed.
 *   - The manifest NEVER stores secret values — only secret NAMES.
 *   - A literal secret value in referencedSecrets causes an immediate throw.
 *   - Zero third-party dependencies (node:* only) — hot-path safe.
 *
 * @module manifest
 */
import { existsSync, readFileSync } from 'node:fs';
import { rename, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { PLATFORM_DIR } from '../config/paths.mjs';

/** Relative path to the manifest from the project root. */
const MANIFEST_REL = `${PLATFORM_DIR}/mcp/project-manifest.json`;

/**
 * Heuristic patterns that resemble secret values rather than secret NAMES.
 * Names are short identifiers (e.g. GITHUB_TOKEN). Values are long, contain
 * special characters, or match known token prefixes.
 *
 * This is a defence-in-depth check — the primary contract is that callers
 * never put values here; this guard catches accidents early.
 */
const SECRET_VALUE_PATTERNS = [
  /^gh[ps]_[A-Za-z0-9]{20,}$/,    // GitHub PAT (ghs_, ghp_) — min 20 chars after underscore
  /^sk-[A-Za-z0-9]{20,}$/,         // OpenAI-style API key
  /^xox[bpoa]-[0-9A-Za-z-]{24,}$/, // Slack token
  /^[A-Za-z0-9+/]{40,}={0,2}$/,    // Base64-encoded token (heuristic)
  /\s/,                              // Names never contain whitespace
];

/**
 * Throws if any value in `referencedSecrets` looks like an actual secret value
 * rather than a secret NAME (environment variable identifier).
 *
 * @param {string[]} names
 * @param {string}   serverId  For context in error messages.
 * @throws {TypeError}
 */
function assertSecretNames(names, serverId) {
  for (const name of names) {
    // Pattern check first — catches known token formats regardless of casing.
    for (const pattern of SECRET_VALUE_PATTERNS) {
      if (pattern.test(name)) {
        throw new TypeError(
          `MCP manifest — server '${serverId}' referencedSecrets contains what looks ` +
          `like a secret VALUE ('${name.slice(0, 8)}…'), not a NAME. ` +
          `Store only the environment variable name (e.g. 'GITHUB_PERSONAL_ACCESS_TOKEN').`
        );
      }
    }
    // Structural check second — a valid name must be ALL_CAPS_WITH_UNDERSCORES.
    if (!/^[A-Z][A-Z0-9_]{0,127}$/.test(name)) {
      throw new TypeError(
        `MCP manifest — server '${serverId}' referencedSecret '${name}' is not a valid ` +
        `environment-variable name. Expected ALL_CAPS_IDENTIFIER, e.g. 'GITHUB_TOKEN'.`
      );
    }
  }
}

/**
 * @typedef {Object} ManifestEntry
 * @property {string}    id
 * @property {string}    [mode]
 * @property {Object}    [pin]
 * @property {string[]}  [referencedSecrets]
 * @property {string[]}  [allowedTools]
 * @property {boolean}   [disabled]
 */

/**
 * @typedef {Object} ProjectManifest
 * @property {1}               version
 * @property {ManifestEntry[]} servers
 * @property {string}          [generatedAt]
 */

/**
 * Returns the absolute path to the manifest for a given project root.
 * Forward-slash normalised (rule 4 / Windows compatibility).
 *
 * @param {string} [root]
 * @returns {string}
 */
export function manifestPathFor(root = process.cwd()) {
  return resolve(root, MANIFEST_REL).split('\\').join('/');
}

/**
 * Loads the project manifest from `<root>/contextkit/mcp/project-manifest.json`.
 * Returns an empty manifest (version:1, servers:[]) if the file does not exist.
 * Throws on malformed JSON or a secret value embedded in referencedSecrets.
 *
 * @param {string} [root]
 * @returns {ProjectManifest}
 * @throws {TypeError} On malformed JSON or embedded secret values.
 */
export function readManifest(root = process.cwd()) {
  const manifestPath = manifestPathFor(root);
  if (!existsSync(manifestPath)) {
    return { version: 1, servers: [] };
  }

  let raw;
  try {
    raw = readFileSync(manifestPath, 'utf-8');
  } catch (ioError) {
    throw new Error(`MCP manifest read failed at ${manifestPath}: ${ioError.message}`);
  }

  // Strip leading UTF-8 BOM (Windows editors / PS5.1 sometimes emit one).
  const cleaned = raw.replace(/^﻿/, '');
  let parsed;
  try {
    parsed = JSON.parse(cleaned);
  } catch (parseError) {
    throw new TypeError(`MCP manifest at ${manifestPath} contains malformed JSON: ${parseError.message}`);
  }

  if (!parsed || parsed.version !== 1 || !Array.isArray(parsed.servers)) {
    throw new TypeError(`MCP manifest at ${manifestPath} must have version:1 and a "servers" array`);
  }

  // Validate no secret values snuck in.
  for (const entry of parsed.servers) {
    if (Array.isArray(entry.referencedSecrets) && entry.referencedSecrets.length > 0) {
      assertSecretNames(entry.referencedSecrets, entry.id ?? '(unknown)');
    }
  }

  return parsed;
}

/**
 * Atomically writes the project manifest.
 *
 * Steps:
 *   1. Validate all referencedSecrets — throws before any I/O if a value is found.
 *   2. Write to a `.tmp` path.
 *   3. Rename (atomic on POSIX; best-effort on Windows NTFS).
 *
 * @param {ProjectManifest} manifest
 * @param {string}          [root]
 * @returns {Promise<void>}
 * @throws {TypeError} On embedded secret values.
 * @throws {Error}     On I/O failure.
 */
export async function writeManifest(manifest, root = process.cwd()) {
  // Pre-validate before touching the filesystem.
  for (const entry of manifest.servers ?? []) {
    if (Array.isArray(entry.referencedSecrets) && entry.referencedSecrets.length > 0) {
      assertSecretNames(entry.referencedSecrets, entry.id ?? '(unknown)');
    }
  }

  const finalPath = manifestPathFor(root);
  const tmpPath = `${finalPath}.tmp`;

  const payload = JSON.stringify(
    { ...manifest, generatedAt: new Date().toISOString() },
    null,
    2
  ) + '\n';

  await writeFile(tmpPath, payload, { encoding: 'utf-8' });
  await rename(tmpPath, finalPath);
}
