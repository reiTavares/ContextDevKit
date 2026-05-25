/**
 * CLI surface for the installer: argument parsing, the `--help` text, the
 * interactive prompt helper, and the human-readable level labels.
 */

export function parseArgs(argv) {
  const args = { yes: false, rewire: false, force: false, uninstall: false, help: false, version: false, purge: false, update: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--yes' || a === '-y') args.yes = true;
    else if (a === '--update') { args.update = true; args.yes = true; }
    else if (a === '--rewire') args.rewire = true;
    else if (a === '--force') args.force = true;
    else if (a === '--uninstall') args.uninstall = true;
    else if (a === '--purge') args.purge = true;
    else if (a === '--help' || a === '-h') args.help = true;
    else if (a === '--version' || a === '-v') args.version = true;
    else if (a === '--target') args.target = argv[++i];
    else if (a === '--level') args.level = Number(argv[++i]);
    else if (a === '--name') args.name = argv[++i];
    else if (a === '--mode') args.mode = argv[++i];
    else if (a === '--preset') args.preset = argv[++i];
  }
  return args;
}

export const HELP = `
🌀 VibeDevKit installer

Usage:
  node install.mjs [--target <path>] [--level <1-7>] [--name <str>]
                   [--mode greenfield|existing] [--yes] [--force]
  node install.mjs --update                   safe update: refresh engine + commands,
                                              keep your level/config/memory/CLAUDE.md
  node install.mjs --rewire --level <1-7>     only recompose .claude/settings.json
  node install.mjs --uninstall [--purge]      unwire hooks (--purge also removes engine)
  node install.mjs --help | --version

Flags:
  --target <path>   destination project root (default: current directory)
  --level <1-7>     activation level (default: prompt, else 2)
  --name <string>   project name for the CLAUDE.md header
  --mode <m>        greenfield | existing (default: auto-detect)
  --preset <name>   stack preset to merge into config: next | go | python
  --yes, -y         non-interactive (use flags/defaults, no prompts)
  --force           overwrite CLAUDE.md / memory seeds if they exist
  --update          safe update: refresh engine/commands/agents + re-wire hooks for
                    the CURRENT level; never touches CLAUDE.md, config, or memory
  --rewire          only recompose settings.json for the given --level
  --uninstall       remove VibeDevKit hook wiring + git hooks (keeps memory)
  --purge           with --uninstall, also delete vibekit/ engine + commands/agents
  --help, -h        show this help
  --version, -v     print the kit version

After installing, open the project in Claude Code and run /setupvibedevkit.
`;

export async function prompt(rl, q, def) {
  const a = (await rl.question(`${q}${def ? ` (${def})` : ''}: `)).trim();
  return a || def || '';
}

export const LEVEL_LABELS = {
  1: 'L1 Memory — boot context, session log, ADRs, changelog',
  2: 'L2 Ledger — + drift detection (recommended start)',
  3: 'L3 Multi — + claims, worktrees, derived indices, git hooks',
  4: 'L4 Squads — + specialized sub-agents',
  5: 'L5 Proactive — + simulate-impact gate, tech-debt sweep, contract drift',
  6: 'L6 Autonomy & Insight — + /ship pipeline, /retro, metrics',
  7: 'L7 Ecosystem & Scale — + fleet (multi-repo), agent-tuning, visual tests, playbooks, token/cost insight',
};
