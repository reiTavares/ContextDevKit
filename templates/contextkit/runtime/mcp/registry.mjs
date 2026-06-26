/**
 * MCP Registry loader — reads and validates the curated registry.json.
 *
 * Contract:
 *   - Pure function; zero side effects beyond reading the file.
 *   - Throws a descriptive TypeError on any malformed or missing required field.
 *   - Zero third-party dependencies (node:* only) — hot-path safe.
 *
 * @module registry
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PLATFORM_DIR } from '../config/paths.mjs';

/** @typedef {'R0'|'R1'|'R2'|'R3'|'R4'|'R5'} RiskLevel */
/** @typedef {'stdio'|'streamable-http'} Transport */
/** @typedef {'read-only'|'write'} ServerMode */
/** @typedef {'pinned'} VersionPolicy */
/** @typedef {'auto'|'human'} Approval */

/**
 * @typedef {Object} RegistryPin
 * @property {string} [npm]      Exact npm version string.
 * @property {string} [digest]   Container image digest.
 * @property {string} [sha]      Git commit SHA.
 * @property {string} [identity] Sigstore / cosign identity.
 */

/**
 * @typedef {Object} Provenance
 * @property {string}      publisher
 * @property {string}      url
 * @property {string}      version
 * @property {string|null} hash
 * @property {string}      license
 * @property {string|null} verifiedAt
 * @property {Transport}   transport
 * @property {string[]}    requestedPermissions
 */

/**
 * @typedef {Object} Capabilities
 * @property {string[]} tools
 * @property {string[]} resources
 * @property {string[]} prompts
 */

/**
 * @typedef {Object} RegistryEntry
 * @property {string}        id
 * @property {string}        displayName
 * @property {string}        publisher
 * @property {string}        source
 * @property {Transport}     transport
 * @property {RiskLevel}     risk
 * @property {Capabilities}  capabilities
 * @property {string[]}      requiredSecrets
 * @property {string[]}      allowedHosts
 * @property {ServerMode}    defaultMode
 * @property {VersionPolicy} versionPolicy
 * @property {RegistryPin}   pin
 * @property {Approval}      approval
 * @property {Provenance}    provenance
 */

const VALID_TRANSPORTS = new Set(['stdio', 'streamable-http']);
const VALID_RISKS = new Set(['R0', 'R1', 'R2', 'R3', 'R4', 'R5']);
const VALID_MODES = new Set(['read-only', 'write']);
const VALID_APPROVALS = new Set(['auto', 'human']);

/**
 * Validates a single registry entry. Throws TypeError with the entry id (or
 * index) and the violated field so callers get an actionable error.
 *
 * @param {unknown} raw   Parsed JSON object.
 * @param {number}  index Position in the array (for error context).
 * @returns {RegistryEntry}
 * @throws {TypeError} On any missing or malformed required field.
 */
