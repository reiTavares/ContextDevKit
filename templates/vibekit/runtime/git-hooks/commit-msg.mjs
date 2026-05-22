#!/usr/bin/env node
/**
 * commit-msg git hook (Level >= 3) — validates Conventional Commits.
 *
 * Pattern: <type>(<scope>)?: <subject>
 *   - type: feat | fix | chore | docs | refactor | test | ci | build | perf | style | revert
 *   - scope: optional, lowercase a-z0-9-
 *   - subject: 1..100 chars, no trailing period
 *
 * Bypass: include `[skip-cc]` anywhere in the subject.
 *
 * Invoked by `.git/hooks/commit-msg` (the installer drops a thin wrapper that
 * calls this file). Exit 0 = allowed, 1 = blocked.
 */
import { readFileSync } from 'node:fs';

const messageFile = process.argv[2];
if (!messageFile) {
  console.error('commit-msg hook: missing message file argument');
  process.exit(1);
}

const subject = readFileSync(messageFile, 'utf-8').split('\n')[0].trim();

if (/^(Merge|Revert|fixup!|squash!|amend!|wip:)/i.test(subject) || subject.includes('[skip-cc]')) {
  process.exit(0);
}

const PATTERN = /^(feat|fix|chore|docs|refactor|test|ci|build|perf|style|revert)(\([a-z0-9-]+\))?: .{1,100}$/;

if (!PATTERN.test(subject)) {
  console.error('');
  console.error('✗ Commit message does not follow Conventional Commits format.');
  console.error('');
  console.error(`Got:    ${subject}`);
  console.error('');
  console.error('Expected: <type>(<scope>)?: <subject>');
  console.error('  type:    feat | fix | chore | docs | refactor | test | ci | build | perf | style | revert');
  console.error('  subject: 1..100 chars, no trailing period');
  console.error('');
  console.error('Examples:');
  console.error('   feat(api): add schedule endpoint');
  console.error('   fix(ui): correct safe-area inset on notch');
  console.error('   chore: bump dependencies');
  console.error('');
  console.error('Bypass intentionally with `[skip-cc]` in the subject.');
  process.exit(1);
}

if (subject.endsWith('.')) {
  console.error('✗ Commit subject must not end with a period.');
  process.exit(1);
}

process.exit(0);
