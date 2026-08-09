/**
 * integration-test-mcp-007-helpers.mjs — shared fixtures for the MCP-007 sub-suites.
 *
 * Exports: path constants, loadJson, fileUrl, GITHUB_REG, LITERAL_RE,
 * WRITE_ADMIN_TOOLS, READ_TOOLS, loadFixtures(), loadRuntimeModules().
 *
 * NOT standalone-runnable; imported by the -registry / -policy / -deny / -render
 * siblings. Zero dependencies beyond node:*.
 */

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// ── Path constants ────────────────────────────────────────────────────────────

const HERE    = dirname(fileURLToPath(import.meta.url));
const KIT     = resolve(HERE, '..');
const MCP     = resolve(KIT, 'templates', 'contextkit', 'mcp');
const RUNTIME = resolve(KIT, 'templates', 'contextkit', 'runtime', 'mcp');

export const PROFILE_PATH  = resolve(MCP, 'profiles', 'github-readonly.json');
export const POLICY_PATH   = resolve(MCP, 'policies', 'github.allow.json');
export const REGISTRY_PATH = resolve(MCP, 'registry.json');
export const WEB_APP_PATH  = resolve(MCP, 'profiles', 'web-app.json');
export const BACKEND_PATH  = resolve(MCP, 'profiles', 'backend-api.json');

export const POLICY_MJS        = resolve(RUNTIME, 'policy.mjs').replaceAll('\\', '/');
export const RENDER_SHARED_MJS = resolve(RUNTIME, 'render', 'render-shared.mjs').replaceAll('\\', '/');
export const RENDER_CLAUDE_MJS = resolve(RUNTIME, 'render', 'render-claude.mjs').replaceAll('\\', '/');
export const RENDER_CODEX_MJS  = resolve(RUNTIME, 'render', 'render-codex.mjs').replaceAll('\\', '/');
export const RENDER_CURSOR_MJS = resolve(RUNTIME, 'render', 'render-cursor.mjs').replaceAll('\\', '/');

// ── Pure helpers ──────────────────────────────────────────────────────────────

/** Strip BOM and parse JSON. @param {string} p @returns {unknown} */
export function loadJson(p) {
  return JSON.parse(readFileSync(p, 'utf-8').replace(/^﻿/, ''));
}

/** Convert an absolute file path to a file:// URL string. @param {string} p */
export function fileUrl(p) { return 'file:///' + p; }

// ── Shared domain constants ───────────────────────────────────────────────────

/** Tools that must always be absent from read-only rendered outputs. */
export const WRITE_ADMIN_TOOLS = Object.freeze([
  'merge_pull_request', 'delete_repository', 'update_secret',
  'push_files', 'create_pull_request',
]);

/** Tools that must be present in the github-readonly profile. */
export const READ_TOOLS = Object.freeze(['get_repo', 'list_pull_requests', 'get_issue']);

/** Regex patterns that identify literal credential values — must never appear in
 *  profile/policy/rendered artifacts. */
export const LITERAL_RE = Object.freeze([
  /^gh[ps]_/, /^sk-/, /^xox/, /^[A-Za-z0-9+/]{40,}/,
]);

/** Canonical wave-1 registry fixture for evaluateServer() calls. */
export const GITHUB_REG = Object.freeze({
  id: 'github',
  risk: 'R2',
  allowedHosts: ['api.github.com'],
  pin: { npm: '2.0.0' },
  defaultMode: 'read-only',
  capabilities: {
    tools: [
      'list_repos', 'get_repo', 'search_repos', 'list_issues', 'get_issue',
      'create_issue', 'list_pull_requests', 'get_pull_request', 'create_pull_request',
      'list_commits', 'get_file_contents', 'push_files', 'search_code',
      'merge_pull_request', 'delete_repository', 'update_secret',
    ],
    resources: ['github://repo'],
    prompts: [],
  },
});

// ── Fixture loader ─────────────────────────────────────────────────────────────

/**
 * Load all JSON fixtures. Returns { profile, policy, registry, webApp, backendApi }.
 * Throws on missing/malformed file.
 * @returns {{ profile: unknown, policy: unknown, registry: unknown, webApp: unknown, backendApi: unknown }}
 */
export function loadFixtures() {
  return {
    profile:    loadJson(PROFILE_PATH),
    policy:     loadJson(POLICY_PATH),
    registry:   loadJson(REGISTRY_PATH),
    webApp:     loadJson(WEB_APP_PATH),
    backendApi: loadJson(BACKEND_PATH),
  };
}

/**
 * Dynamically import the four runtime modules. Returns an object with resolved
 * exports. A missing/broken module is reported via `bad` and its slot is null
 * (so callers guard with `if (mod)`).
 *
 * @param {{ ok: Function, bad: Function }} rep
 * @returns {Promise<{
 *   evaluateServer: Function|null,
 *   assertSecretName: Function|null,
 *   buildEnvRefs: Function|null,
 *   filterForHost: Function|null,
 *   renderClaude: Function|null,
 *   renderCodex: Function|null,
 *   renderCursor: Function|null,
 * }>}
 */
export async function loadRuntimeModules({ ok, bad }) {
  let evaluateServer = null;
  let assertSecretName = null, buildEnvRefs = null, filterForHost = null;
  let renderClaude = null, renderCodex = null, renderCursor = null;

  try {
    const m = await import(fileUrl(POLICY_MJS));
    evaluateServer = m.evaluateServer;
    ok('policy.mjs loaded');
  } catch (err) { bad(`policy.mjs load failed: ${err.message}`); }

  try {
    const m = await import(fileUrl(RENDER_SHARED_MJS));
    assertSecretName = m.assertSecretName;
    buildEnvRefs     = m.buildEnvRefs;
    filterForHost    = m.filterForHost;
    ok('render-shared.mjs loaded');
  } catch (err) { bad(`render-shared.mjs load failed: ${err.message}`); }

  try {
    const m = await import(fileUrl(RENDER_CLAUDE_MJS));
    renderClaude = m.renderHost;
    ok('render-claude.mjs loaded');
  } catch (err) { bad(`render-claude.mjs load failed: ${err.message}`); }

  try {
    const m = await import(fileUrl(RENDER_CODEX_MJS));
    renderCodex = m.renderHost;
    ok('render-codex.mjs loaded');
  } catch (err) { bad(`render-codex.mjs load failed: ${err.message}`); }

  try {
    const m = await import(fileUrl(RENDER_CURSOR_MJS));
    renderCursor = m.renderHost;
    ok('render-cursor.mjs loaded');
  } catch (err) { bad(`render-cursor.mjs load failed: ${err.message}`); }

  return { evaluateServer, assertSecretName, buildEnvRefs, filterForHost,
           renderClaude, renderCodex, renderCursor };
}
