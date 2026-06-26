#!/usr/bin/env node
/**
 * docs-generate.mjs — Automatic feature-reference generator (ADR-0114, delta to ADR-0075).
 *
 * Regenerates the FACT tables under `docs/reference/` from the canonical registry
 * (Claude slash commands, agents, and the shipped host matrix) BETWEEN auto-generated
 * markers. It NEVER touches prose outside the markers and NEVER generates narrative —
 * it only emits the volatile inventory the same way the README inventory-claim check
 * keeps counts honest. This is what makes feature docs regenerate on every change
 * instead of rotting.
 *
 * Zero runtime deps (node:* only). Forward-slash paths. BOM-tolerant.
 *
 * CLI:
 *   docs-generate.mjs [root]            regenerate in place (write)
 *   docs-generate.mjs --check [root]    verify in sync; exit 1 if stale (CI gate)
 */

import { readFileSync, writeFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { resolve, join, relative, basename } from 'node:path';

const COMMANDS_DIR = 'templates/claude/commands';
const AGENTS_DIR = 'templates/claude/agents';
const CANDIDATE_HOSTS = ['claude', 'codex', 'antigravity', 'cursor', 'opencode'];

/** Strip a UTF-8 BOM so downstream parsing never trips on it. */
function deBom(text) {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

/** Read the `description:` value from a markdown file's YAML frontmatter (or ''). */
function frontmatterDescription(absFile) {
  const text = deBom(readFileSync(absFile, 'utf-8'));
  if (!text.startsWith('---')) return '';
  const end = text.indexOf('\n---', 3);
  if (end === -1) return '';
  const block = text.slice(3, end);
  const match = block.match(/^\s*description:\s*(.+)$/m);
  return match ? match[1].trim().replace(/^["']|["']$/g, '') : '';
}

/** Collapse a description to a single, table-cell-safe line. */
function cell(text) {
  return (text || '—').replace(/\r?\n/g, ' ').replace(/\s+/g, ' ').replace(/\|/g, '\\|').trim();
}

/** Recursively list `*.md` files under a dir (excluding README.md), relative to it. */
function listMarkdown(absDir) {
  const out = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const abs = join(dir, entry.name);
      if (entry.isDirectory()) walk(abs);
      else if (entry.name.endsWith('.md') && entry.name.toLowerCase() !== 'readme.md') out.push(abs);
    }
  };
  if (existsSync(absDir)) walk(absDir);
  return out.sort();
}

/** Build the commands fact table, grouped by domain (subdir, or "general" at root). */
function renderCommands(root) {
  const dir = resolve(root, COMMANDS_DIR);
  const byDomain = new Map();
  for (const abs of listMarkdown(dir)) {
    const rel = relative(dir, abs).replace(/\\/g, '/');
    const parts = rel.split('/');
    const domain = parts.length > 1 ? parts[0] : 'general';
    const name = basename(rel, '.md');
    if (!byDomain.has(domain)) byDomain.set(domain, []);
    byDomain.get(domain).push({ name, desc: frontmatterDescription(abs) });
  }
  const total = [...byDomain.values()].reduce((n, list) => n + list.length, 0);
  const lines = [`_${total} slash commands across ${byDomain.size} domains._`, ''];
  for (const domain of [...byDomain.keys()].sort()) {
    lines.push(`### ${domain}`, '', '| Command | What it does |', '| --- | --- |');
    for (const cmd of byDomain.get(domain).sort((a, b) => a.name.localeCompare(b.name))) {
      lines.push(`| \`/${cmd.name}\` | ${cell(cmd.desc)} |`);
    }
    lines.push('');
  }
  return { body: lines.join('\n').trimEnd(), total };
}

/** Build the agents fact table from the agent registry. */
function renderAgents(root) {
  const dir = resolve(root, AGENTS_DIR);
  const rows = listMarkdown(dir).map((abs) => ({ name: basename(abs, '.md'), desc: frontmatterDescription(abs) }));
  const lines = [`_${rows.length} specialized agents._`, '', '| Agent | When to use it |', '| --- | --- |'];
  for (const row of rows.sort((a, b) => a.name.localeCompare(b.name))) {
    lines.push(`| \`${row.name}\` | ${cell(row.desc)} |`);
  }
  return { body: lines.join('\n').trimEnd(), total: rows.length };
}

/** Build the host matrix from the host template dirs that actually ship. */
function renderHosts(root) {
  const present = CANDIDATE_HOSTS.filter((h) => existsSync(resolve(root, 'templates', h)));
  const lines = [`_${present.length} native hosts._`, '', '| Host | Status |', '| --- | --- |'];
  for (const host of present) lines.push(`| ${host} | shipped |`);
  return { body: lines.join('\n').trimEnd(), total: present.length };
}

const PAGES = {
  'commands.md': { title: 'Reference: Slash commands', key: 'commands', render: renderCommands,
    intro: 'Every slash command the platform ships, grouped by domain. Generated from the command registry.' },
  'agents.md': { title: 'Reference: Agents', key: 'agents', render: renderAgents,
    intro: 'The specialized agents available to route work to. Generated from the agent registry.' },
  'hosts.md': { title: 'Reference: Native hosts', key: 'hosts', render: renderHosts,
    intro: 'The editor/agent hosts the platform runs on natively. Generated from the shipped host set.' },
};

const beginMark = (key) => `<!-- BEGIN AUTO-GENERATED: ${key} (docs-generate.mjs, ADR-0114) — edits inside are overwritten -->`;
const endMark = (key) => `<!-- END AUTO-GENERATED: ${key} -->`;

/** Replace the marked region (or append a fresh scaffold) and return the new file text. */
function composePage(existing, page, body) {
  const begin = beginMark(page.key);
  const end = endMark(page.key);
  const block = `${begin}\n\n${body}\n\n${end}`;
  if (existing && existing.includes(begin) && existing.includes(end)) {
    const pre = existing.slice(0, existing.indexOf(begin));
    const post = existing.slice(existing.indexOf(end) + end.length);
    return `${pre}${block}${post}`.replace(/\n{3,}/g, '\n\n').trimEnd() + '\n';
  }
  return `# ${page.title}\n\n${page.intro}\n\n${block}\n`;
}

/**
 * Regenerate every reference page from the registry.
 * @param {string} root project root
 * @param {{write?:boolean}} [opts] write=false returns the would-be content without touching disk
 * @returns {{files:Array<{path:string,changed:boolean}>, counts:Record<string,number>, ok:boolean}}
 */
export function generateReference(root, { write = true } = {}) {
  const refDir = resolve(root, 'docs/reference');
  const files = [];
  const counts = {};
  for (const [fileName, page] of Object.entries(PAGES)) {
    const { body, total } = page.render(root);
    counts[page.key] = total;
    const abs = join(refDir, fileName);
    const existing = existsSync(abs) ? deBom(readFileSync(abs, 'utf-8')) : '';
    const next = composePage(existing, page, body);
    const changed = next !== existing;
    if (write && changed) writeFileSync(abs, next);
    files.push({ path: `docs/reference/${fileName}`, changed });
  }
  return { files, counts, ok: files.every((f) => !f.changed) };
}

/**
 * Coverage debt (ADR-0114 advisory): registry features with no hand-authored prose
 * (no `/command` or agent-name mention in any tutorial / how-to / explanation doc).
 * The reference layer covers EVERY feature by construction; this surfaces the prose gap.
 * @param {string} root project root
 * @returns {{commandsMissing:string[], agentsMissing:string[]}}
 */
export function coverageDebt(root) {
  const proseDirs = ['docs/tutorials', 'docs/how-to', 'docs/explanation'];
  let prose = '';
  for (const d of proseDirs) {
    for (const abs of listMarkdown(resolve(root, d))) {
      if (basename(abs) !== '_TEMPLATE.md') prose += deBom(readFileSync(abs, 'utf-8')) + '\n';
    }
  }
  const commands = listMarkdown(resolve(root, COMMANDS_DIR)).map((a) => basename(a, '.md'));
  const agents = listMarkdown(resolve(root, AGENTS_DIR)).map((a) => basename(a, '.md'));
  return {
    commandsMissing: [...new Set(commands)].filter((c) => !prose.includes(`/${c}`)).sort(),
    agentsMissing: [...new Set(agents)].filter((a) => !new RegExp(`\\b${a}\\b`).test(prose)).sort(),
  };
}

function main(argv) {
  const check = argv.includes('--check');
  const root = resolve(argv.find((a) => !a.startsWith('--')) || '.');
  const result = generateReference(root, { write: !check });
  if (check) {
    const stale = result.files.filter((f) => f.changed);
    if (stale.length) {
      console.error(`docs-generate: STALE reference — run docs-generate.mjs to regenerate:\n  ${stale.map((f) => f.path).join('\n  ')}`);
      process.exit(1);
    }
    console.log(`docs-generate: reference in sync (commands=${result.counts.commands} agents=${result.counts.agents} hosts=${result.counts.hosts}).`);
    return;
  }
  const changed = result.files.filter((f) => f.changed).map((f) => f.path);
  console.log(`docs-generate: ${changed.length ? 'updated ' + changed.join(', ') : 'no changes'} (commands=${result.counts.commands} agents=${result.counts.agents} hosts=${result.counts.hosts}).`);
}

if (import.meta.url === `file://${process.argv[1].replace(/\\/g, '/')}` || process.argv[1]?.endsWith('docs-generate.mjs')) {
  main(process.argv.slice(2));
}
