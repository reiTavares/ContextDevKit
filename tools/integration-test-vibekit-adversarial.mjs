/**
 * Integration test — VibeKit adversarial migration cases (3.1.2, P0-08 extension).
 *
 * Complements integration-test-vibekit-compat.mjs (scenarios S1-S6) by adding
 * adversarial cases NOT covered there. Does NOT duplicate existing scenarios.
 *
 * Adversarial scenarios:
 *   ADV-A  Custom AGENT, COMMAND, TEST, SCRIPT under vibekit/ → preserved byte-for-byte.
 *   ADV-B  Legacy session file under vibekit/ memory → preserved, never rewritten.
 *   ADV-C  Hybrid (vibekit/ + contextkit/) with ID collision (same relative path,
 *          different content) → migrateLegacy refuses; BOTH preserved; pre-existing
 *          contextkit/ bytes are unchanged.
 *   ADV-D  Second migration run on already-migrated tree is idempotent.
 *   ADV-E  Historical prose "VibeKit"/"vibekit" in a user memory doc is NOT globally
 *          rewritten (sha256 identical before/after).
 *
 * Run: node tools/integration-test-vibekit-adversarial.mjs  (exit 0 = pass)
 */
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { reporter } from './it-helpers.mjs';

const KIT = dirname(dirname(fileURLToPath(import.meta.url)));
const toUrl = (p) => 'file:///' + resolve(p).replaceAll('\\', '/');

/**
 * SHA-256 hex of a file's raw bytes. Byte-identity check — a matching hash means
 * NO content was changed, not merely "looks similar".
 */
const sha256 = (filePath) => createHash('sha256').update(readFileSync(filePath)).digest('hex');
const tmp = () => mkdtempSync(join(tmpdir(), 'vk-adv-'));

/** Writes `body` to `root/rel`, creating parent directories as needed. */
function write(root, rel, body) {
  const abs = join(root, rel);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, body, 'utf-8');
}

/**
 * Builds an extended legacy VibeDevKit fixture: includes custom agent, command,
 * test file, user script, and a session memory file — beyond the basic fixture
 * in vibekit-compat.mjs, which lacks test + script + session types.
 */
function buildExtendedLegacy(root) {
  write(root, 'vibekit/config.json', JSON.stringify({ level: 5, setup: { completed: true } }, null, 2));
  write(root, 'vibekit/runtime/hooks/session-start.mjs', '// legacy dummy hook\n');
  write(root, 'vibekit/squads/my-custom-agent.md', '# Custom Agent\nThis is my bespoke VibeKit agent.\n');
  write(root, '.claude/commands/my-feature-cmd.md', '# My Feature Command\nBespoke user command.\n');
  write(root, 'vibekit/tools/test-my-feature.mjs', '// user test file\nexport function testMyFeature() { return true; }\n');
  write(root, 'vibekit/tools/scripts/my-deploy.sh', '#!/bin/bash\n# My custom deploy script\necho "deploying my app"\n');
  write(root, 'vibekit/memory/sessions/2025-12-15-initial-design.md',
    '# Session: Initial Design\nWe decided to use VibeKit for project memory.\n');
  write(root, 'vibekit/memory/decisions/0005-use-vibekit.md', '# ADR-0005\nDecided to use VibeKit.\n');
  write(root, '.claude/settings.json', JSON.stringify({
    hooks: { SessionStart: [{ hooks: [{ type: 'command', command: 'node vibekit/runtime/hooks/session-start.mjs' }] }] },
  }, null, 2));
  write(root, 'CLAUDE.md', '# Project\nUses VibeDevKit. Engine in vibekit/runtime.\n');
  write(root, '.gitignore', '# VibeDevKit\nvibekit/memory/tech-debt-findings.json\n');
}

const rep = reporter();

console.log('\n🌀 Integration test — VibeKit adversarial migration (P0-08 extended)\n');

let migrateLegacy;
try {
  ({ migrateLegacy } = await import(toUrl(join(KIT, 'tools/install/migrate.mjs'))));
  rep.ok('tools/install/migrate.mjs imports cleanly');
} catch (err) {
  rep.bad(`migrate.mjs import failed: ${err?.message ?? err}`);
  rep.finish('VibeKit adversarial migration (3.1.2, P0-08 extension)');
}

