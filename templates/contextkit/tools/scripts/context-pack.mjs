#!/usr/bin/env node
/**
 * Context pack — one bounded "start of work" bundle. [ADR-0027]
 *
 * Collapses the 3–5 sequential reads `/dev-start`, `/state` and `/ship` each do
 * (latest session + CHANGELOG `[Unreleased]` + immutable rules + open tasks +
 * recent ADRs) into a SINGLE script call — fewer tokens AND fewer round-trips.
 * Reuses `digestLatestSession` (the same digest the boot hook shows — single
 * source) and the ADR core. Read-only, zero third-party deps. Every section is
 * best-effort: a missing source is skipped with a note, never an error.
 *
 * Usage:
 *   node contextkit/tools/scripts/context-pack.mjs          # human bundle
 *   node contextkit/tools/scripts/context-pack.mjs --json
 */
import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathsFor } from '../../runtime/config/paths.mjs';
import { digestLatestSession, extractUnreleased, readChangelog } from '../../runtime/hooks/boot-context-readers.mjs';
import { section } from '../../runtime/hooks/md-extract.mjs';
import { ADR_FILENAME_RE, parseAdr, renderCatalogLine } from './adr-digest-core.mjs';

const ROOT = process.cwd();
const P = pathsFor(ROOT);
const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const readSafe = (abs) => readFile(abs, 'utf-8').catch(() => null);

/** The numbered `⛔ Immutable rules` block from CLAUDE.md (capped), or null. */
async function immutableRules() {
  const text = await readSafe(resolve(ROOT, 'CLAUDE.md'));
  if (!text) return null;
  const body = section(text.split('\n'), 'immutable rules')
    .filter((l) => l.trim())
    .slice(0, 12)
    .join('\n')
    .trim();
  return body || null;
}

/** The N most recent ADRs as catalog lines, or null. */
async function recentAdrs(limit = 5) {
  let files = [];
  try {
    files = await readdir(P.decisions);
  } catch {
    return null;
  }
  const names = files.filter((f) => ADR_FILENAME_RE.test(f) && f !== '_TEMPLATE.md').sort().reverse().slice(0, limit);
  const lines = [];
  for (const name of names) {
    const text = await readSafe(resolve(P.decisions, name));
    if (text !== null) lines.push(renderCatalogLine(parseAdr(text, name)));
  }
  return lines.length ? lines.join('\n') : null;
}

const FM = (raw, key) => (new RegExp(`^${key}:\\s*(.+)$`, 'm').exec(raw)?.[1] || '').replace(/^["']|["']$/g, '').trim();
const PRIORITY_ORDER = { P0: 0, P1: 1, P2: 2, P3: 3 };

/** Open backlog tasks (id · priority · title), highest priority first, capped. */
async function openBacklog(cap = 8) {
  let files = [];
  try {
    files = await readdir(resolve(P.pipeline, 'backlog'));
  } catch {
    return null;
  }
  const tasks = [];
  for (const name of files.filter((f) => /^\d+-.*\.md$/.test(f))) {
    const text = await readSafe(resolve(P.pipeline, 'backlog', name));
    if (text === null) continue;
    tasks.push({ id: FM(text, 'id') || name.split('-')[0], priority: FM(text, 'priority') || 'P3', title: FM(text, 'title') || name });
  }
  if (tasks.length === 0) return null;
  tasks.sort((a, b) => (PRIORITY_ORDER[a.priority] ?? 9) - (PRIORITY_ORDER[b.priority] ?? 9) || String(a.id).localeCompare(String(b.id)));
  return tasks.slice(0, cap).map((t) => `- **${t.priority}** · #${t.id} · ${t.title}`).join('\n');
}

async function build() {
  const [session, unreleased, rules, adrs, backlog] = await Promise.all([
    digestLatestSession(ROOT),
    readChangelog(ROOT).then((c) => extractUnreleased(c)),
    immutableRules(),
    recentAdrs(),
    openBacklog(),
  ]);
  return { session, unreleased, rules, adrs, backlog };
}

function render(pack) {
  const out = ['# 🧭 Context pack — start of work\n'];
  const block = (title, body, emptyNote) => {
    out.push(`## ${title}`);
    out.push('');
    out.push(body && body.trim() ? body.trim() : `_${emptyNote}_`);
    out.push('');
  };
  block('🗓️ Last session', pack.session?.content, 'no registered sessions yet');
  block('📝 Unreleased (CHANGELOG)', pack.unreleased, 'nothing unreleased');
  block('⛔ Immutable rules', pack.rules, 'no CLAUDE.md immutable-rules block found');
  block('🛠️ Open backlog (top by priority)', pack.backlog, 'no open backlog tasks');
  block('🏛️ Recent decisions (ADRs)', pack.adrs, 'no ADRs yet');
  out.push('> Reason over this pack; open a full session log / ADR / ticket only on demand. [ADR-0027]');
  return out.join('\n');
}

async function main() {
  const pack = await build();
  if (flag('--json')) {
    process.stdout.write(JSON.stringify(pack, null, 2) + '\n');
    return;
  }
  console.log(render(pack));
}

main().catch((err) => {
  console.error('❌ context-pack failed:', err?.message ?? err);
  process.exit(1);
});
