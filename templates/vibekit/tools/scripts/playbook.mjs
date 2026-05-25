#!/usr/bin/env node
/**
 * Playbook registry + runner (roadmap #8 / L6).
 *
 * Playbooks are the reusable procedures in `vibekit/workflows/playbooks/` — the
 * "why / how / anti-patterns" behind a slash command. This turns that folder into
 * a managed layer: list what exists (the registry), show one, and record a run so
 * repeatable procedures become tracked, auditable assets. "Running" a playbook =
 * recording the run and printing the procedure for the agent to follow; the steps
 * themselves are executed by Claude, not this script.
 *
 * Usage:
 *   node vibekit/tools/scripts/playbook.mjs list
 *   node vibekit/tools/scripts/playbook.mjs show <name>
 *   node vibekit/tools/scripts/playbook.mjs run  <name> [outcome note...]
 *   node vibekit/tools/scripts/playbook.mjs runs
 *
 * Zero third-party deps; defensive (never throws fatally on a missing dir).
 */
import { existsSync, readdirSync, readFileSync, appendFileSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathsFor } from '../../runtime/config/paths.mjs';

const ROOT = process.cwd();
const P = pathsFor(ROOT);
const PLAYBOOKS_DIR = P.playbooks;
const RUNS_LOG = resolve(P.memory, 'playbook-runs.md');

/** All playbook files in the registry, sorted. */
function listFiles() {
  try {
    return readdirSync(PLAYBOOKS_DIR).filter((f) => f.endsWith('.md')).sort();
  } catch {
    return [];
  }
}

/** First `# ` heading of a playbook, as its human title. */
function titleOf(file) {
  try {
    const heading = readFileSync(join(PLAYBOOKS_DIR, file), 'utf-8').split('\n').find((l) => l.startsWith('# '));
    return heading ? heading.replace(/^#\s+/, '').trim() : file;
  } catch {
    return file;
  }
}

/** Resolves a user-given name to an existing playbook file (exact or sans-.md). */
function resolveName(name) {
  if (!name) return null;
  const files = listFiles();
  const want = name.endsWith('.md') ? name : `${name}.md`;
  return files.find((f) => f === want) || files.find((f) => f.replace(/\.md$/, '') === name) || null;
}

function unknown(name) {
  console.error(`Unknown playbook "${name}". Try: playbook.mjs list`);
  process.exit(1);
}

function list() {
  const files = listFiles();
  if (files.length === 0) {
    console.log('No playbooks found in vibekit/workflows/playbooks/.');
    return;
  }
  console.log(`📓 Playbooks (${files.length}) — vibekit/workflows/playbooks/\n`);
  for (const f of files) console.log(`  • ${f.replace(/\.md$/, '')} — ${titleOf(f)}`);
  console.log('\nRun one with:  node vibekit/tools/scripts/playbook.mjs run <name>');
}

function show(name) {
  const file = resolveName(name);
  if (!file) unknown(name);
  console.log(`# vibekit/workflows/playbooks/${file}\n`);
  console.log(readFileSync(join(PLAYBOOKS_DIR, file), 'utf-8'));
}

/** Records a run (best-effort) and prints the procedure for the agent to follow. */
function run(name, note) {
  const file = resolveName(name);
  if (!file) unknown(name);
  const when = new Date().toISOString();
  try {
    mkdirSync(P.memory, { recursive: true });
    if (!existsSync(RUNS_LOG)) {
      appendFileSync(RUNS_LOG, '# Playbook runs\n\n| When | Playbook | Note |\n| --- | --- | --- |\n', 'utf-8');
    }
    appendFileSync(RUNS_LOG, `| ${when} | ${file.replace(/\.md$/, '')} | ${note || '—'} |\n`, 'utf-8');
  } catch {
    /* tracking is best-effort — never block the run */
  }
  console.log(`▶️  Running playbook: ${file.replace(/\.md$/, '')} (recorded ${when.slice(0, 10)})`);
  console.log('   Follow the procedure below and apply its judgment:\n');
  console.log(readFileSync(join(PLAYBOOKS_DIR, file), 'utf-8'));
}

function runs() {
  if (!existsSync(RUNS_LOG)) {
    console.log('No playbook runs recorded yet.');
    return;
  }
  console.log(readFileSync(RUNS_LOG, 'utf-8'));
}

function main() {
  const [cmd, name, ...rest] = process.argv.slice(2);
  switch (cmd) {
    case 'list':
      return list();
    case 'show':
      return show(name);
    case 'run':
      return run(name, rest.join(' '));
    case 'runs':
      return runs();
    default:
      console.error('Usage: playbook.mjs <list | show <name> | run <name> [note] | runs>');
      process.exit(1);
  }
}

main();
