#!/usr/bin/env node
/**
 * Squad helper — the deterministic half of `/squad` (the command adds judgment).
 *
 * Scaffolds the **tier-2 rich briefing** for an agent into its squad folder, so
 * the two-tier pattern (lean agent in `.claude/agents/` + deep briefing in
 * `contextkit/squads/<squad>/`) is real, not just convention.
 *
 *   node .../squad.mjs list             # agents + which have a tier-2 briefing
 *   node .../squad.mjs brief <agent>    # scaffold contextkit/squads/<squad>/<agent>.md
 *   node .../squad.mjs activate <path>  # persist active squad posture in ledger
 *
 * Squad detection: `qa-*` → qa-team; otherwise the `(... squad)` / `(...-team)`
 * tag in the agent's `description`; falls back to `devteam`.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { squadOf } from './squad-meta.mjs';
import { pathsFor } from '../../runtime/config/paths.mjs';
import { analyzeContext } from './squad-director.mjs';
import { readMostRecentLedger, writeLedger } from '../../runtime/hooks/ledger.mjs';

const ROOT = process.cwd();
const AGENTS = resolve(ROOT, '.claude/agents');
const SQUADS = pathsFor(ROOT).squads;
const squadFor = (agent) => squadOf(AGENTS, agent);

function listAgents() {
  try {
    return readdirSync(AGENTS).filter((f) => f.endsWith('.md') && f !== '_TEMPLATE.md').map((f) => f.slice(0, -3));
  } catch {
    return [];
  }
}

function brief() {
  const agent = process.argv[3];
  if (!agent) {
    console.error('Usage: squad.mjs brief <agent>');
    process.exit(1);
  }
  if (!existsSync(resolve(AGENTS, `${agent}.md`))) {
    console.error(`No agent at .claude/agents/${agent}.md (Level < 4?).`);
    process.exit(1);
  }
  const squad = squadFor(agent);
  mkdirSync(resolve(SQUADS, squad), { recursive: true });
  const dest = resolve(SQUADS, squad, `${agent}.md`);
  if (existsSync(dest)) {
    console.log(`ℹ️  Briefing already exists: contextkit/squads/${squad}/${agent}.md`);
    return;
  }
  let tpl = '# {{AGENT}} — rich briefing ({{SQUAD}} squad)\n';
  try {
    tpl = readFileSync(resolve(SQUADS, '_BRIEFING.md.tpl'), 'utf-8');
  } catch {
    /* fall back to the one-line stub */
  }
  writeFileSync(dest, tpl.replaceAll('{{AGENT}}', agent).replaceAll('{{SQUAD}}', squad), 'utf-8');
  console.log(`✅ Scaffolded contextkit/squads/${squad}/${agent}.md — now fill it with real anti-patterns / recipes / edge cases.`);
}

function list() {
  const agents = listAgents();
  if (agents.length === 0) {
    console.log('No agents found (Level < 4?). Run /context-level 4 to install the squads.');
    return;
  }
  console.log(`👥 ${agents.length} agents (📄 = has a tier-2 briefing):`);
  for (const a of agents) {
    const squad = squadFor(a);
    const has = existsSync(resolve(SQUADS, squad, `${a}.md`));
    console.log(`   ${has ? '📄' : '  '} ${a} — ${squad}`);
  }
}

function route() {
  const query = process.argv.slice(3).join(' ');
  console.log('🔍 Analyzing active project intent and file diffs...');
  const result = analyzeContext(query);

  console.log('\n👥 Suggested Active Postures:');
  for (let i = 0; i < result.squads.length; i++) {
    const squad = result.squads[i];
    const agent = result.agents[i] || 'architect';
    const playbook = result.playbooks.find(p => p.squad === squad);
    console.log(`  • Squad: \x1b[32m${squad}\x1b[0m (Agent: \x1b[36m${agent}\x1b[0m)`);
    if (playbook) {
      console.log(`    Playbook: \x1b[34m${playbook.path}\x1b[0m`);
    }
  }

  if (result.agentScaffolding && result.agentScaffolding.length > 0) {
    console.log('\n🤖 Agent-Forge Suggestions:');
    console.log('  Your project contains stack components with no custom agent coverage.');
    console.log('  Consider scaffolding the following agents using `/forge-new`:');
    for (const sug of result.agentScaffolding) {
      console.log(`    • \x1b[33m${sug}\x1b[0m`);
    }
  }
  console.log('');
}

/**
 * Persists detected squad postures in the current session ledger.
 *
 * @returns {Promise<void>}
 */
async function activate() {
  const query = process.argv.slice(3).join(' ');
  if (!query) {
    console.error('Usage: squad.mjs activate <intent-or-path>');
    process.exit(1);
  }
  const context = analyzeContext(query);
  const recent = await readMostRecentLedger();
  if (!recent?.ledger) {
    console.error('No active session ledger found. Start a session or record a simulation first.');
    process.exit(1);
  }
  const existingSquads = Array.isArray(recent.ledger.squads) ? recent.ledger.squads : [];
  const activeSquads = [...new Set([...existingSquads, ...context.squads].filter(Boolean))];
  recent.ledger.squads = activeSquads;
  await writeLedger(recent.sessionId, recent.ledger);
  console.log(`✅ Active squad postures recorded for session ${recent.sessionId.slice(0, 8)}: ${activeSquads.join(', ')}`);
}

function generatePlaybooks() {
  const destDir = resolve(pathsFor(ROOT).playbooks, 'squads');
  mkdirSync(destDir, { recursive: true });
  console.log(`✅ Squad playbooks directory verified: ${destDir}`);
}

async function main() {
  const cmd = process.argv[2];
  if (cmd === 'brief') brief();
  else if (cmd === 'list') list();
  else if (cmd === 'route') route();
  else if (cmd === 'activate') await activate();
  else if (cmd === 'generate-playbooks') generatePlaybooks();
  else {
    console.error('Usage: squad.mjs <list | brief <agent> | route [intent] | activate <intent-or-path> | generate-playbooks>');
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(`squad.mjs failed: ${err?.message ?? err}`);
  process.exit(1);
});
