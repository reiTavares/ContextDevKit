#!/usr/bin/env node
/**
 * Multi-host selective context-load parity checker (CDK-056, PKG-05).
 *
 * Enumerates which context-LOADING hooks each native host (claude / codex / agy)
 * receives at the highest configured level, then cross-references the Codex
 * skill-skip list to distinguish intentional omissions from silent gaps.
 *
 * A "context-load" is any hook registered by one of the three native-host
 * composers — the unit of comparison is the hook SCRIPT basename. A
 * "reasoned-skip" is declared when a CODEX_SKILL_SKIP_LIST entry matches the
 * script name (without extension) OR a reason is supplied via `skipReasons`.
 * Anything absent on ≥1 host without a declared reason is a GAP.
 *
 * Fail-open: if a composer cannot be imported, that host column reports
 * `'unknown'` and no crash occurs.
 *
 * @module host-parity
 */
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  ENFORCEMENT_HOOK_REASONS,
  REPRESENTATIVE_LEVEL,
  extractClaudeOrCodexScripts,
  extractAgyScripts,
} from './host-parity-core.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Composer + converter locations, resolved RELATIVE to this script's position in
// the platform tree (tools/scripts → ../../runtime). Rule 4: never hardcode the
// platform dir name — this resolves the SOURCE composers in dev and the INSTALLED
// ones in a real project, with no `contextkit/` literal.
const RUNTIME = resolve(__dirname, '..', '..', 'runtime');
const COMPOSERS = {
  claude: resolve(RUNTIME, 'config', 'settings-compose.mjs'),
  codex: resolve(RUNTIME, 'config', 'codex-hooks-compose.mjs'),
  agy: resolve(RUNTIME, 'config', 'agent-hooks-compose.mjs'),
};
const CONVERT_CORE = resolve(RUNTIME, 'codex', 'convert-core.mjs');

/**
 * Imports a composer module and extracts its hook-script set; 'unknown' on failure.
 *
 * @param {string} composerPath absolute path to the composer module
 * @param {string} exportName named export to call (composeSettings / composeCodexHooks / composeAgentHooks)
 * @param {(composed: any) => Set<string>} extractor
 * @returns {Promise<Set<string> | 'unknown'>}
 */
async function loadHostScripts(composerPath, exportName, extractor) {
  try {
    const mod = await import(pathToFileURL(composerPath).href);
    return extractor(mod[exportName](null, REPRESENTATIVE_LEVEL));
  } catch {
    return 'unknown'; // Fail-open.
  }
}

/**
 * Checks hook-registration parity across the three native hosts (claude / codex
 * / agy) at `REPRESENTATIVE_LEVEL` (L5).
 *
 * @param {string} [root] reserved for future override; current impl self-resolves paths.
 * @param {Record<string, string>} [skipReasons] caller-supplied hook→reason map,
 *   merged with ENFORCEMENT_HOOK_REASONS.
 * @returns {Promise<import('./host-parity-core.mjs').ParityReport>}
 */
export async function checkParity(root, skipReasons = {}) {
  const allReasons = { ...ENFORCEMENT_HOOK_REASONS, ...skipReasons };

  // Codex skill-skip list (advisory; some hooks may share a skip-list stem).
  let codexSkipList = new Set();
  try {
    const { CODEX_SKILL_SKIP_LIST } = await import(pathToFileURL(CONVERT_CORE).href);
    codexSkipList = new Set(CODEX_SKILL_SKIP_LIST);
  } catch {
    // Fail-open: skip list unavailable; treat as empty.
  }

  const claudeScripts = await loadHostScripts(COMPOSERS.claude, 'composeSettings', extractClaudeOrCodexScripts);
  const codexScripts = await loadHostScripts(COMPOSERS.codex, 'composeCodexHooks', extractClaudeOrCodexScripts);
  const agyScripts = await loadHostScripts(COMPOSERS.agy, 'composeAgentHooks', extractAgyScripts);

  // Union of all known hooks across resolvable hosts.
  const allScripts = new Set();
  for (const set of [claudeScripts, codexScripts, agyScripts]) {
    if (set !== 'unknown') for (const s of set) allScripts.add(s);
  }

  /** @type {import('./host-parity-core.mjs').ParityRow[]} */
  const loads = [];
  for (const script of [...allScripts].sort()) {
    const inClaude = claudeScripts === 'unknown' ? 'unknown' : claudeScripts.has(script);
    const inAgy = agyScripts === 'unknown' ? 'unknown' : agyScripts.has(script);

    const isCodexSkillSkipped = codexSkipList.has(script.replace(/\.mjs$/, ''));
    let codexPresence;
    if (codexScripts === 'unknown') codexPresence = 'unknown';
    else if (codexScripts.has(script)) codexPresence = true;
    else if (isCodexSkillSkipped) codexPresence = 'skipped';
    else codexPresence = false;

    const reason = allReasons[script];
    const resolvable = [inClaude, codexPresence, inAgy].filter((v) => v !== 'unknown');
    const absentCount = resolvable.filter((v) => v === false).length;

    let verdict;
    if (absentCount === 0) verdict = 'parity';
    else if (Boolean(reason) || isCodexSkillSkipped) verdict = 'reasoned-skip';
    else verdict = 'GAP';

    /** @type {import('./host-parity-core.mjs').ParityRow} */
    const row = { name: script, claude: inClaude, codex: codexPresence, agy: inAgy, verdict };
    if (reason) row.reason = reason;
    loads.push(row);
  }

  return { loads, gaps: loads.filter((r) => r.verdict === 'GAP') };
}

/**
 * Formats a host-presence value for the markdown table.
 *
 * @param {import('./host-parity-core.mjs').HostPresence | 'skipped'} value
 * @returns {string}
 */
function cell(value) {
  if (value === true) return 'yes';
  if (value === false) return 'no';
  if (value === 'skipped') return 'skipped';
  return '?';
}

/**
 * Renders a parity report to a markdown table and verdict summary.
 *
 * @param {import('./host-parity-core.mjs').ParityReport} report
 * @returns {string} markdown string
 */
export function renderParity(report) {
  const lines = [
    `## Host-Parity Report (level ${REPRESENTATIVE_LEVEL})`,
    '',
    '| Hook script | claude | codex | agy | verdict |',
    '|---|:---:|:---:|:---:|:---:|',
  ];
  for (const row of report.loads) {
    const reasonNote = row.reason ? ` <!-- ${row.reason.slice(0, 80)} -->` : '';
    lines.push(`| ${row.name} | ${cell(row.claude)} | ${cell(row.codex)} | ${cell(row.agy)} | ${row.verdict} |${reasonNote}`);
  }
  lines.push('');
  if (report.gaps.length === 0) {
    lines.push('**Verdict: PARITY** — no silent gaps detected.');
  } else {
    lines.push(`**Verdict: GAPS FOUND (${report.gaps.length})**`);
    lines.push('');
    lines.push('Silent gaps (absent on ≥1 host with no declared reason):');
    for (const gap of report.gaps) {
      lines.push(`- \`${gap.name}\`: claude=${cell(gap.claude)}, codex=${cell(gap.codex)}, agy=${cell(gap.agy)}`);
    }
  }
  lines.push('');
  return lines.join('\n');
}

// ── CLI entrypoint (advisory: always exits 0) ────────────────────────────────
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const report = await checkParity();
  process.stdout.write(renderParity(report) + '\n');
  process.exit(0);
}
