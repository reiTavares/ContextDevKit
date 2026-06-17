/**
 * CLI surface for the installer: argument parsing, the `--help` text, the
 * interactive prompt helper, and the human-readable level labels.
 */
export { LEVEL_LABELS } from '../../templates/contextkit/runtime/config/levels.mjs';

export function parseArgs(argv) {
  const args = { yes: false, rewire: false, force: false, uninstall: false, help: false, version: false, purge: false, update: false, migrate: false, dryRun: false, tracked: false, allowActiveSessions: false, allowSelfUpdate: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--yes' || a === '-y') args.yes = true;
    else if (a === '--update') { args.update = true; args.yes = true; }
    else if (a === '--migrate') args.migrate = true;
    else if (a === '--dry-run') args.dryRun = true;
    else if (a === '--tracked') args.tracked = true;
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
    else if (a === '--ci-squad') args.ciSquad = true; // ADR-0064 opt-in (left undefined → prompt/skip)
    else if (a === '--allow-active-sessions') args.allowActiveSessions = true; // P0-02: bypass active-session defer
    else if (a === '--allow-self-update') args.allowSelfUpdate = true; // P0-03: bypass self-host defer
  }
  return args;
}

export const HELP = `
🌀 ContextDevKit installer

Usage:
  node install.mjs [--target <path>] [--level <1-7>] [--name <str>]
                   [--mode greenfield|existing] [--yes] [--force]
  node install.mjs --update                   safe update: refresh engine + commands,
                                              keep your level/config/memory/CLAUDE.md
  node install.mjs --migrate [--dry-run]      carry a legacy vibekit/ install forward
                                              to contextkit/ (preview with --dry-run)
  node install.mjs --rewire --level <1-7>     only recompose .claude/settings.json
  node install.mjs --uninstall [--purge]      unwire hooks (--purge also removes engine)
  node install.mjs --help | --version

Flags:
  --target <path>   destination project root (default: current directory)
  --level <1-7>     activation level (default: prompt, else 2)
  --name <string>   project name for the CLAUDE.md header
  --mode <m>        greenfield | existing (default: auto-detect)
  --preset <name>   stack preset to merge into config: next | go | python
  --ci-squad        also install the CI Squad GitHub Action (issue→draft PR, ADR-0064).
                    Opt-in: needs the ANTHROPIC_API_KEY repo secret; off unless asked.
  --yes, -y         non-interactive (use flags/defaults, no prompts)
  --force           overwrite CLAUDE.md / memory seeds if they exist
  --update          safe update: refresh engine/commands/agents + re-wire hooks for
                    the CURRENT level. Never modifies user-authored memory (ADRs,
                    sessions, roadmap, project docs), CLAUDE.md, or config. Derived
                    artifacts (project-map) may be refreshed when safe. Defers on
                    active sessions / self-update (override: --allow-* flags).
                    Files YOU personalized are kept; a real conflict (you changed it
                    AND the kit changed it) asks you — keep both / replace / keep mine
                    (no TTY: keeps yours + stashes the kit's under contextkit/.updates/)
  --allow-active-sessions   with --update: proceed even when active sessions are
                    detected (default: defer with zero writes). Snapshots first.
  --allow-self-update       with --update: proceed when updating the kit's own
                    source repo (default: defer). Both flags are required when
                    active sessions AND a self-update are both detected.
  --tracked         commit the install: skip the local git exclude the installer
                    writes by default (default: install artifacts stay untracked,
                    so updates never flood your git history)
  --migrate         carry a legacy vibekit/ install forward to contextkit/ (moves the
                    folder, preserves memory/config, rewires settings/CLAUDE.md/hooks)
  --dry-run         with --migrate: report what would change without writing
  --rewire          only recompose settings.json for the given --level
  --uninstall       remove ContextDevKit hook wiring + git hooks (keeps memory)
  --purge           with --uninstall, also delete contextkit/ engine + commands/agents
  --help, -h        show this help
  --version, -v     print the kit version

After installing, open the project in Claude Code and run /setupcontextdevkit.
`;

export async function prompt(rl, q, def) {
  const a = (await rl.question(`${q}${def ? ` (${def})` : ''}: `)).trim();
  return a || def || '';
}
