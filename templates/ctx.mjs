#!/usr/bin/env node
/**
 * ContextDevKit central CLI runner for Antigravity.
 *
 * Automatically routes commands to scripts in contextkit/tools/scripts/
 * and provides a categorised, easy-to-identify help system.
 *
 * Usage:
 *   node ctx.mjs <command> [...args]
 *   node ctx.mjs (displays categorised help menu)
 */
import { spawn } from 'node:child_process';
import { readdir, readFile } from 'node:fs/promises';
import { resolve, join, basename, dirname } from 'node:path';

const ROOT = process.cwd();
const SCRIPTS_DIR = resolve(ROOT, 'contextkit/tools/scripts');

// Categorised description registry for ease of identification
const CATEGORIES = [
  {
    name: '⚙️  Configuration & Diagnostics',
    scripts: {
      'context-level': 'Query or set current project level (L1–L7)',
      'context-config': 'Query or modify configuration parameters in config.json',
      'doctor': 'Diagnose installation health (git hooks, configs, paths, directories)',
      'setup-complete': 'Verifies setup execution matches expected level configuration'
    }
  },
  {
    name: '🧠 Memory & Sessions',
    scripts: {
      'log-session': 'Create a new session log and record details of recent work',
      'session': 'Start, check status, or conclude active work sessions',
      'new-adr': 'Generate a new Architecture Decision Record (ADR) file',
      'session-reindex': 'Rebuild the master sessions index (SESSIONS.md)',
      'session-digest': 'Generates a summarized digest of a session\'s changes',
      'adr-digest': 'Build and search indices of existing ADR records',
      'distill-sessions': 'Condense past session records into high-level summaries',
      'distill-apply': 'Apply distilled memory back to the boot context',
      'clean-drive': 'Cleans the registry ledger of registered/temporary paths',
      'draft-changelog': 'Drafts a changelog based on unregistered ledger logs'
    }
  },
  {
    name: '📋 DevPipeline & Workflows',
    scripts: {
      'pipeline': 'CLI board to manage lanes (backlog, working, testing, conclusion)',
      'pipeline-board': 'Formats and displays the DevPipeline task board',
      'pipeline-session': 'Integrates session lifecycle with DevPipeline tasks',
      'pipeline-prioritize': 'Automates backlog card prioritization (WSJF/due-dates)',
      'pipeline-validate': 'Validates task backlog directory integrity',
      'dev-start': 'Bootstraps a focused task lane, checking branch rules',
      'ship': 'Orchestrates squad verification, runs test suites, pushes and cleans up',
      'resume': 'Resumes a paused lane or branch',
      'runs': 'Log or list active execution runs',
      'roadmap': 'Manage roadmap features and business requirements',
      'complexity-rubric': 'Computes complexity category of a task to determine lane checks',
      'workflow': 'CLI helper to interact with levels/workflows'
    }
  },
  {
    name: '🔍 Audits & Code Quality',
    scripts: {
      'tech-debt-scan': 'Scan codebase for TODO/FIXME markers and code smells',
      'analyze-code-ia-practices': 'Evaluate files against file-size budgets and SRP',
      'deps-audit': 'Checks third-party packages for outdated versions or licensing',
      'contract-scan': 'Scan codebase interface contracts and invariants',
      'seo-audit': 'Audit meta tags, titles, headings, and semantic markup',
      'aiso-audit': 'Audit AI Search Engine Optimization compliance and visibility',
      'validate-doc': 'Audit markdown documentation against completeness standards',
      'security-setup': 'Setup/run vulnerability detection and secret exposure scans',
      'deep-analysis': 'Scans import graphs, code coupling, and structural debt',
      'detect-stack': 'Detects stack technologies (Next.js, Vite, Nest, etc.)'
    }
  },
  {
    name: '👥 Squads & Agent Forge',
    scripts: {
      'squad': 'Manage squad allocations and metadata',
      'squad-pipeline': 'Orchestrates multi-agent pipeline executions',
      'agent-tuning': 'Evaluates performance profiles of personas',
      'forge-new': 'Define and bootstrap a new specialized sub-agent',
      'forge-list': 'List defined agent manifests',
      'forge-show': 'Shows details of a specific agent',
      'forge-doctor': 'Checks agent health and policy constraints',
      'forge-policy': 'Configures agent permissions and boundaries',
      'forge-budget': 'Track token budgets per agent',
      'forge-audit': 'Audits agent actions against policy',
      'forge-eval': 'Runs agent evaluation benchmarks',
      'forge-redteam': 'Executes red-team security audits on agents',
      'forge-route': 'Route requests to the optimal model based on prompt complexity'
    }
  },
  {
    name: '🔌 VCS, Git & Synchronization',
    scripts: {
      'claim': 'Register a lock on a file path to prevent concurrent conflicts',
      'release': 'Release a claimed file lock',
      'sync-check': 'Verifies workspace directories alignment',
      'workspace-sync': 'Syncs workspaces across local setups',
      'worktree-new': 'Scaffold git worktrees',
      'watch': 'Watch workspace for modifications',
      'fleet': 'Orchestrate control commands across multi-repo fleets',
      'gh-alerts': 'Integrates GitHub notifications and issues triage'
    }
  }
];

