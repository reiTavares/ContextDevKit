#!/usr/bin/env node
/**
 * Squad helper — the deterministic half of `/squad` (the command adds judgment).
 *
 * Scaffolds the **tier-2 rich briefing** for an agent into its squad folder, so
 * the two-tier pattern (lean agent in `.claude/agents/` + deep briefing in
 * `vibekit/squads/<squad>/`) is real, not just convention.
 *
 *   node .../squad.mjs list             # agents + which have a tier-2 briefing
 *   node .../squad.mjs brief <agent>    # scaffold vibekit/squads/<squad>/<agent>.md
 *
 * Squad detection: `qa-*` → qa-team; otherwise the `(... squad)` / `(...-team)`
 * tag in the agent's `description`; falls back to `devteam`.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { squadOf } from './squad-meta.mjs';

const ROOT = process.cwd();
const AGENTS = resolve(ROOT, '.claude/agents');
const SQUADS = resolve(ROOT, 'vibekit/squads');
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
    console.log(`ℹ️  Briefing already exists: vibekit/squads/${squad}/${agent}.md`);
    return;
  }
  let tpl = '# {{AGENT}} — rich briefing ({{SQUAD}} squad)\n';
  try {
    tpl = readFileSync(resolve(SQUADS, '_BRIEFING.md.tpl'), 'utf-8');
  } catch {
    /* fall back to the one-line stub */
  }
  writeFileSync(dest, tpl.replaceAll('{{AGENT}}', agent).replaceAll('{{SQUAD}}', squad), 'utf-8');
  console.log(`✅ Scaffolded vibekit/squads/${squad}/${agent}.md — now fill it with real anti-patterns / recipes / edge cases.`);
}

function list() {
  const agents = listAgents();
  if (agents.length === 0) {
    console.log('No agents found (Level < 4?). Run /vibe-level 4 to install the squads.');
    return;
  }
  console.log(`👥 ${agents.length} agents (📄 = has a tier-2 briefing):`);
  for (const a of agents) {
    const squad = squadFor(a);
    const has = existsSync(resolve(SQUADS, squad, `${a}.md`));
    console.log(`   ${has ? '📄' : '  '} ${a} — ${squad}`);
  }
}

const cmd = process.argv[2];
if (cmd === 'brief') brief();
else if (cmd === 'list') list();
else {
  console.error('Usage: squad.mjs <list | brief <agent>>');
  process.exit(1);
}
