/**
 * Pure conversion core: Claude Code commands/agents -> Codex skills/subagents.
 *
 * Claude remains the authored source. Codex assets are generated so command
 * briefings and specialist agents do not drift across hosts.
 */
import { basename, dirname } from 'node:path';

/**
 * Commands that are semantically wrong or no-op on Codex and so must NOT be
 * emitted as Codex skills. Kept deliberately narrow (ADR-0056: "keep the
 * converter narrow"); each entry is justified by what it manipulates on the
 * Claude host:
 *   - `claude-md`     manages CLAUDE.md, a Claude-only memory file.
 *   - `token-report`  parses `~/.claude` transcripts that do not exist on Codex.
 *   - `fable`         selects the Claude Fable premium model tier (ADR-0052).
 * Names match the command file basename (without `.md`).
 */
export const CODEX_SKILL_SKIP_LIST = Object.freeze(['claude-md', 'token-report', 'fable']);

/** True when a Claude command must not become a Codex skill. */
export function isSkippedForCodex(filename) {
  return CODEX_SKILL_SKIP_LIST.includes(basename(filename, '.md').toLowerCase());
}

/**
 * Extracts YAML-like frontmatter from a Markdown file. Tolerant of CRLF: a
 * Windows-authored `.claude/commands/*.md` must parse identically to LF input,
 * otherwise the raw `---` block leaks into the body and a default description is
 * invented [ADR-0056 remediation].
 */
export function stripFrontmatter(content) {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) return { body: content, frontmatter: '' };
  return { frontmatter: match[1], body: match[2].trimStart() };
}

function field(frontmatter, key) {
  const match = frontmatter.match(new RegExp(`^${key}:\\s*(.+)$`, 'm'));
  if (!match) return null;
  return match[1].trim().replace(/^["']|["']$/g, '');
}

/** Stable Codex skill folder name for a Claude command relative path. */
export function codexSkillName(filename) {
  const dir = dirname(filename).replaceAll('\\', '/');
  const parts = dir === '.' ? [] : dir.split('/').filter(Boolean);
  return ['source-command', ...parts, basename(filename, '.md')].join('-').toLowerCase();
}

/**
 * Rewrites a `.claude/commands/<rel>.md` reference to the real Codex skill
 * location. Codex skills install at `.agents/skills/source-command-<name>`
 * holding a `SKILL.md` (CODEX_SKILLS_DIR + codexSkillName), so a flat
 * `.agents/skills/<name>.md` target is a dead path [ADR-0056 remediation].
 */
function rewriteCommandPath(commandRelative) {
  return `.agents/skills/${codexSkillName(commandRelative)}/SKILL.md`;
}

/** Converts Claude-specific references to Codex host paths and vocabulary. */
export function adaptContent(body) {
  return body
    .replace(/\bCLAUDE\.md\b/g, 'AGENTS.md')
    // Specific command file -> its real skill folder + SKILL.md (avoids dead paths).
    .replace(/\.claude\/commands\/([A-Za-z0-9_./-]+?)\.md/g, (_match, rel) => rewriteCommandPath(rel))
    // Bare commands directory -> the Codex skills surface (no filename to expand).
    .replace(/\.claude\/commands\//g, '.agents/skills/')
    .replace(/\.claude\/agents\//g, '.codex/agents/')
    .replace(/\bClaude Code\b/g, 'Codex')
    .replace(/\bTodoWrite\b/g, 'task plan/checklist');
}

/** Full command -> Codex `SKILL.md` transformation. */
export function convertCommandToSkill(raw, filename) {
  const { frontmatter, body } = stripFrontmatter(raw);
  const name = codexSkillName(filename);
  const description = adaptContent(field(frontmatter, 'description') ?? `Migrated source command ${basename(filename, '.md')}.`);
  return [
    '---',
    `name: "${name}"`,
    `description: "${description.replaceAll('"', '\\"')}"`,
    '---',
    '',
    `# ${name}`,
    '',
    `Use this skill when the user asks to run the migrated source command \`${basename(filename, '.md')}\`.`,
    '',
    '## Command Template',
    '',
    adaptContent(body).trimEnd(),
    '',
  ].join('\n');
}

function literalMultiline(value) {
  if (value.includes("'''")) return JSON.stringify(value);
  return `'''\n${value.trimEnd()}\n'''`;
}

/** Full Claude agent -> Codex TOML subagent transformation. */
export function convertAgentToToml(raw, filename) {
  const { frontmatter, body } = stripFrontmatter(raw);
  const name = field(frontmatter, 'name') ?? basename(filename, '.md');
  const description = adaptContent(field(frontmatter, 'description') ?? `Codex subagent ${name}.`);
  return [
    `name = ${JSON.stringify(name)}`,
    `description = ${JSON.stringify(description)}`,
    `developer_instructions = ${literalMultiline(adaptContent(body))}`,
    '',
  ].join('\n');
}
