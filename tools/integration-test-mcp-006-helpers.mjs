/**
 * integration-test-mcp-006-helpers.mjs — Shared fixtures for MCP-006 sub-suites.
 *
 * Provides:
 *   - MCP_SERVER_DIR / SERVER_PATH path constants
 *   - makeFakeRoot() — a minimal temp ContextDevKit project root
 *   - EXPECTED_TOOLS / EXPECTED_RESOURCE_URIS / EXPECTED_PROMPT_NAMES constants
 *
 * Not standalone-runnable. Imported by the sibling integration-test-mcp-006-*.mjs
 * files.
 */
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Absolute path to the repo root (one level above tools/). */
export const KIT = resolve(__dirname, '..');

/** Absolute path to the MCP server source directory. */
export const MCP_SERVER_DIR = resolve(KIT, 'templates', 'contextkit', 'mcp-server');

/** Absolute path to the MCP stdio server entry point. */
export const SERVER_PATH = resolve(MCP_SERVER_DIR, 'server.mjs');

/** The 10 camelCase tool exports required by AC-1. */
export const EXPECTED_TOOLS = [
  'getProjectState', 'getProjectMap', 'getModuleContext', 'getWorkflowStatus',
  'getPipelineCards', 'getActiveClaims', 'getLatestSession', 'getRelevantDecisions',
  'getContextPack', 'getQualityStatus',
];

/** The 6 canonical resource URIs required by AC-2. */
export const EXPECTED_RESOURCE_URIS = [
  'contextdevkit://project/map',
  'contextdevkit://workflow/current',
  'contextdevkit://pipeline/working',
  'contextdevkit://memory/latest-session',
  'contextdevkit://decisions/catalog',
  'contextdevkit://business-rules',
];

/** The 5 canonical prompt names required by AC-3. */
export const EXPECTED_PROMPT_NAMES = [
  'plan-feature', 'review-architecture', 'prepare-qa', 'resume-task', 'analyze-impact',
];

/**
 * Creates a minimal ContextDevKit project root in a temp dir.
 * All kit paths resolve correctly; no real artifacts present so every tool
 * exercises its graceful-degradation path.
 * @returns {{ root: string, teardown: () => void }}
 */
export function makeFakeRoot() {
  const root = resolve(tmpdir(), `it-mcp-006-${randomUUID()}`);
  const ckit = resolve(root, 'contextkit');
  const mem = resolve(ckit, 'memory');
  for (const dir of [
    resolve(mem, 'sessions'),
    resolve(mem, 'decisions'),
    resolve(mem, 'project-map'),
    resolve(mem, 'workflows'),
    resolve(mem, 'business-rules'),
    resolve(ckit, 'pipeline', 'backlog'),
    resolve(ckit, 'pipeline', 'working'),
    resolve(ckit, 'pipeline', 'testing'),
    resolve(ckit, 'pipeline', 'conclusion'),
    resolve(ckit, 'state', 'receipts'),
    resolve(root, '.claude', '.workspace'),
  ]) {
    mkdirSync(dir, { recursive: true });
  }
  writeFileSync(resolve(ckit, 'config.json'), JSON.stringify({ level: 6 }));
  return {
    root,
    teardown: () => {
      try { rmSync(root, { recursive: true, force: true }); } catch { /* ignore */ }
    },
  };
}
