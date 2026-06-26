#!/usr/bin/env node
/**
 * Shared fixtures and reporter for MCP-006 self-check sub-suites.
 *
 * Provides: path constants, ok/bad reporter factory, makeFakeRoot.
 * Import this in every selfcheck-mcp-006-*.mjs sibling.
 *
 * @module selfcheck-mcp-006-helpers
 */
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Absolute path to the kit root (parent of tools/). */
export const KIT = resolve(__dirname, '..');

/** Absolute path to templates/contextkit. */
export const TEMPLATES = resolve(KIT, 'templates', 'contextkit');

/** Absolute path to the MCP server source directory. */
export const MCP_SERVER_DIR = resolve(TEMPLATES, 'mcp-server');

/**
 * Creates a minimal counter-based ok/bad reporter.
 * Returns { ok, bad, summary, hasFailed }.
 *
 * @returns {{ ok: (label: string) => void, bad: (label: string, reason?: string) => void,
 *             summary: () => string, hasFailed: () => boolean }}
 */
export function makeReporter() {
  let passed = 0;
  let failed = 0;

  return {
    ok(label) {
      console.log(`  PASS  ${label}`);
      passed++;
    },
    bad(label, reason) {
      console.error(`  FAIL  ${label}${reason ? ` — ${reason}` : ''}`);
      failed++;
    },
    summary() {
      return `${passed} passed, ${failed} failed`;
    },
    hasFailed() {
      return failed > 0;
    },
  };
}

/**
 * Creates a minimal ContextDevKit project root in a temp dir.
 * Provides enough structure for pathsFor(ROOT) to resolve without
 * real artifacts. Returns root path + a teardown function.
 *
 * @returns {{ root: string, teardown: () => void }}
 */
export function makeFakeRoot() {
  const root = resolve(tmpdir(), `sc-mcp-006-${randomUUID()}`);
  const ckit = resolve(root, 'contextkit');
  const mem = resolve(ckit, 'memory');
  const pipeline = resolve(ckit, 'pipeline');

  for (const dir of [
    resolve(mem, 'sessions'),
    resolve(mem, 'decisions'),
    resolve(mem, 'project-map'),
    resolve(mem, 'workflows'),
    resolve(mem, 'business-rules'),
    resolve(pipeline, 'backlog'),
    resolve(pipeline, 'working'),
    resolve(pipeline, 'testing'),
    resolve(pipeline, 'conclusion'),
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
