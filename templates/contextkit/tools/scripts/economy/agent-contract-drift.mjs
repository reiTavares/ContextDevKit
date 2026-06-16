/**
 * agent-contract-drift.mjs — Filesystem drift auditor for the QA squad output
 * contract (ECON-03, WF0020 Economy Runtime).
 *
 * WHY split from agent-contract.mjs: the drift auditor is the only consumer
 * of node:fs in this subsystem, and its logic (directory scanning, text
 * extraction, canonical comparison) is a distinct second responsibility that
 * would push agent-contract.mjs past the 308-line constitution ceiling (§1
 * +10% tolerance). Moving it here keeps both files within budget and gives
 * the filesystem concern its own clean module boundary.
 *
 * Public surface:
 *   auditAgentContractDrift(root) — per-host file drift report
 *
 * Design constraints:
 *   - Fail-open: unreadable files → 'skipped'; missing directories → silently
 *     omitted. Never throws, never false-passes.
 *   - Zero runtime dependencies — node:* only.
 *   - No hardcoded "contextkit/" in resolve()/join() calls.
 *   - UNREGISTERED: no hook/boot wiring in Phase 1.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve }             from 'node:path';
import { resolveContract }           from './output-contract.mjs';
import { renderContractSection }     from './agent-contract.mjs';

// ---------------------------------------------------------------------------
// auditAgentContractDrift
// ---------------------------------------------------------------------------

/**
 * Reads the existing `templates/<host>/agents/qa-*.md` files under `root` and
 * classifies each against the canonical `## Output Contract` block.
 *
 * Classification per file:
 *   - missing:  no `## Output Contract` section found (deferred-injection target).
 *   - ok:       section matches renderContractSection(default) exactly.
 *   - drift:    section present but diverges from the canonical block.
 *   - skipped:  file unreadable (fail-open: never counted as pass).
 *
 * The function never throws. A missing agents directory is silently omitted —
 * an empty array is returned when no hosts have generated files yet (correct
 * for a pristine install before Phase-2 generators run).
 *
 * @param {string} root - Repo or project root (absolute path).
 * @returns {Array<{
 *   agent: string,
 *   host: string,
 *   file: string,
 *   status: 'ok'|'drift'|'missing'|'skipped',
 *   detail: string
 * }>}
 */
export function auditAgentContractDrift(root) {
  const safeRoot = typeof root === 'string' && root ? root : '.';

  /** The canonical block rendered from pure defaults (no cfg, no override). */
  const canonical = renderContractSection(resolveContract(null, null));

  /**
   * Host directories to scan.
   * Pattern: `<root>/templates/<host>/agents/qa-*.md`
   * Phase-2 expansion (codex, opencode, cursor) is deferred.
   */
  const hostDirs = [
    { host: 'claude',      dir: resolve(safeRoot, 'templates', 'claude', 'agents') },
    { host: 'antigravity', dir: resolve(safeRoot, 'templates', 'antigravity', 'agents') },
  ];

  const results = [];

  for (const { host, dir } of hostDirs) {
    let entries;
    try {
      entries = readdirSync(dir);
    } catch {
      // Directory absent or unreadable — skip silently (fail-open).
      continue;
    }

    const qaFiles = entries.filter(
      (name) => name.startsWith('qa-') && name.endsWith('.md')
    );

    for (const fileName of qaFiles) {
      const agentName = fileName.replace(/\.md$/, '');
      const filePath  = join(dir, fileName);

      let content;
      try {
        content = readFileSync(filePath, 'utf-8');
      } catch {
        results.push({
          agent:  agentName,
          host,
          file:   filePath,
          status: 'skipped',
          detail: 'unreadable',
        });
        continue;
      }

      const contractIdx = content.indexOf('## Output Contract');

      if (contractIdx === -1) {
        results.push({
          agent:  agentName,
          host,
          file:   filePath,
          status: 'missing',
          detail: 'no ## Output Contract section found (deferred injection target)',
        });
        continue;
      }

      // Extract the section from ## Output Contract to the next ## heading or EOF.
      const afterSection  = content.slice(contractIdx);
      const nextHeading   = afterSection.match(/\n##\s/);
      const sectionText   = nextHeading
        ? afterSection.slice(0, nextHeading.index).trimEnd()
        : afterSection.trimEnd();

      if (sectionText === canonical) {
        results.push({
          agent:  agentName,
          host,
          file:   filePath,
          status: 'ok',
          detail: 'matches canonical',
        });
      } else {
        results.push({
          agent:  agentName,
          host,
          file:   filePath,
          status: 'drift',
          detail: 'section present but diverges from canonical block',
        });
      }
    }
  }

  return results;
}