// ── ADV-A: custom AGENT, COMMAND, TEST, SCRIPT — preserved byte-for-byte ─────
await (async () => {
  const root = tmp();
  try {
    buildExtendedLegacy(root);
    const hAgent = sha256(join(root, 'vibekit/squads/my-custom-agent.md'));
    const hCmd = sha256(join(root, '.claude/commands/my-feature-cmd.md'));
    const hTest = sha256(join(root, 'vibekit/tools/test-my-feature.mjs'));
    const hScript = sha256(join(root, 'vibekit/tools/scripts/my-deploy.sh'));

    const { migrated } = await migrateLegacy(root, { dryRun: false });
    migrated === true ? rep.ok('ADV-A: migrated:true') : rep.bad(`ADV-A: migrated=${migrated} expected true`);

    const agentDst = join(root, 'contextkit/squads/my-custom-agent.md');
    existsSync(agentDst) && sha256(agentDst) === hAgent
      ? rep.ok('ADV-A: custom AGENT preserved byte-for-byte (sha256)')
      : rep.bad('ADV-A: custom AGENT missing or content modified');

    sha256(join(root, '.claude/commands/my-feature-cmd.md')) === hCmd
      ? rep.ok('ADV-A: custom COMMAND byte-for-byte identical (sha256)')
      : rep.bad('ADV-A: custom COMMAND was modified by migration');

    const testDst = join(root, 'contextkit/tools/test-my-feature.mjs');
    existsSync(testDst) && sha256(testDst) === hTest
      ? rep.ok('ADV-A: custom TEST file preserved byte-for-byte (sha256)')
      : rep.bad('ADV-A: custom TEST file missing or content modified');

    const scriptDst = join(root, 'contextkit/tools/scripts/my-deploy.sh');
    existsSync(scriptDst) && sha256(scriptDst) === hScript
      ? rep.ok('ADV-A: custom SCRIPT preserved byte-for-byte (sha256)')
      : rep.bad('ADV-A: custom SCRIPT missing or content modified');
  } finally { rmSync(root, { recursive: true, force: true }); }
})();

// ── ADV-B: legacy session file — preserved, never rewritten ──────────────────
await (async () => {
  const root = tmp();
  try {
    buildExtendedLegacy(root);
    const sessionSrc = join(root, 'vibekit/memory/sessions/2025-12-15-initial-design.md');
    const hSession = sha256(sessionSrc);

    const { migrated } = await migrateLegacy(root, { dryRun: false });
    migrated === true ? rep.ok('ADV-B: migrated:true') : rep.bad(`ADV-B: migrated=${migrated} expected true`);

    const sessionDst = join(root, 'contextkit/memory/sessions/2025-12-15-initial-design.md');
    if (!existsSync(sessionDst)) {
      rep.bad('ADV-B: legacy session file missing in contextkit/ after migration');
    } else {
      sha256(sessionDst) === hSession
        ? rep.ok('ADV-B: session file preserved byte-for-byte (sha256)')
        : rep.bad('ADV-B: session file content was modified during migration');
    }
    !existsSync(sessionSrc)
      ? rep.ok('ADV-B: source session file removed from vibekit/ after move')
      : rep.bad('ADV-B: source session still at vibekit/ — duplicate files');
  } finally { rmSync(root, { recursive: true, force: true }); }
})();

