/**
 * `--uninstall` [`--purge`]: remove ContextDevKit's hook wiring + git hooks (and,
 * with purge, the engine/commands/agents) while ALWAYS keeping the user's
 * memory (ADRs/sessions) and CLAUDE.md.
 */
import { rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { ANTIGRAVITY_DIR, ANTIGRAVITY_LEGACY_DIR } from '../../templates/contextkit/runtime/config/paths.mjs';
import { stripAgentHooks } from '../../templates/contextkit/runtime/config/agent-hooks-compose.mjs';
import { read, overwrite } from './fs.mjs';

export async function uninstall(target, purge) {
  const report = [];
  // 1. Strip ContextDevKit hook entries from settings.json (keep the user's own).
  const settingsPath = join(target, '.claude', 'settings.json');
  if (existsSync(settingsPath)) {
    try {
      const settings = JSON.parse(await read(settingsPath));
      const hooks = settings.hooks || {};
      for (const evt of Object.keys(hooks)) {
        if (!Array.isArray(hooks[evt])) continue;
        hooks[evt] = hooks[evt]
          .map((g) => ({ ...g, hooks: (g.hooks || []).filter((h) => !String(h.command || '').includes('contextkit/runtime/hooks')) }))
          .filter((g) => (g.hooks || []).length > 0);
        if (hooks[evt].length === 0) delete hooks[evt];
      }
      settings.hooks = hooks;
      await overwrite(settingsPath, JSON.stringify(settings, null, 2) + '\n');
      report.push('✓ removed ContextDevKit hook wiring from .claude/settings.json');
    } catch {
      report.push('⚠️  could not parse .claude/settings.json — left untouched');
    }
  }
  // 1b. Strip the kit-owned group from .agents/hooks.json, keeping user groups
  //     (file removed entirely when nothing user-owned remains) [ADR-0049].
  const agyHooksPath = join(target, ANTIGRAVITY_DIR, 'hooks.json');
  if (existsSync(agyHooksPath)) {
    try {
      const remaining = stripAgentHooks(JSON.parse((await read(agyHooksPath)).replace(/^\uFEFF/, '')));
      if (remaining) await overwrite(agyHooksPath, JSON.stringify(remaining, null, 2) + '\n');
      else await rm(agyHooksPath, { force: true });
      report.push(`✓ removed ContextDevKit hook wiring from ${ANTIGRAVITY_DIR}/hooks.json`);
    } catch {
      report.push(`⚠️  could not parse ${ANTIGRAVITY_DIR}/hooks.json — left untouched`);
    }
  }
  // 2. Remove the git hook wrappers we installed.
  for (const h of ['pre-commit', 'commit-msg', 'pre-push']) {
    const p = join(target, '.git', 'hooks', h);
    if (existsSync(p)) {
      await rm(p, { force: true });
      report.push(`✓ removed git hook ${h}`);
    }
  }
  // 3. With --purge, delete the engine + commands/agents (KEEP memory).
  if (purge) {
    for (const rel of ['contextkit/runtime', 'contextkit/tools', '.claude/commands', '.claude/agents', ANTIGRAVITY_DIR, ANTIGRAVITY_LEGACY_DIR]) {
      const p = join(target, rel);
      if (existsSync(p)) {
        await rm(p, { recursive: true, force: true });
        report.push(`✓ purged ${rel}`);
      }
    }
    report.push('ℹ️  kept contextkit/memory/ (your ADRs + session history) and CLAUDE.md');
  }
  console.log('\n' + report.join('\n'));
  console.log('\n✅ ContextDevKit uninstalled.' + (purge ? '' : ' Engine files kept; re-run without --uninstall to re-enable.'));
}
