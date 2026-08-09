/**
 * Grok Build host installation - a native ContextDevKit projection.
 *
 * Grok owns the `.grok` namespace. ContextDevKit owns only the explicitly
 * named hook file so project MCP/configuration and unrelated user hooks remain
 * untouched during install, update, rewire, and uninstall.
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { GROK_HOOKS_FILE } from '../../templates/contextkit/runtime/config/paths.mjs';
import { composeGrokHooks } from '../../templates/contextkit/runtime/config/grok-hooks-compose.mjs';
import { read, overwrite } from './fs.mjs';

/**
 * Composes the ContextDevKit-owned Grok hook projection for one level.
 *
 * @param {string} target project root
 * @param {number} level active ContextDevKit level
 * @param {string[]} report mutable installer report
 * @returns {Promise<void>}
 */
export async function wireGrokHooks(target, level, report) {
  const hooksPath = join(target, GROK_HOOKS_FILE);
  let existing = null;
  if (existsSync(hooksPath)) {
    try {
      existing = JSON.parse(await read(hooksPath));
    } catch {
      report.push('WARN .grok/hooks/contextdevkit.json is not valid JSON - left untouched');
      return;
    }
  }

  await overwrite(hooksPath, JSON.stringify(composeGrokHooks(existing, level), null, 2) + '\n');
  report.push(`Grok hooks wired (.grok/hooks/contextdevkit.json, level ${level})`);
}

/**
 * Installs the native Grok hook projection.
 *
 * @param {string} target project root
 * @param {string} _tplDir retained for host-installer signature parity
 * @param {{level:number}} ctx install context
 * @param {string[]} report mutable installer report
 * @returns {Promise<void>}
 */
export async function installGrokHost(target, _tplDir, ctx, report) {
  await wireGrokHooks(target, ctx.level, report);
}
