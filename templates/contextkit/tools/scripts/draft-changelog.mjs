#!/usr/bin/env node
/**
 * `/draft-changelog` — build a `[Unreleased]` skeleton from Conventional Commits
 * since the last tag (ADR-0030, OSS repo-ops).
 *
 * Reads `git log <lastTag>..HEAD`, parses Conventional Commit subjects, and groups
 * them into Keep-a-Changelog sections (Added / Changed / Fixed / …). It DRAFTS —
 * it never writes `docs/CHANGELOG.md`; the human reviews and pastes. Local git only
 * (no network), every git call is timed out + defensive (rule 2): a non-repo or a
 * git error prints a clean message, never a stack trace.
 *
 * Usage:
 *   node contextkit/tools/scripts/draft-changelog.mjs           # since last tag
 *   node contextkit/tools/scripts/draft-changelog.mjs --since v1.7.0
 *   node contextkit/tools/scripts/draft-changelog.mjs --json
 */
import { spawnSync } from 'node:child_process';

/** Conventional-commit type → Keep-a-Changelog section. */
const SECTION = {
  feat: 'Added',
  fix: 'Fixed',
  perf: 'Changed',
  refactor: 'Changed',
  revert: 'Removed',
  security: 'Security',
  docs: 'Documentation',
  chore: 'Chores',
  build: 'Chores',
  ci: 'Chores',
  test: 'Chores',
  style: 'Chores',
};
const ORDER = ['Added', 'Changed', 'Fixed', 'Removed', 'Deprecated', 'Security', 'Documentation', 'Chores', 'Other'];

/** Runs git with a hard timeout; returns stdout or null on any failure. */
function git(args) {
  const res = spawnSync('git', args, { encoding: 'utf-8', timeout: 60000 });
  return res.status === 0 ? (res.stdout || '').trim() : null;
}

function lastTag() {
  return git(['describe', '--tags', '--abbrev=0']);
}

/** Parses a `feat(scope)!: subject` line into { section, scope, breaking, text }. */
function parse(subject) {
  const m = subject.match(/^(\w+)(?:\(([^)]+)\))?(!)?:\s*(.+)$/);
  if (!m) return { section: 'Other', scope: null, breaking: false, text: subject };
  const [, type, scope, bang, text] = m;
  return { section: SECTION[type.toLowerCase()] || 'Other', scope: scope || null, breaking: Boolean(bang), text };
}

function collect(since) {
  if (git(['rev-parse', '--is-inside-work-tree']) !== 'true') return { error: 'not a git repository' };
  const range = since ? `${since}..HEAD` : null;
  const args = ['log', '--no-merges', '--pretty=%s'];
  if (range) args.splice(1, 0, range);
  const out = git(args);
  if (out === null) return { error: since ? `git log failed for range ${range}` : 'git log failed' };
  const subjects = out.split('\n').filter(Boolean);
  const groups = {};
  for (const s of subjects) {
    const p = parse(s);
    (groups[p.section] ||= []).push(p);
  }
  return { since, count: subjects.length, groups };
}

function render(result) {
  if (result.error) return `ℹ️  ${result.error} — nothing to draft.`;
  const lines = ['## [Unreleased]', ''];
  if (result.count === 0) {
    lines.push(`_No commits since ${result.since || 'the start'}._`);
    return lines.join('\n');
  }
  for (const section of ORDER) {
    const items = result.groups[section];
    if (!items || items.length === 0) continue;
    lines.push(`### ${section}`);
    for (const it of items) {
      const scope = it.scope ? `**${it.scope}:** ` : '';
      const breaking = it.breaking ? '⚠️ BREAKING — ' : '';
      lines.push(`- ${breaking}${scope}${it.text}`);
    }
    lines.push('');
  }
  lines.push(`_Drafted from ${result.count} commit(s) since ${result.since || 'the first commit'}. Review before pasting into docs/CHANGELOG.md — this command never writes it._`);
  return lines.join('\n');
}

function main() {
  const argv = process.argv.slice(2);
  const wantJson = argv.includes('--json');
  const sinceIdx = argv.indexOf('--since');
  const since = sinceIdx !== -1 && argv[sinceIdx + 1] ? argv[sinceIdx + 1] : lastTag();
  const result = collect(since);
  console.log(wantJson ? JSON.stringify(result, null, 2) : render(result));
}

main();
