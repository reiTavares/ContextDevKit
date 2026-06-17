/**
 * Integration test — P0-07: non-TTY conflict honesty (sync.pendingMerges).
 *
 * Drives `resolveConflicts` directly with a hand-built sync context so the test
 * harness does not need a real install. stdin/stdout are not TTYs in the test
 * runner (process.stdin.isTTY is undefined/false), so the non-TTY branch is
 * exercised automatically — no toggling required.
 *
 * Covers:
 *   A. NON-TTY real conflict → "both" auto-applied:
 *      - user's file on disk UNCHANGED
 *      - kit version stashed under contextkit/.updates/
 *      - sync.pendingMerges === 1
 *   B. NO CONFLICT: empty conflicts array → returns [] + sync.pendingMerges === 0
 *   C. PERSONALIZED FILE PRESERVED: sha256(user's file before) === sha256(after)
 *   D. Kit hash is stamped into sync.nextFiles[destRel] after resolution
 *      (so the same file won't re-conflict on the next run)
 */
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveConflicts } from './install/sync.mjs';
import { reporter } from './it-helpers.mjs';

const rep = reporter();
const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');
const VERSION = '3.1.2';

/** Builds a minimal sync context with one fake conflict entry. */
function makeSyncWithConflict(userFilePath, userContent, kitContent) {
  const userBuffer = Buffer.from(userContent, 'utf-8');
  const kitBuffer = Buffer.from(kitContent, 'utf-8');
  writeFileSync(userFilePath, userBuffer);
  const destRel = '.claude/agents/test-agent.md';
  return {
    sync: {
      manifest: { schema: 1, files: {} },
      nextFiles: {},
      conflicts: [
        {
          destRel,
          destPath: userFilePath,
          templateBuffer: kitBuffer,
          templateHash: sha256(kitBuffer),
        },
      ],
    },
    destRel,
    kitHash: sha256(kitBuffer),
    userHash: sha256(userBuffer),
  };
}

// ── A + C + D. Non-TTY real conflict → both preserved + pendingMerges === 1 ──
(async () => {
  const proj = mkdtempSync(join(tmpdir(), 'contextkit-sc-'));
  try {
    const userContent = '# MY TUNED AGENT — personalized content\n';
    const kitContent = '# NEW KIT VERSION OF AGENT — updated by kit\n';
    const userFilePath = join(proj, 'test-agent.md');

    const { sync, destRel, kitHash, userHash } = makeSyncWithConflict(userFilePath, userContent, kitContent);
    const userHashBefore = sha256(readFileSync(userFilePath));

    const lines = await resolveConflicts(proj, sync, VERSION);

    // A: user's file on disk must be unchanged
    const userHashAfter = sha256(readFileSync(userFilePath));
    userHashBefore === userHashAfter
      ? rep.ok('non-TTY conflict: user file on disk is unchanged')
      : rep.bad('non-TTY conflict: user file was mutated — data loss');

    // C: the exact bytes the user wrote are still there
    userHashBefore === userHash
      ? rep.ok('personalized file bytes preserved (sha256 before === sha256 after)')
      : rep.bad('personalized file bytes differ after resolveConflicts');

    // A: kit version was stashed under contextkit/.updates/
    const stashPath = join(proj, 'contextkit', '.updates', `v${VERSION}`, destRel);
    existsSync(stashPath)
      ? rep.ok('kit version stashed under contextkit/.updates/')
      : rep.bad(`kit version not stashed at expected path: ${stashPath}`);
    if (existsSync(stashPath)) {
      const stashedHash = sha256(readFileSync(stashPath));
      stashedHash === kitHash
        ? rep.ok('stashed kit version bytes are intact')
        : rep.bad('stashed kit version bytes differ from the template');
    }

    // A: pendingMerges is 1
    sync.pendingMerges === 1
      ? rep.ok('sync.pendingMerges === 1 after one non-TTY conflict')
      : rep.bad(`sync.pendingMerges expected 1, got ${sync.pendingMerges}`);

    // D: kit hash stamped into nextFiles so it won't re-conflict next run
    sync.nextFiles[destRel] === kitHash
      ? rep.ok('new kit hash stamped into sync.nextFiles[destRel]')
      : rep.bad(`sync.nextFiles[destRel] expected ${kitHash}, got ${sync.nextFiles[destRel]}`);

    // report line contains the conflict path
    lines.length === 1 && lines[0].includes(destRel)
      ? rep.ok('resolveConflicts returns one report line mentioning the conflicted file')
      : rep.bad(`unexpected report lines: ${JSON.stringify(lines)}`);
  } finally {
    rmSync(proj, { recursive: true, force: true });
  }
})().then(runNoConflict);

// ── B. No conflict: empty conflicts array → [] + pendingMerges === 0 ──────────
async function runNoConflict() {
  const sync = {
    manifest: { schema: 1, files: {} },
    nextFiles: {},
    conflicts: [],
  };
  const proj = mkdtempSync(join(tmpdir(), 'contextkit-sc-nc-'));
  try {
    const lines = await resolveConflicts(proj, sync, VERSION);
    lines.length === 0
      ? rep.ok('no conflict: resolveConflicts returns empty array')
      : rep.bad(`no conflict: expected [], got ${JSON.stringify(lines)}`);
    sync.pendingMerges === 0
      ? rep.ok('no conflict: sync.pendingMerges === 0')
      : rep.bad(`no conflict: sync.pendingMerges expected 0, got ${sync.pendingMerges}`);
    typeof sync.pendingMerges === 'number'
      ? rep.ok('sync.pendingMerges field always exists (even with zero conflicts)')
      : rep.bad('sync.pendingMerges field missing after empty-conflicts call');
  } finally {
    rmSync(proj, { recursive: true, force: true });
  }
  rep.finish('Integration (sync conflict honesty, P0-07)');
}
