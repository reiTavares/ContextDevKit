#!/usr/bin/env node
/**
 * Batch converter: Claude Code commands/agents → Antigravity skills/personas.
 *
 * Reads every .md file from the source command/agent directories, strips the
 * frontmatter, adapts Claude-specific references, and writes the Antigravity
 * equivalent preserving directory structure.
 *
 * Two modes (ticket 085):
 *   - default — INSTALLED project: .claude/ + contextkit/workflows → .antigravity/.
 *     For users converting their own custom commands.
 *   - --templates — KIT build step: templates/claude/ + templates/contextkit/workflows
 *     → templates/antigravity/. Run via `npm run build:antigravity` whenever a
 *     command/agent/playbook changes; NEVER part of the user install/--update path
 *     (the installer just copies templates/antigravity). Destinations are cleaned
 *     first (a top-level README.md is preserved) so renamed sources leave no orphans.
 *
 * Usage: node contextkit/runtime/antigravity/convert-all.mjs [--templates] [--dry-run]
 */
import { readdir, readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { resolve, join, relative, dirname, basename } from 'node:path';
import { existsSync } from 'node:fs';
import { PLATFORM_DIR } from '../config/paths.mjs';

const ROOT = process.cwd();
const DRY_RUN = process.argv.includes('--dry-run');
const TEMPLATES_MODE = process.argv.includes('--templates');

const SRC_BASE = TEMPLATES_MODE ? 'templates/claude' : '.claude';
const WF_BASE = TEMPLATES_MODE ? `templates/${PLATFORM_DIR}` : PLATFORM_DIR;
const DST_BASE = TEMPLATES_MODE ? 'templates/antigravity' : '.antigravity';

const COMMANDS_SRC = resolve(ROOT, SRC_BASE, 'commands');
const AGENTS_SRC = resolve(ROOT, SRC_BASE, 'agents');
const SKILLS_DST = resolve(ROOT, DST_BASE, 'skills');
const AGENTS_DST = resolve(ROOT, DST_BASE, 'agents');
const PLAYBOOKS_SRC = resolve(ROOT, WF_BASE, 'workflows/playbooks');
const PLAYBOOKS_DST = resolve(ROOT, DST_BASE, 'playbooks');
const WORKFLOWS_SRC = resolve(ROOT, WF_BASE, 'workflows');
const WORKFLOWS_DST = resolve(ROOT, DST_BASE, 'workflows');

/**
 * Strips YAML frontmatter (--- ... ---) from the content and extracts the
 * description for use as a header comment.
 */
function stripFrontmatter(content) {
  const fmMatch = content.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!fmMatch) return { body: content, description: null, argumentHint: null };

  const fm = fmMatch[1];
  const body = fmMatch[2];
  const descMatch = fm.match(/^description:\s*(.+)$/m);
  const argMatch = fm.match(/^argument-hint:\s*(.+)$/m);

  return {
    body: body.trimStart(),
    description: descMatch?.[1]?.trim() ?? null,
    argumentHint: argMatch?.[1]?.trim() ?? null,
  };
}

/**
 * Adapts Claude Code-specific references for Antigravity.
 */
function adaptContent(body, type, filename) {
  let adapted = body;

  // Replace $ARGUMENTS with instruction
  adapted = adapted.replace(/\$ARGUMENTS/g, '<user-specified argument>');

  // Replace TodoWrite references with Antigravity task tracking
  adapted = adapted.replace(/\bTodoWrite\b/g, 'task.md artifact (or equivalent tracking)');

  // Replace "delegate to `agent-name`" patterns with persona references
  adapted = adapted.replace(
    /delegate to [`']?(\w[\w-]*)['`]?/gi,
    'adopt the posture of `$1` (see `.antigravity/agents/$1.md`)'
  );

  // Replace .claude/ paths with .antigravity/ paths
  adapted = adapted.replace(/\.claude\/commands\//g, '.antigravity/skills/');
  adapted = adapted.replace(/\.claude\/agents\//g, '.antigravity/agents/');

  // Replace "slash command" terminology
  adapted = adapted.replace(/slash command/gi, 'skill');

  // Replace `/command-name` invocations with skill references  
  // (but NOT in code blocks or paths)
  adapted = adapted.replace(
    /(?<![`\/\w])\/(\w[\w-]*)\b(?!\.\w|\/)/g,
    (match, name) => `the \`${name}\` skill`
  );

  return adapted;
}

/**
 * Builds the Antigravity skill header from extracted frontmatter.
 */
function buildSkillHeader(filename, description, argumentHint) {
  const name = basename(filename, '.md');
  const lines = [`# Skill: ${name}`];
  if (description) lines.push('', `> ${description}`);
  if (argumentHint) lines.push(`> Argument: ${argumentHint}`);
  lines.push('');
  return lines.join('\n');
}

/**
 * Builds the Antigravity agent/persona header.
 */
function buildAgentHeader(filename, description) {
  const name = basename(filename, '.md');
  const lines = [`# Agent Persona: ${name}`];
  if (description) lines.push('', `> ${description}`);
  lines.push('', '> When asked to adopt this persona, follow the posture and rules below.');
  lines.push('');
  return lines.join('\n');
}

/**
 * Recursively lists all .md files in a directory.
 */
async function listMdFiles(dir, base = dir) {
  const results = [];
  let entries;
  try { entries = await readdir(dir, { withFileTypes: true }); } catch { return results; }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...await listMdFiles(full, base));
    } else if (entry.name.endsWith('.md')) {
      results.push({ absolute: full, relative: relative(base, full) });
    }
  }
  return results;
}

async function writeOutput(path, content) {
  if (DRY_RUN) {
    console.log(`  [dry-run] would write: ${relative(ROOT, path)}`);
    return;
  }
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content, 'utf-8');
}

