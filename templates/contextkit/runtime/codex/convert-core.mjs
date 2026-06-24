/**
 * Pure conversion core: Claude Code commands/agents -> Codex skills/subagents.
 *
 * Claude remains the authored source. Codex assets are generated so command
 * briefings and specialist agents do not drift across hosts.
 */
import { basename, dirname } from 'node:path';

/**
 * Every canonical Claude command must have a functional Codex projection.
 * Host-specific commands are adapted below instead of disappearing from the
 * Codex surface. This list remains exported for backward compatibility with
 * the parity checker, but unexplained omissions are no longer accepted.
 */
export const CODEX_SKILL_SKIP_LIST = Object.freeze([]);

/** True when a Claude command must not become a Codex skill. */
export function isSkippedForCodex(filename) {
  return CODEX_SKILL_SKIP_LIST.includes(basename(filename, '.md').toLowerCase());
}

const CODEX_COMMAND_PROJECTIONS = Object.freeze({
  'token-report': {
    description: 'Codex usage and autonomy insight from ContextDevKit receipts, without reading unstable private transcript formats.',
    body: `# Codex Usage & Autonomy Report

Codex does not expose a stable transcript format for project tooling. Do not
scrape private \`.codex\` session files or invent token totals.

Use the canonical Session Autonomy Receipts produced by ContextDevKit:

\`\`\`bash
node contextkit/tools/scripts/autonomy-report.mjs --latest
node contextkit/tools/scripts/autonomy-report.mjs --all
node contextkit/tools/scripts/autonomy-report.mjs --session <id> --verify
\`\`\`

Report the receipt's consumption mode, measured/estimated claim type, observed
or estimated tokens, autonomy multiplier, cost evidence, confidence, and
integrity status. When no receipt exists, say that usage evidence is unavailable
and recommend finalizing the current session first. Never present an estimate as
provider-billed usage.`,
  },
  fable: {
    description: 'Manual Codex premium reasoning tier — run one explicitly requested task on the host-resolved reasoning model, then return to normal.',
    body: `# Manual premium reasoning tier for Codex

Use this only when the user explicitly asks for \`fable\`, premium reasoning, or
the highest reasoning tier for one bounded task.

1. Resolve the current Codex reasoning model from project policy:

\`\`\`bash
node contextkit/tools/scripts/model-policy.mjs tier reasoning --host codex
\`\`\`

2. State that this is one premium-reasoning task, with no persistent mode change.
3. Spawn one focused subagent using the returned \`model\`. Keep the main loop on
   its current model and pass only the context required for the task.
4. Relay the result, record which resolved model was used, and return to normal.

Never invoke this tier automatically, batch unrelated work into it, or infer a
model slug when policy resolution returns \`null\`.`,
  },
});

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

function adaptCommandBody(body, filename) {
  const projected = CODEX_COMMAND_PROJECTIONS[basename(filename, '.md').toLowerCase()];
  if (projected) return projected.body;
  return adaptContent(body)
    .replace(/claude-md\.mjs find\b/g, 'claude-md.mjs find --host codex')
    .replace(/claude-md\.mjs scaffold\b/g, 'claude-md.mjs scaffold --host codex');
}

/** Full command -> Codex `SKILL.md` transformation. */
export function convertCommandToSkill(raw, filename) {
  const { frontmatter, body } = stripFrontmatter(raw);
  const name = codexSkillName(filename);
  const projection = CODEX_COMMAND_PROJECTIONS[basename(filename, '.md').toLowerCase()];
  const description = projection?.description ??
    adaptContent(field(frontmatter, 'description') ?? `Migrated source command ${basename(filename, '.md')}.`);
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
    adaptCommandBody(body, filename).trimEnd(),
    '',
  ].join('\n');
}

function literalMultiline(value) {
  if (value.includes("'''")) return JSON.stringify(value);
  return `'''\n${value.trimEnd()}\n'''`;
}

/** Full Claude agent -> Codex TOML subagent transformation. */
export function convertAgentToToml(raw, filename, options = {}) {
  const { frontmatter, body } = stripFrontmatter(raw);
  const name = field(frontmatter, 'name') ?? basename(filename, '.md');
  const description = adaptContent(field(frontmatter, 'description') ?? `Codex subagent ${name}.`);
  const sourceModel = field(frontmatter, 'model');
  const codexModel = sourceModel && sourceModel !== 'inherit'
    ? options.hostModels?.[sourceModel] ?? null
    : null;
  const lines = [
    `name = ${JSON.stringify(name)}`,
    `description = ${JSON.stringify(description)}`,
  ];
  if (codexModel) lines.push(`model = ${JSON.stringify(codexModel)}`);
  lines.push(`developer_instructions = ${literalMultiline(adaptContent(body))}`, '');
  return lines.join('\n');
}