// Helper aliases for quick commands
const ALIASES = {
  'level': 'context-level.mjs',
  'config': 'context-config.mjs',
  'pack': 'context-pack.mjs',
  'tech-debt': 'tech-debt-scan.mjs',
  'ia-practices': 'analyze-code-ia-practices.mjs',
  'seo': 'seo-audit.mjs',
  'aiso': 'aiso-audit.mjs',
  'validation': 'validate-doc.mjs'
};

/**
 * Searches for a script matching the given command argument.
 * Supports exact name, prefix, and common aliases.
 *
 * @param {string} cmd  user command input
 * @returns {Promise<string | null>} absolute path to script if found, or null
 */
async function findScript(cmd) {
  try {
    const files = await readdir(SCRIPTS_DIR);
    const mjsFiles = files.filter(f => f.endsWith('.mjs'));
    const cleanCmd = cmd.toLowerCase().replace(/\.mjs$/, '');

    // 1. Exact match (e.g. "doctor" -> "doctor.mjs")
    const exact = mjsFiles.find(f => basename(f, '.mjs').toLowerCase() === cleanCmd);
    if (exact) return join(SCRIPTS_DIR, exact);

    // 2. Prefix match (e.g. "tech-debt" -> "tech-debt-scan.mjs")
    const prefix = mjsFiles.find(f => basename(f, '.mjs').toLowerCase().startsWith(cleanCmd));
    if (prefix) return join(SCRIPTS_DIR, prefix);

    // 3. Shorthand maps for common aliases
    if (ALIASES[cleanCmd]) {
      const aliasTarget = ALIASES[cleanCmd];
      if (mjsFiles.includes(aliasTarget)) return join(SCRIPTS_DIR, aliasTarget);
    }
  } catch {
    return null;
  }
  return null;
}

/**
 * Prints the categorised command menu to console.
 *
 * @param {string[]} availableFiles list of available files in scripts directory
 */
function printHelp(availableFiles = []) {
  console.log('\n==================================================');
  console.log('🛡️  ContextDevKit Command Runner (Antigravity)');
  console.log('==================================================\n');
  console.log('Usage:');
  console.log('  node ctx.mjs <command> [...args]\n');
  console.log('Example:');
  console.log('  node ctx.mjs doctor');
  console.log('  node ctx.mjs pipeline list');
  console.log('  node ctx.mjs tech-debt --write\n');
  console.log('Note: Pure prompt slash commands (e.g. bug-hunt, advise) are also supported');
  console.log('      and will print their instructions to the console.\n');

  console.log('Commands by category:\n');
  for (const cat of CATEGORIES) {
    console.log(`\x1b[36m${cat.name}\x1b[0m`);
    for (const [key, desc] of Object.entries(cat.scripts)) {
      console.log(`  \x1b[1m${key.padEnd(25)}\x1b[0m : ${desc}`);
    }
    console.log('');
  }

  // Find other scripts that exist in the directory but are not in the categories list
  const catalogued = new Set(CATEGORIES.flatMap(c => Object.keys(c.scripts)));
  const uncatalogued = [];
  for (const f of availableFiles) {
    const name = basename(f, '.mjs');
    if (!catalogued.has(name) && name !== 'home') {
      uncatalogued.push(name);
    }
  }
  if (uncatalogued.length > 0) {
    console.log('\x1b[33mUncategorized Utilities:\x1b[0m');
    console.log(`  ${uncatalogued.join(', ')}\n`);
  }
}

