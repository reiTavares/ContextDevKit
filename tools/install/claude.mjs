/**
 * Claude Code host installation — the original native host [ADR-0037].
 *
 * Everything Claude Code reads: `.claude/settings.json` (the hook wiring), the
 * slash commands, the L4+ agent archetypes + agent-forge squad, and the rendered
 * `CLAUDE.md`. `wireClaudeSettings` is kept separate because `--rewire` touches ONLY
 * the settings and returns early. The host-neutral engine lives in engine.mjs; the
 * Antigravity host in antigravity.mjs.
 */
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { composeSettings } from '../../templates/contextkit/runtime/config/settings-compose.mjs';
import { detectStack } from './project.mjs';
import { read, overwrite, copyTree, render } from './fs.mjs';
import { syncTree } from './sync.mjs';

/**
 * Writes `.claude/settings.json` composed for the level, merging an existing file.
 * The only step `--rewire` runs — keep it standalone so that early-return is clean.
 * @param {string} target - project root
 * @param {number} level - active level
 * @param {string[]} report - mutated with a progress line
 */
export async function wireClaudeSettings(target, level, report) {
  const settingsPath = join(target, '.claude', 'settings.json');
  let existingSettings = null;
  if (existsSync(settingsPath)) {
    try {
      existingSettings = JSON.parse(await read(settingsPath));
    } catch {
      report.push('⚠️  existing .claude/settings.json was malformed — recreated');
    }
  }
  await overwrite(settingsPath, JSON.stringify(composeSettings(existingSettings, level), null, 2) + '\n');
  report.push(`✓ .claude/settings.json wired for L${level}`);
}

/** Renders CLAUDE.md when missing; on a name collision drops a side file to merge. Never touched on --update. */
async function installClaudeMd(target, tplDir, ctx, report) {
  const claudePath = join(target, 'CLAUDE.md');
  if (ctx.args.update && existsSync(claudePath)) return; // leave the user's CLAUDE.md untouched
  const claudeTpl = await read(join(tplDir, 'CLAUDE.md.tpl'));
  const claudeOut = render(claudeTpl, {
    PROJECT_NAME: ctx.name,
    DATE: new Date().toISOString().slice(0, 10),
    LEVEL: String(ctx.level),
    MODE: ctx.mode,
    STACK_NOTES: ctx.mode === 'existing' ? await detectStack(target) : 'Greenfield — define the stack as the first architectural decision (`/new-adr`).',
  });
  if (!existsSync(claudePath) || ctx.args.force) {
    await overwrite(claudePath, claudeOut);
    report.push('✓ CLAUDE.md created');
  } else {
    await overwrite(join(target, 'CLAUDE.contextdevkit.md'), claudeOut);
    report.push('⚠️  CLAUDE.md exists — wrote CLAUDE.contextdevkit.md to merge by hand');
  }
}

/**
 * Installs the Claude Code host front-end (commands + agents/squads + CLAUDE.md).
 * Settings are wired separately via {@link wireClaudeSettings}.
 * @param {string} target - project root
 * @param {string} tplDir - templates dir
 * @param {{name:string, level:number, mode:string, args:object}} ctx - install context
 * @param {string[]} report - mutated with progress lines
 */
export async function installClaudeHost(target, tplDir, ctx, report) {
  // Slash commands: kit-owned but personalizable — 3-way sync, never clobber [ADR-0054].
  const cmd = await syncTree(join(tplDir, 'claude', 'commands'), target, '.claude/commands', ctx.sync);
  report.push(`✓ slash commands installed (.claude/commands)${cmd.kept ? ` — kept ${cmd.kept} personalized` : ''}`);

  // Agents + L4+ squads: only at L >= 4.
  if (ctx.level >= 4) {
    const ag = await syncTree(join(tplDir, 'claude', 'agents'), target, '.claude/agents', ctx.sync);
    report.push(`✓ agent archetypes installed (.claude/agents)${ag.kept ? ` — kept ${ag.kept} personalized` : ''}`);
    // agent-forge factory squad: engine code + matrix + APF templates (ADR-0012). Always overwrite.
    await copyTree(join(tplDir, 'contextkit', 'squads', 'agent-forge'), join(target, 'contextkit', 'squads', 'agent-forge'));
    report.push('✓ agent-forge squad installed (contextkit/squads/agent-forge)');
  }

  await installClaudeMd(target, tplDir, ctx, report);
}
