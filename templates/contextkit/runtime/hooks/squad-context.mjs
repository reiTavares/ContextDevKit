/**
 * Runtime helper for active squad boot context.
 *
 * SessionStart stays responsible for orchestration; this module owns the
 * optional squad-director bridge and markdown rendering so hook startup remains
 * small, defensive, and zero-dependency.
 */
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { PLATFORM_DIR } from '../config/paths.mjs';

/**
 * Runs squad-director when L4+ squads are available.
 *
 * @param {string} root project root
 * @param {number} level ContextDevKit activation level
 * @returns {{squads: string[], agents: string[], playbooks: object[], agentScaffolding: string[]} | null}
 */
export function readSquadContext(root, level) {
  if (level < 4) return null;
  try {
    const scriptPath = resolve(root, PLATFORM_DIR, 'tools/scripts/squad-director.mjs');
    if (!existsSync(scriptPath)) return null;
    const rawOutput = execFileSync('node', [scriptPath], {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'ignore'],
    });
    return normalizeSquadContext(JSON.parse(rawOutput));
  } catch {
    return null;
  }
}

/**
 * Keeps only the fields SessionStart needs from squad-director output.
 *
 * @param {unknown} value parsed squad-director JSON
 */
export function normalizeSquadContext(value) {
  if (!value || typeof value !== 'object') return null;
  const record = value;
  const squads = stringList(record.squads);
  if (squads.length === 0) return null;
  return {
    squads,
    agents: stringList(record.agents),
    playbooks: Array.isArray(record.playbooks) ? record.playbooks : [],
    agentScaffolding: stringList(record.agentScaffolding),
  };
}

/**
 * Renders the optional boot-context block for active squads.
 *
 * @param {ReturnType<typeof normalizeSquadContext>} squadContext
 * @returns {string[]} lines to append to the boot context
 */
export function renderSquadContext(squadContext) {
  if (!squadContext || squadContext.squads.length === 0) return [];
  const lines = ['## Active Squad Postures', ''];
  for (let index = 0; index < squadContext.squads.length; index++) {
    const squad = squadContext.squads[index];
    const agent = squadContext.agents[index] || 'architect';
    const playbook = squadContext.playbooks.find((entry) => entry?.squad === squad);
    lines.push(`- **Squad: \`${squad}\`** (Suggested agent: \`${agent}\`)`);
    if (playbook?.path) lines.push(`  Playbook: \`${playbook.path}\``);
  }
  if (squadContext.agentScaffolding.length > 0) {
    lines.push('', '**Agent-Forge Suggestions:**');
    for (const suggestion of squadContext.agentScaffolding) lines.push(`- \`${suggestion}\``);
  }
  lines.push('');
  return lines;
}

function stringList(value) {
  return Array.isArray(value) ? value.filter((item) => typeof item === 'string' && item.length > 0) : [];
}