async function walkDir(dir, filterFn) {
  let results = [];
  try {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const res = join(dir, entry.name);
      if (entry.isDirectory()) results.push(...(await walkDir(res, filterFn)));
      else if (filterFn(res)) results.push(res);
    }
  } catch {}
  return results;
}

async function findCommandMd(cmd) {
  const cleanCmd = cmd.toLowerCase().replace(/\.md$/, '');
  const filter = (p) => basename(p, '.md').toLowerCase() === cleanCmd;
  const match = (await walkDir(resolve(ROOT, '.claude/commands'), filter))[0]
    || (await walkDir(resolve(ROOT, 'templates/claude/commands'), filter))[0];
  return match || null;
}

function printMarkdownCommand(filePath, fileContent, args = []) {
  let content = fileContent.replace(/\$ARGUMENTS/g, args.join(' ') || '[Nenhum argumento fornecido]');
  let fm = '';
  if (content.startsWith('---')) {
    const parts = content.split('---');
    if (parts.length >= 3) {
      fm = parts[1].trim();
      content = parts.slice(2).join('---').trim();
    }
  }
  console.log(`\n==================================================\n📖 Slash Command: /${basename(filePath, '.md')}\n==================================================`);
  if (fm) console.log(`\n\x1b[36mMetadata:\x1b[0m\n${fm.split('\n').map(l => '  ' + l).join('\n')}`);
  console.log(`\n\x1b[32mInstructions:\x1b[0m\n${content}\n==================================================\n`);
}

async function main() {
  const args = process.argv.slice(2);
  const cmd = args[0];

  if (!cmd || cmd === '--help' || cmd === '-h') {
    let files = [];
    try { files = await readdir(SCRIPTS_DIR); } catch {}
    printHelp(files.filter(f => f.endsWith('.mjs')));
    process.exit(0);
  }

  if (cmd === 'session') {
    const sessionManagerPath = resolve(ROOT, 'context' + 'kit/runtime/antigravity/session-manager.mjs');
    const child = spawn('node', [sessionManagerPath, ...args.slice(1)], { cwd: ROOT, stdio: 'inherit' });
    child.on('exit', (code) => process.exit(code ?? 0));
    return;
  }

  const scriptPath = await findScript(cmd);
  if (scriptPath) {
    const child = spawn('node', [scriptPath, ...args.slice(1)], { cwd: ROOT, stdio: 'inherit' });
    child.on('exit', (code) => process.exit(code ?? 0));
    return;
  }

  const cmdMdPath = await findCommandMd(cmd);
  if (cmdMdPath) {
    try {
      printMarkdownCommand(cmdMdPath, await readFile(cmdMdPath, 'utf8'), args.slice(1));
      process.exit(0);
    } catch (err) {
      console.error(`❌ Error reading command file: ${err.message}`);
      process.exit(1);
    }
    return;
  }

  console.error(`\n❌ Unknown command: "${cmd}"`);
  let files = [];
  try { files = await readdir(SCRIPTS_DIR); } catch {}
  printHelp(files.filter(f => f.endsWith('.mjs')));
  process.exit(1);
}

main().catch(err => {
  console.error('❌ Runner error:', err);
  process.exit(1);
});

