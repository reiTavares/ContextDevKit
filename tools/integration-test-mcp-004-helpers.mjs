/**
 * integration-test-mcp-004-helpers.mjs — Shared fixtures and utilities
 * for the MCP-004 integration sub-suites.
 *
 * Imported by:
 *   integration-test-mcp-004-happy.mjs
 *   integration-test-mcp-004-deny.mjs
 *   integration-test-mcp-004-degraded.mjs
 *   integration-test-mcp-004-dispatch.mjs
 *
 * NOT standalone-runnable; imported only.
 */

import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { resolve, dirname, join }           from 'node:path';
import { fileURLToPath, pathToFileURL }     from 'node:url';
import { tmpdir }                           from 'node:os';
import { randomUUID }                       from 'node:crypto';
import { reporter, KIT }                    from './it-helpers.mjs';

export const __dirname = dirname(fileURLToPath(import.meta.url));
export const SCRIPTS   = join(KIT, 'templates', 'contextkit', 'tools', 'scripts');
export const NODE      = process.execPath;

/** Passes a condition through the reporter, returns the boolean. */
export function check(rep, condition, label, detail = '') {
  if (condition) {
    rep.ok(label);
  } else {
    rep.bad(`${label}${detail ? ' — ' + detail : ''}`);
  }
  return !!condition;
}

/** Expects fn() to throw; fails the suite if it does not. */
export function expectThrow(rep, label, fn, msgFragment) {
  try {
    fn();
    rep.bad(`${label} — expected throw but did not throw`);
  } catch (err) {
    const msg = err?.message ?? String(err);
    if (msgFragment && !msg.includes(msgFragment)) {
      rep.bad(`${label} — threw but wrong message: ${msg.slice(0, 120)}`);
    } else {
      rep.ok(label);
    }
  }
}

/** Creates a throwaway temp directory. */
export function makeTmpRoot(suffix = '') {
  const dir = join(tmpdir(), `it-mcp004-${randomUUID().slice(0, 8)}${suffix}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

/** Recursively removes a temp directory (best-effort). */
export function cleanup(dir) {
  try { rmSync(dir, { recursive: true, force: true }); } catch { /* best-effort */ }
}

/**
 * Writes .claude/settings.json with the given mcpServers blob.
 * @param {string} root
 * @param {object} mcpServers
 */
export function writeSettings(root, mcpServers) {
  const d = join(root, '.claude');
  mkdirSync(d, { recursive: true });
  writeFileSync(join(d, 'settings.json'), JSON.stringify({ mcpServers }), 'utf-8');
}

/** Converts an absolute path to a file:// URL, normalizing Windows backslashes. */
export const toFileUrl = (p) => pathToFileURL(p.replace(/\\/g, '/')).href;

/**
 * Dynamically imports the MCP-004 core modules from templates/ (source of truth).
 * @returns {{ runDoctorProbe, runDoctorProbes, checkSecrets, extractCapabilityNames, MCP_PROTOCOL_VERSION,
 *             buildDoctorReport, renderDoctorReport, runDoctor }}
 */
export async function loadMcpModules() {
  const core = await import(toFileUrl(join(SCRIPTS, 'mcp-doctor-core.mjs')));
  const doctor = await import(toFileUrl(join(SCRIPTS, 'mcp-doctor.mjs')));
  return { ...core, ...doctor };
}
