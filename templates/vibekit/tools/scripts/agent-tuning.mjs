#!/usr/bin/env node
/**
 * Agent-tuning signals — the deterministic half of /tune-agents.
 *
 * Aggregates the signals available for refining agent briefings: the roster +
 * tier-2 briefing coverage, and how often each agent is referenced across the
 * session history (a usage proxy). `/tune-agents` reads this, adds judgment, and
 * PROPOSES briefing edits — it never auto-applies (mirrors /distill-sessions).
 *
 *   agent-tuning.mjs            # human summary
 *   agent-tuning.mjs --json     # { agents: [...], sessionsAnalyzed, withoutBriefing }
 *
 * Zero-dependency, defensive: degrades to empty signals, never throws.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = process.cwd();
const AGENTS = resolve(ROOT, '.claude/agents');
const SQUADS = resolve(ROOT, 'vibekit/squads');
const SESSIONS = resolve(ROOT, 'vibekit/memory/sessions');

function read(p) {
  try {
    return readFileSync(p, 'utf-8');
  } catch {
    return '';
  }
}

function listMd(dir) {
  try {
    return readdirSync(dir).filter((f) => f.endsWith('.md'));
  } catch {
    return [];
  }
}

// Squad detection mirrors squad.mjs: qa-* → qa-team; else the (...-team) tag in
// the agent's description; falls back to devteam.
function squadOf(agent) {
  if (/^qa-/.test(agent)) return 'qa-team';
  const fm = read(resolve(AGENTS, `${agent}.md`)).match(/^---\n([\s\S]*?)\n---/);
  const desc = (fm && /description:\s*(.*)/.exec(fm[1])?.[1]) || '';
  const m = desc.match(/\(([a-z][a-z0-9-]*?)(?: squad)?\)\s*$/i);
  return m ? m[1] : 'devteam';
}

function collect() {
  const agentFiles = listMd(AGENTS).filter((f) => f !== '_TEMPLATE.md');
  const sessions = listMd(SESSIONS).map((f) => read(resolve(SESSIONS, f)));
  const agents = agentFiles.map((f) => {
    const name = f.slice(0, -3);
    const squad = squadOf(name);
    return {
      name,
      squad,
      hasBriefing: existsSync(resolve(SQUADS, squad, `${name}.md`)),
      mentions: sessions.filter((s) => s.includes(name)).length,
    };
  });
  agents.sort((a, b) => b.mentions - a.mentions);
  return { agents, sessionsAnalyzed: sessions.length, withoutBriefing: agents.filter((a) => !a.hasBriefing).map((a) => a.name) };
}

function main() {
  const s = collect();
  if (process.argv.includes('--json')) {
    process.stdout.write(JSON.stringify(s, null, 2) + '\n');
    return;
  }
  if (!s.agents.length) {
    console.log('🎯 agent-tuning: no agents found (Level < 4?).');
    return;
  }
  console.log(`🎯 agent-tuning signals — ${s.agents.length} agents, ${s.sessionsAnalyzed} sessions analyzed\n`);
  for (const a of s.agents) console.log(`   ${a.hasBriefing ? '📄' : '  '} ${a.name}  (${a.squad})  ${a.mentions} mention(s)`);
  console.log(`\n   ${s.withoutBriefing.length} agent(s) without a tier-2 briefing. Run /tune-agents to propose refinements.`);
}

main();
