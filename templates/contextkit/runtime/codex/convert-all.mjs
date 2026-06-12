#!/usr/bin/env node
/**
 * Batch converter: Claude Code commands/agents -> Codex skills/subagents.
 *
 * `--templates` is the kit build path:
 *   templates/claude/commands -> templates/codex/skills/<skill>/SKILL.md
 *   templates/claude/agents   -> templates/codex/agents/<agent>.toml
 *
 * Installed mode converts a project's `.claude/` customizations into the local
 * Codex host surfaces: `.agents/skills/source-command-*` and `.codex/agents`.
 */
import { readdir, readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve, join, relative, dirname, basename } from 'node:path';
import { ANTIGRAVITY_DIR, CODEX_DIR } from '../config/paths.mjs';
import { codexSkillName, convertCommandToSkill, convertAgentToToml } from './convert-core.mjs';

const ROOT = process.cwd();
const DRY_RUN = process.argv.includes('--dry-run');
const TEMPLATES_MODE = process.argv.includes('--templates');

const SRC_BASE = TEMPLATES_MODE ? 'templates/claude' : '.claude';
const DST_BASE = TEMPLATES_MODE ? 'templates/codex' : CODEX_DIR;
const SKILLS_DST = TEMPLATES_MODE ? resolve(ROOT, DST_BASE, 'skills') : resolve(ROOT, ANTIGRAVITY_DIR, 'skills');
const AGENTS_DST = resolve(ROOT, DST_BASE, 'agents');

async function listMdFiles(dir, base = dir) {
  const out = [];
  let entries;
  try { entries = await readdir(dir, { withFileTypes: true }); } catch { return out; }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...await listMdFiles(full, base));
    else if (entry.name.endsWith('.md') && entry.name !== 'README.md') out.push({ absolute: full, relative: relative(base, full) });
  }
  return out;
}

async function writeOutput(path, content) {
  if (DRY_RUN) {
    console.log(`  [dry-run] would write: ${relative(ROOT, path)}`);
    return;
  }
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content, 'utf-8');
}

async function cleanGenerated(dir) {
  if (DRY_RUN || !existsSync(dir)) return;
  await rm(dir, { recursive: true, force: true });
}

async function main() {
  const report = { skills: 0, agents: 0, errors: [] };
  if (TEMPLATES_MODE) {
    await cleanGenerated(SKILLS_DST);
    await cleanGenerated(AGENTS_DST);
  }

  for (const cmd of await listMdFiles(resolve(ROOT, SRC_BASE, 'commands'))) {
    try {
      const raw = await readFile(cmd.absolute, 'utf-8');
      const dst = join(SKILLS_DST, codexSkillName(cmd.relative), 'SKILL.md');
      await writeOutput(dst, convertCommandToSkill(raw, cmd.relative));
      report.skills++;
    } catch (err) {
      report.errors.push(`skill:${cmd.relative}: ${err.message}`);
    }
  }

  for (const agent of await listMdFiles(resolve(ROOT, SRC_BASE, 'agents'))) {
    try {
      const raw = await readFile(agent.absolute, 'utf-8');
      const dst = join(AGENTS_DST, `${basename(agent.relative, '.md')}.toml`);
      await writeOutput(dst, convertAgentToToml(raw, agent.relative));
      report.agents++;
    } catch (err) {
      report.errors.push(`agent:${agent.relative}: ${err.message}`);
    }
  }

  console.log(`Codex conversion complete${DRY_RUN ? ' (DRY RUN)' : ''}: ${report.skills} skills, ${report.agents} agents`);
  if (report.errors.length) {
    for (const err of report.errors) console.error(`  - ${err}`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Codex conversion failed:', err);
  process.exit(1);
});