/**
 * Empties a generated destination tree, preserving a top-level README.md
 * (hand-written index, e.g. skills/README.md). Templates mode only — the
 * trees are fully generated there, so a clean build is what prevents
 * renamed/removed sources from leaving stale orphans behind (ticket 085).
 */
async function cleanDst(dir) {
  if (DRY_RUN || !existsSync(dir)) return;
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (!entry.isDirectory() && entry.name === 'README.md') continue;
    await rm(join(dir, entry.name), { recursive: true, force: true });
  }
}

// ── main ──

async function main() {
  const report = { skills: 0, agents: 0, playbooks: 0, workflows: 0, errors: [] };

  if (TEMPLATES_MODE) {
    console.log('\n🧹 Templates mode: cleaning generated trees (top-level README.md kept)...');
    for (const d of [SKILLS_DST, AGENTS_DST, PLAYBOOKS_DST, WORKFLOWS_DST]) await cleanDst(d);
  }

  // 1. Convert slash commands → skills
  console.log('\n🔄 Converting slash commands → skills...');
  const commands = await listMdFiles(COMMANDS_SRC);
  for (const cmd of commands) {
    if (cmd.relative === 'README.md') continue; // skip the index
    try {
      const raw = await readFile(cmd.absolute, 'utf-8');
      const { body, description, argumentHint } = stripFrontmatter(raw);
      const adapted = adaptContent(body, 'skill', cmd.relative);
      const header = buildSkillHeader(cmd.relative, description, argumentHint);
      const output = header + adapted;
      const dst = join(SKILLS_DST, cmd.relative);
      await writeOutput(dst, output);
      console.log(`  ✓ ${cmd.relative}`);
      report.skills++;
    } catch (err) {
      console.log(`  ✗ ${cmd.relative}: ${err.message}`);
      report.errors.push(`skill:${cmd.relative}: ${err.message}`);
    }
  }

  // 2. Convert agents → personas
  console.log('\n🔄 Converting agents → personas...');
  const agents = await listMdFiles(AGENTS_SRC);
  for (const agent of agents) {
    try {
      const raw = await readFile(agent.absolute, 'utf-8');
      const { body, description } = stripFrontmatter(raw);
      const adapted = adaptContent(body, 'agent', agent.relative);
      const header = buildAgentHeader(agent.relative, description);
      const output = header + adapted;
      const dst = join(AGENTS_DST, agent.relative);
      await writeOutput(dst, output);
      console.log(`  ✓ ${agent.relative}`);
      report.agents++;
    } catch (err) {
      console.log(`  ✗ ${agent.relative}: ${err.message}`);
      report.errors.push(`agent:${agent.relative}: ${err.message}`);
    }
  }

  // 3. Copy playbooks
  console.log('\n🔄 Copying playbooks...');
  const playbooks = await listMdFiles(PLAYBOOKS_SRC);
  for (const pb of playbooks) {
    try {
      const raw = await readFile(pb.absolute, 'utf-8');
      const adapted = adaptContent(raw, 'playbook', pb.relative);
      const header = `# Playbook: ${basename(pb.relative, '.md')}\n\n> Reusable procedure. Follow the steps below when invoked.\n\n`;
      const dst = join(PLAYBOOKS_DST, pb.relative);
      await writeOutput(dst, header + adapted);
      console.log(`  ✓ ${pb.relative}`);
      report.playbooks++;
    } catch (err) {
      console.log(`  ✗ ${pb.relative}: ${err.message}`);
      report.errors.push(`playbook:${pb.relative}: ${err.message}`);
    }
  }

  // 4. Copy workflow guides (only .md files, not subdirs)
  console.log('\n🔄 Copying workflow guides...');
  try {
    const wfEntries = await readdir(WORKFLOWS_SRC);
    for (const f of wfEntries) {
      if (!f.endsWith('.md')) continue;
      try {
        const raw = await readFile(join(WORKFLOWS_SRC, f), 'utf-8');
        const adapted = adaptContent(raw, 'workflow', f);
        const dst = join(WORKFLOWS_DST, f);
        await writeOutput(dst, adapted);
        console.log(`  ✓ ${f}`);
        report.workflows++;
      } catch (err) {
        console.log(`  ✗ ${f}: ${err.message}`);
        report.errors.push(`workflow:${f}: ${err.message}`);
      }
    }
  } catch { /* no workflows dir */ }

  // ── summary ──
  console.log('\n' + '─'.repeat(50));
  console.log(`✅ Conversion complete${DRY_RUN ? ' (DRY RUN)' : ''}:`);
  console.log(`   Skills:    ${report.skills}`);
  console.log(`   Agents:    ${report.agents}`);
  console.log(`   Playbooks: ${report.playbooks}`);
  console.log(`   Workflows: ${report.workflows}`);
  console.log(`   TOTAL:     ${report.skills + report.agents + report.playbooks + report.workflows}`);
  if (report.errors.length > 0) {
    console.log(`   Errors:    ${report.errors.length}`);
    for (const e of report.errors) console.log(`     - ${e}`);
  }
  console.log('');
}

main().catch(err => { console.error('❌ Conversion failed:', err); process.exit(1); });
