/**
 * Pure conversion core: Claude Code command/agent markdown → Antigravity
 * skill/persona markdown.
 *
 * Extracted from convert-all.mjs (which keeps the CLI/filesystem orchestration)
 * so the SAME transformation is importable by the selfcheck content-parity
 * gate (ticket 140): the gate converts each Claude source in memory with these
 * functions and diffs the result against the generated templates/antigravity
 * twin — any byte of drift means "run `npm run build:antigravity`".
 *
 * Keep these functions pure (string in → string out, no I/O): purity is what
 * makes the gate's in-memory comparison exact.
 */
import { basename } from 'node:path';
import { ANTIGRAVITY_DIR } from '../config/paths.mjs';

/**
 * Strips YAML frontmatter (--- ... ---) from the content and extracts the
 * description + argument-hint for use in the generated header.
 *
 * @param {string} content  raw markdown with optional frontmatter
 * @returns {{ body: string, description: string | null, argumentHint: string | null }}
 */
export function stripFrontmatter(content) {
  const fmMatch = content.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!fmMatch) return { body: content, description: null, argumentHint: null };

  const fm = fmMatch[1];
  const body = fmMatch[2];
  const descMatch = fm.match(/^description:\s*(.+)$/m);
  const argMatch = fm.match(/^argument-hint:\s*(.+)$/m);

  return {
    body: body.trimStart(),
    description: descMatch?.[1]?.trim() ?? null,
    argumentHint: argMatch?.[1]?.trim() ?? null,
  };
}

/**
 * Adapts Claude Code-specific references for Antigravity ($ARGUMENTS,
 * TodoWrite, sub-agent delegation, .claude/ paths, slash-command idiom).
 *
 * @param {string} body  frontmatter-stripped markdown body
 * @returns {string} the agy-adapted body
 */
export function adaptContent(body) {
  let adapted = body;

  // Replace $ARGUMENTS with instruction
  adapted = adapted.replace(/\$ARGUMENTS/g, '<user-specified argument>');

  // Replace TodoWrite references with Antigravity task tracking
  adapted = adapted.replace(/\bTodoWrite\b/g, 'task.md artifact (or equivalent tracking)');

  // Replace "delegate to `agent-name`" patterns with persona references
  adapted = adapted.replace(
    /delegate to [`']?(\w[\w-]*)['`]?/gi,
    `adopt the posture of \`$1\` (see \`${ANTIGRAVITY_DIR}/agents/$1.md\`)`
  );

  // Replace .claude/ paths with the agy host paths [ADR-0048]
  adapted = adapted.replace(/\.claude\/commands\//g, `${ANTIGRAVITY_DIR}/skills/`);
  adapted = adapted.replace(/\.claude\/agents\//g, `${ANTIGRAVITY_DIR}/agents/`);
  // Pre-ADR-0048 references in hand-written sources (playbooks/workflows)
  adapted = adapted.replace(/\.antigravity\//g, `${ANTIGRAVITY_DIR}/`);

  // Replace "slash command" terminology
  adapted = adapted.replace(/slash command/gi, 'skill');

  // Replace `/command-name` invocations with skill references
  // (but NOT in code blocks or paths)
  adapted = adapted.replace(
    /(?<![`\/\w])\/(\w[\w-]*)\b(?!\.\w|\/)/g,
    (match, name) => `the \`${name}\` skill`
  );

  return adapted;
}

/**
 * Builds the Antigravity skill header from extracted frontmatter.
 * @param {string} filename  source-relative path (e.g. `pipeline/ship.md`)
 */
export function buildSkillHeader(filename, description, argumentHint) {
  const name = basename(filename, '.md');
  const lines = [`# Skill: ${name}`];
  if (description) lines.push('', `> ${description}`);
  if (argumentHint) lines.push(`> Argument: ${argumentHint}`);
  lines.push('');
  return lines.join('\n');
}

/**
 * Builds the Antigravity agent/persona header.
 * @param {string} filename  source-relative path (e.g. `architect.md`)
 */
export function buildAgentHeader(filename, description) {
  const name = basename(filename, '.md');
  const lines = [`# Agent Persona: ${name}`];
  if (description) lines.push('', `> ${description}`);
  lines.push('', '> When asked to adopt this persona, follow the posture and rules below.');
  lines.push('');
  return lines.join('\n');
}

/**
 * Full command → skill transformation (header + adapted body).
 * The single source of truth shared by convert-all.mjs and the parity gate.
 *
 * @param {string} raw       raw Claude command markdown
 * @param {string} filename  source-relative path
 * @returns {string} the complete generated skill file content
 */
export function convertCommandToSkill(raw, filename) {
  const { body, description, argumentHint } = stripFrontmatter(raw);
  return buildSkillHeader(filename, description, argumentHint) + adaptContent(body);
}

/**
 * Full agent → persona transformation (header + adapted body).
 *
 * @param {string} raw       raw Claude agent markdown
 * @param {string} filename  source-relative path
 * @returns {string} the complete generated persona file content
 */
export function convertAgentToPersona(raw, filename) {
  const { body, description } = stripFrontmatter(raw);
  return buildAgentHeader(filename, description) + adaptContent(body);
}
