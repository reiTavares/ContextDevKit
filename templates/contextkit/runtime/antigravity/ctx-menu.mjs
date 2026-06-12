/**
 * Presentation layer for the ctx.mjs / `agy` CLI runner: the categorised command
 * registry, the help menu, and per-command descriptions. Split out of ctx.mjs so
 * the runner keeps only dispatch logic (file-size budget + SRP); ctx.mjs imports
 * this dynamically and degrades to a minimal usage text when the engine is absent.
 */
import { basename } from 'node:path';

/** Categorised description registry for ease of identification. */
export const CATEGORIES = [
  {
    name: '⚙️  Configuration & Diagnostics',
    scripts: {
      'autonomy': 'Show/set the autonomy dial — consent grade 1-4 (ADR-0041)',
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
      'guard': 'Explicit pre-edit checkpoint for high-risk paths (L5 governance parity)',
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

/**
 * Looks a command up in the registry.
 * @param {string} name command name (no extension)
 * @returns {{category: string, description: string} | null}
 */
export function describeCommand(name) {
  for (const cat of CATEGORIES) {
    if (cat.scripts[name]) return { category: cat.name, description: cat.scripts[name] };
  }
  return null;
}

/**
 * Prints the categorised command menu to console.
 * @param {string[]} availableFiles list of available files in scripts directory
 */
export function printHelp(availableFiles = [], opts = {}) {
  const hostLabel = opts.hostLabel ?? 'Antigravity';
  const runnerFile = opts.runnerFile ?? 'ctx.mjs';
  console.log('\n==================================================');
  console.log(`🛡️  ContextDevKit Command Runner (${hostLabel})`);
  console.log('==================================================\n');
  console.log('Usage:');
  console.log(`  node ${runnerFile} <command> [...args]`);
  console.log(`  node ${runnerFile} help <command>\n`);
  console.log('Example:');
  console.log(`  node ${runnerFile} doctor`);
  console.log(`  node ${runnerFile} pipeline list`);
  console.log(`  node ${runnerFile} tech-debt --write\n`);
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

  const catalogued = new Set(CATEGORIES.flatMap(c => Object.keys(c.scripts)));
  const uncatalogued = [];
  for (const f of availableFiles) {
    const name = basename(f, '.mjs');
    if (!catalogued.has(name) && name !== 'home') uncatalogued.push(name);
  }
  if (uncatalogued.length > 0) {
    console.log('\x1b[33mUncategorized Utilities:\x1b[0m');
    console.log(`  ${uncatalogued.join(', ')}\n`);
  }
}
