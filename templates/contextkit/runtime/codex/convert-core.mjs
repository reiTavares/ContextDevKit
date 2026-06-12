/**
 * Pure conversion core: Claude Code commands/agents -> Codex skills/subagents.
 *
 * Claude remains the authored source. Codex assets are generated so command
 * briefings and specialist agents do not drift across hosts.
 */
import { basename, dirname } from 'node:path';

/** Extracts YAML-like frontmatter from a Markdown file. */
export function stripFrontmatter(content) {
  const match = content.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!match) return { body: content, frontmatter: '' };
  return { frontmatter: match[1], body: match[2].trimStart() };
}

function field(frontmatter, key) {
  const match = frontmatter.match(new RegExp(`^${key}:\\s*(.+)$`, 'm'));
  if (!match) return null;
  return match[1].trim().replace(/^["']|["']$/g, '');
}

/** Converts Claude-specific references to Codex host paths and vocabulary. */
export function adaptContent(body) {
  return body
    .replace(/\bCLAUDE\.md\b/g, 'AGENTS.md')
    .replace(/\.claude\/commands\//g, '.agents/skills/')
    .replace(/\.claude\/agents\//g, '.codex/agents/')
    .replace(/\bClaude Code\b/g, 'Codex')
    .replace(/\bTodoWrite\b/g, 'task plan/checklist');
}

/** Stable Codex skill folder name for a Claude command relative path. */
export function codexSkillName(filename) {
  const dir = dirname(filename).replaceAll('\\', '/');
  const parts = dir === '.' ? [] : dir.split('/').filter(Boolean);
  return ['source-command', ...parts, basename(filename, '.md')].join('-').toLowerCase();
}

/** Full command -> Codex `SKILL.md` transformation. */
export function convertCommandToSkill(raw, filename) {
  const { frontmatter, body } = stripFrontmatter(raw);
  const name = codexSkillName(filename);
  const description = field(frontmatter, 'description') ?? `Migrated source command ${basename(filename, '.md')}.`;
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
