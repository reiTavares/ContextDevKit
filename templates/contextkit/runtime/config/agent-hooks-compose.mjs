/**
 * Composes the Antigravity hook group from the same v4 lifecycle contract used
 * by Claude, Codex, and Grok. Exact tool matchers may create several groups, but
 * a host event matches one group and starts one ContextDevKit process.
 */

export const KIT_HOOK_GROUP = 'contextdevkit';

const AGY_MUTATION_TOOLS = Object.freeze([
  'write_to_file',
  'replace_file_content',
  'multi_replace_file_content',
]);

/**
 * @param {Record<string, any> | null} existing parsed hooks file
 * @param {number} level active ContextDevKit level
 * @returns {Record<string, any>} composed hooks file
 */
export function composeAgentHooks(existing, level) {
  const hooksFile = existing && typeof existing === 'object' ? { ...existing } : {};
  const group = { enabled: true };
  const command = (script) => ({
    hooks: [{ type: 'command', command: `node contextkit/runtime/hooks/${script} --host agy` }],
  });
  const perMutationTool = (script) => AGY_MUTATION_TOOLS.map((matcher) => ({
    matcher,
    ...command(script),
  }));

  if (level >= 1) group.SessionStart = [command('governance-session-context.mjs')];

  if (level >= 2) {
    group.PostToolUse = perMutationTool('governance-postflight.mjs');
    group.Stop = [command('governance-completion.mjs')];
  }
  if (level >= 3) group.PreToolUse = perMutationTool('governance-write-preflight.mjs');
  if (level >= 5) {
    group.UserPromptSubmit = [command('governance-prompt-preflight.mjs')];
    group.PreCompact = [command('governance-session-context.mjs')];
    group.SubagentStart = [command('governance-session-context.mjs')];
  }

  hooksFile[KIT_HOOK_GROUP] = group;
  return hooksFile;
}

/**
 * @param {Record<string, any> | null} existing parsed hooks file
 * @returns {Record<string, any> | null} user-owned remainder
 */
export function stripAgentHooks(existing) {
  if (!existing || typeof existing !== 'object') return null;
  const remaining = { ...existing };
  delete remaining[KIT_HOOK_GROUP];
  return Object.keys(remaining).length > 0 ? remaining : null;
}