// ── ADV-C: Hybrid with ID collision — refuses; BOTH preserved unchanged ───────
await (async () => {
  const root = tmp();
  try {
    buildExtendedLegacy(root);
    const collisionRel = 'memory/decisions/0005-use-vibekit.md';
    const contextkitContent = '# ADR-0005 (contextkit version)\nDifferent content — must NOT be clobbered.\n';
    write(root, `contextkit/${collisionRel}`, contextkitContent);
    write(root, 'contextkit/config.json', JSON.stringify({ level: 5, existing: true }, null, 2));

    const hCk = sha256(join(root, `contextkit/${collisionRel}`));
    const hVk = sha256(join(root, `vibekit/${collisionRel}`));
    hCk !== hVk ? rep.ok('ADV-C: fixture collision files have different content (valid)')
                : rep.bad('ADV-C: test fixture bug — collision files identical');

    const { migrated, report } = await migrateLegacy(root, { dryRun: false });
    migrated === false ? rep.ok('ADV-C: HYBRID+collision migrated:false (refused)')
                      : rep.bad(`ADV-C: HYBRID+collision migrated=${migrated} — REGRESSION`);
    report.some((l) => /BOTH/i.test(l)) ? rep.ok('ADV-C: report warns BOTH installs')
                                        : rep.bad(`ADV-C: no BOTH warning: ${JSON.stringify(report)}`);

    sha256(join(root, `contextkit/${collisionRel}`)) === hCk
      ? rep.ok('ADV-C: contextkit/ collision file bytes unchanged (not clobbered)')
      : rep.bad('ADV-C: contextkit/ collision file modified — data loss REGRESSION');

    existsSync(join(root, `vibekit/${collisionRel}`)) && sha256(join(root, `vibekit/${collisionRel}`)) === hVk
      ? rep.ok('ADV-C: vibekit/ source preserved intact')
      : rep.bad('ADV-C: vibekit/ source removed or modified');
  } finally { rmSync(root, { recursive: true, force: true }); }
})();

// ── ADV-D: second migration run is idempotent ─────────────────────────────────
await (async () => {
  const root = tmp();
  try {
    buildExtendedLegacy(root);
    const first = await migrateLegacy(root, { dryRun: false });
    first.migrated === true ? rep.ok('ADV-D: first run migrated:true') : rep.bad(`ADV-D: first migrated=${first.migrated}`);

    const hCfg = existsSync(join(root, 'contextkit/config.json')) ? sha256(join(root, 'contextkit/config.json')) : null;
    const second = await migrateLegacy(root, { dryRun: false });

    second.migrated === false ? rep.ok('ADV-D: second run migrated:false (idempotent)')
                              : rep.bad(`ADV-D: second run migrated=${second.migrated} — not idempotent`);
    second.report.length === 0 ? rep.ok('ADV-D: second run empty report')
                               : rep.bad(`ADV-D: second run non-empty report: ${JSON.stringify(second.report)}`);
    hCfg && sha256(join(root, 'contextkit/config.json')) === hCfg
      ? rep.ok('ADV-D: contextkit/config.json unchanged on 2nd run')
      : rep.bad('ADV-D: contextkit/config.json modified by 2nd run');
    !existsSync(join(root, 'vibekit')) ? rep.ok('ADV-D: vibekit/ absent after 2nd run')
                                       : rep.bad('ADV-D: vibekit/ re-appeared after 2nd run');
  } finally { rmSync(root, { recursive: true, force: true }); }
})();

// ── ADV-E: historical prose "VibeKit"/"vibekit" in user doc — NOT rewritten ──
// Different from S5 in vibekit-compat.mjs: nested memory subdirectory, both
// "VibeKit" and "vibekit" casing variants, plus a URL-like reference.
await (async () => {
  const root = tmp();
  try {
    buildExtendedLegacy(root);
    const proseContent = [
      '# My Project Journal',
      'We initially evaluated VibeKit as an alternative to other tools.',
      'The vibekit folder structure was familiar to our team.',
      'Reference: https://github.com/example/vibekit-old-repo',
      'Later renamed: VibeKit → ContextDevKit in version 3.0.',
    ].join('\n');
    write(root, 'vibekit/memory/notes/2025-project-journal.md', proseContent);
    const hProse = createHash('sha256').update(proseContent, 'utf-8').digest('hex');

    await migrateLegacy(root, { dryRun: false });

    const proseDst = join(root, 'contextkit/memory/notes/2025-project-journal.md');
    if (!existsSync(proseDst)) {
      rep.bad('ADV-E: relocated journal doc not found in contextkit/');
    } else {
      sha256(proseDst) === hProse
        ? rep.ok('ADV-E: historical prose sha256 unchanged (no global replace)')
        : rep.bad('ADV-E: historical prose was modified — token replace reached user docs (REGRESSION)');
      readFileSync(proseDst, 'utf-8').includes('initially evaluated VibeKit')
        ? rep.ok('ADV-E: "VibeKit" prose text intact inside relocated journal')
        : rep.bad('ADV-E: prose text was rewritten by migrateLegacy');
    }
  } finally { rmSync(root, { recursive: true, force: true }); }
})();

rep.finish('VibeKit adversarial migration (3.1.2, P0-08 extension)');