function validateEntry(raw, index) {
  const label = (raw && typeof raw === 'object' && raw.id) ? `'${raw.id}'` : `[${index}]`;

  function require(field, predicate, hint) {
    if (!predicate(raw[field])) {
      throw new TypeError(
        `MCP registry entry ${label} — invalid or missing '${field}': ${hint}. Got: ${JSON.stringify(raw[field])}`
      );
    }
  }

  const nonEmptyString = (v) => typeof v === 'string' && v.trim().length > 0;
  const stringArray = (v) => Array.isArray(v) && v.every((s) => typeof s === 'string');

  require('id', nonEmptyString, 'must be a non-empty string');
  require('displayName', nonEmptyString, 'must be a non-empty string');
  require('publisher', nonEmptyString, 'must be a non-empty string');
  require('source', nonEmptyString, 'must be a non-empty string');
  require('transport', (v) => VALID_TRANSPORTS.has(v), `must be one of: ${[...VALID_TRANSPORTS].join(', ')}`);
  require('risk', (v) => VALID_RISKS.has(v), `must be one of: ${[...VALID_RISKS].join(', ')}`);
  require('requiredSecrets', stringArray, 'must be an array of strings');
  require('allowedHosts', stringArray, 'must be an array of strings');
  require('defaultMode', (v) => VALID_MODES.has(v), `must be one of: ${[...VALID_MODES].join(', ')}`);
  require('versionPolicy', (v) => v === 'pinned', "must be 'pinned'");
  require('approval', (v) => VALID_APPROVALS.has(v), `must be one of: ${[...VALID_APPROVALS].join(', ')}`);
  require('pin', (v) => v && typeof v === 'object' && !Array.isArray(v), 'must be an object with at least one pin field');
  require('provenance', (v) => v && typeof v === 'object' && !Array.isArray(v), 'must be a provenance object');

  // Validate provenance sub-fields explicitly (AC#1 + AC#3 fail-fast contract).
  // An entry with provenance:{} must not pass silently — constitution §8: validators throw.
  const prov = raw.provenance;
  const provNonEmptyString = (v) => typeof v === 'string' && v.trim().length > 0;
  const provNullableString = (v) => v === null || (typeof v === 'string');
  const provStringArray = (v) => Array.isArray(v) && v.every((s) => typeof s === 'string');
  const provFields = /** @type {Array<[string, (v: unknown) => boolean, string]>} */ ([
    ['publisher',             provNonEmptyString,  'must be a non-empty string'],
    ['url',                   provNonEmptyString,  'must be a non-empty string'],
    ['version',               provNonEmptyString,  'must be a non-empty string'],
    ['hash',                  provNullableString,  'must be a string or null'],
    ['license',               provNonEmptyString,  'must be a non-empty string'],
    ['verifiedAt',            provNullableString,  'must be a string or null'],
    ['transport',             (v) => VALID_TRANSPORTS.has(v), `must be one of: ${[...VALID_TRANSPORTS].join(', ')}`],
    ['requestedPermissions',  provStringArray,     'must be an array of strings'],
  ]);
  for (const [field, predicate, hint] of provFields) {
    if (!predicate(prov[field])) {
      throw new TypeError(
        `MCP registry entry ${label} — invalid or missing 'provenance.${field}': ${hint}. Got: ${JSON.stringify(prov[field])}`
      );
    }
  }

  const caps = raw.capabilities;
  if (!caps || typeof caps !== 'object') {
    throw new TypeError(`MCP registry entry ${label} — 'capabilities' must be an object`);
  }
  for (const key of ['tools', 'resources', 'prompts']) {
    if (!stringArray(caps[key])) {
      throw new TypeError(`MCP registry entry ${label} — capabilities.${key} must be an array of strings`);
    }
  }

  return /** @type {RegistryEntry} */ (raw);
}

/**
 * Loads the curated MCP registry from `<root>/<PLATFORM_DIR>/mcp/registry.json`.
 * Returns all entries after full validation — any malformed entry aborts the load.
 *
 * @param {string} [root] Project root (defaults to cwd).
 * @returns {RegistryEntry[]}
 * @throws {TypeError|Error} On malformed JSON, missing file, or any invalid entry.
 */
export function loadRegistry(root = process.cwd()) {
  const registryPath = resolve(root, PLATFORM_DIR, 'mcp', 'registry.json');
  let raw;
  try {
    raw = readFileSync(registryPath, 'utf-8');
  } catch (ioError) {
    throw new Error(`MCP registry not found at ${registryPath}: ${ioError.message}`);
  }

  // Strip leading UTF-8 BOM (Windows editors / PowerShell PS5.1 sometimes emit one).
  const cleaned = raw.replace(/^﻿/, '');
  let parsed;
  try {
    parsed = JSON.parse(cleaned);
  } catch (parseError) {
    throw new TypeError(`MCP registry at ${registryPath} contains malformed JSON: ${parseError.message}`);
  }

  if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.entries)) {
    throw new TypeError(`MCP registry at ${registryPath} must have an "entries" array at root`);
  }

  return parsed.entries.map((entry, i) => validateEntry(entry, i));
}

/**
 * Returns a single registry entry by id, or null if not found.
 * Loads the full registry on each call — callers that need repeated lookups
 * should call loadRegistry() once and search the result array themselves.
 *
 * @param {string} id
 * @param {string} [root]
 * @returns {RegistryEntry|null}
 */
export function findEntry(id, root = process.cwd()) {
  const entries = loadRegistry(root);
  return entries.find((e) => e.id === id) ?? null;
}
