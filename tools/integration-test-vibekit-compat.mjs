/**
 * Integration test — VibeKit backward-compatibility regression lock (3.1.2, P0-08).
 *
 * Rule: DETECT → PRESERVE → REPORT → REFUSE destructive collision.
 * Calls migrateLegacy / migrateConfigPaths directly (not via CLI) so every
 * invariant is assertable at module level, independent of installer changes.
 *
 * Scenarios 1–6:
 *   1. ONLY-VIBEKIT     user data preserved byte-for-byte; control files rewired.
 *   2. ONLY-CONTEXTKIT  no vibekit/ → confirmed no-op (migrated:false, empty report).
 *   3. HYBRID           both trees present → refused, BOTH preserved (guard test).
 *   4. LEGACY-CFG-PATHS allowlist gate; project paths untouched (ADR-0095).
 *   5. NO-GLOBAL-REPLACE historical prose word "vibekit" in a user doc unchanged.
 *   6. IDEMPOTENT       second run on migrated tree is a no-op.
 *
 * Run: node tools/integration-test-vibekit-compat.mjs
 */
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { reporter } from './it-helpers.mjs';

const KIT = dirname(dirname(fileURLToPath(import.meta.url)));
const toUrl = (p) => 'file:///' + resolve(p).replaceAll('\\', '/');
const sha256 = (p) => createHash('sha256').update(readFileSync(p)).digest('hex');
const read = (p) => (existsSync(p) ? readFileSync(p, 'utf-8') : '');
const tmp = () => mkdtempSync(join(tmpdir(), 'vkcompat-'));

/** Write a file creating parent dirs as needed. */
function write(root, rel, body) {
  const abs = join(root, rel);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, body, 'utf-8');
}

/** Builds a canonical legacy VibeDevKit fixture under root. */
function buildLegacy(root) {
  write(root, 'vibekit/config.json', JSON.stringify({ level: 5, setup: { completed: true }, ledger: {} }, null, 2));
  write(root, 'vibekit/runtime/hooks/session-start.mjs', '// legacy dummy\n');
  write(root, 'vibekit/memory/decisions/0001-user-adr.md', '# ADR-0001\nUser decision body.\n');
  write(root, 'vibekit/memory/WORKSPACE.md', '# Workspace\nProject notes.\n');
  write(root, 'vibekit/squads/my-agent.md', '# My Agent\nCustom agent body.\n');
  write(root, 'vibekit/memory/sessions/2026-01-01.md', '# Session 2026-01-01\nNotes.\n');
  write(root, 'vibekit/.env', 'GOOGLE_AI_API_KEY=secret\nVIBE_GIT_TIMEOUT_MS=5000\n');
  write(root, '.claude/commands/my-cmd.md', '# My custom command\n');
  write(root, '.claude/settings.json', JSON.stringify({
    hooks: { SessionStart: [{ hooks: [{ type: 'command', command: 'node vibekit/runtime/hooks/session-start.mjs' }] }] },
  }, null, 2));
  write(root, 'CLAUDE.md', 'Uses VibeDevKit. Engine in vibekit/runtime.\n');
  write(root, '.gitignore', '# VibeDevKit\nvibekit/memory/tech-debt-findings.json\n');
  write(root, '.claude/commands/vibe-stats.md', 'old vibe-stats\n');
  write(root, '.claude/commands/setup/vibe-level.md', 'old vibe-level\n');
}

(async () => {
  const rep = reporter();

  let migrateLegacy, migrateConfigPaths;
  try {
    ({ migrateLegacy } = await import(toUrl(join(KIT, 'tools/install/migrate.mjs'))));
    rep.ok('tools/install/migrate.mjs imports cleanly');
  } catch (err) {
    rep.bad(`migrate.mjs import failed: ${err?.message ?? err}`);
    rep.finish('VibeKit backward-compatibility (3.1.2)');
    return;
  }
  try {
    ({ migrateConfigPaths } = await import(toUrl(join(KIT, 'tools/install/config-paths.mjs'))));
    rep.ok('tools/install/config-paths.mjs imports cleanly');
  } catch (err) {
    rep.bad(`config-paths.mjs import failed: ${err?.message ?? err}`);
    rep.finish('VibeKit backward-compatibility (3.1.2)');
    return;
  }

  // ── S1: ONLY-VIBEKIT ───────────────────────────────────────────────────────
  await (async () => {
    const root = tmp();
    try {
      buildLegacy(root);
      const hAdr = sha256(join(root, 'vibekit/memory/decisions/0001-user-adr.md'));
      const hAgent = sha256(join(root, 'vibekit/squads/my-agent.md'));
      const hSession = sha256(join(root, 'vibekit/memory/sessions/2026-01-01.md'));
      const hCmd = sha256(join(root, '.claude/commands/my-cmd.md'));

      const { migrated, report } = await migrateLegacy(root, { dryRun: false });

      migrated === true ? rep.ok('S1: migrated:true') : rep.bad(`S1: migrated=${migrated} expected true`);
      existsSync(join(root, 'contextkit')) ? rep.ok('S1: contextkit/ created') : rep.bad('S1: contextkit/ missing');
      !existsSync(join(root, 'vibekit')) ? rep.ok('S1: vibekit/ removed') : rep.bad('S1: vibekit/ still present');

      const adrDst = join(root, 'contextkit/memory/decisions/0001-user-adr.md');
      existsSync(adrDst) && sha256(adrDst) === hAdr
        ? rep.ok('S1: user ADR byte-for-byte identical (sha256)')
        : rep.bad('S1: user ADR missing or modified after migration');

      const agentDst = join(root, 'contextkit/squads/my-agent.md');
      existsSync(agentDst) && sha256(agentDst) === hAgent
        ? rep.ok('S1: custom agent byte-for-byte identical (sha256)')
        : rep.bad('S1: custom agent missing or modified');

      const sessionDst = join(root, 'contextkit/memory/sessions/2026-01-01.md');
      existsSync(sessionDst) && sha256(sessionDst) === hSession
        ? rep.ok('S1: session file byte-for-byte identical (sha256)')
        : rep.bad('S1: session file missing or modified');

      sha256(join(root, '.claude/commands/my-cmd.md')) === hCmd
        ? rep.ok('S1: user .claude/commands file untouched')
        : rep.bad('S1: user .claude/commands file was modified');

      const settings = read(join(root, '.claude/settings.json'));
      !settings.includes('vibekit/') && settings.includes('contextkit/')
        ? rep.ok('S1: settings.json rewired — no vibekit/ refs')
        : rep.bad('S1: settings.json not rewired');

      const md = read(join(root, 'CLAUDE.md'));
      !md.includes('VibeDevKit') && md.includes('ContextDevKit')
        ? rep.ok('S1: CLAUDE.md rewritten VibeDevKit→ContextDevKit')
        : rep.bad('S1: CLAUDE.md not rewritten');

      existsSync(join(root, 'CLAUDE.md.bak')) ? rep.ok('S1: CLAUDE.md.bak exists') : rep.bad('S1: CLAUDE.md.bak missing');

      !existsSync(join(root, '.claude/commands/vibe-stats.md')) &&
      !existsSync(join(root, '.claude/commands/setup/vibe-level.md'))
        ? rep.ok('S1: stale vibe-* commands removed')
        : rep.bad('S1: stale vibe-* commands still present');

      report.length > 0 && report.some((l) => /migrat/i.test(l))
        ? rep.ok('S1: report non-empty and signals migration')
        : rep.bad(`S1: report unexpected: ${JSON.stringify(report)}`);
    } finally { rmSync(root, { recursive: true, force: true }); }
  })();

  // ── S2: ONLY-CONTEXTKIT ────────────────────────────────────────────────────
  await (async () => {
    const root = tmp();
    try {
      write(root, 'contextkit/config.json', JSON.stringify({ level: 5 }, null, 2));
      write(root, 'contextkit/memory/decisions/0001.md', '# ADR\n');
      const hCfg = sha256(join(root, 'contextkit/config.json'));
      const hAdr = sha256(join(root, 'contextkit/memory/decisions/0001.md'));

      const { migrated, report } = await migrateLegacy(root, { dryRun: false });

      migrated === false ? rep.ok('S2: migrated:false (no-op)') : rep.bad(`S2: migrated=${migrated} expected false`);
      report.length === 0 ? rep.ok('S2: empty report') : rep.bad(`S2: non-empty report: ${JSON.stringify(report)}`);
      sha256(join(root, 'contextkit/config.json')) === hCfg ? rep.ok('S2: contextkit/config.json unchanged') : rep.bad('S2: config.json modified');
      sha256(join(root, 'contextkit/memory/decisions/0001.md')) === hAdr ? rep.ok('S2: memory doc unchanged') : rep.bad('S2: memory doc modified');
    } finally { rmSync(root, { recursive: true, force: true }); }
  })();

  // ── S3: HYBRID ─────────────────────────────────────────────────────────────
  // Both vibekit/ AND contextkit/ present. Guard must refuse and preserve both.
  await (async () => {
    const root = tmp();
    try {
      buildLegacy(root);
      write(root, 'contextkit/config.json', JSON.stringify({ level: 3, existing: true }, null, 2));
      write(root, 'contextkit/memory/decisions/0099-my-adr.md', '# My precious ADR\n');
      const hCkCfg = sha256(join(root, 'contextkit/config.json'));
      const hCkAdr = sha256(join(root, 'contextkit/memory/decisions/0099-my-adr.md'));
      const hVkCfg = sha256(join(root, 'vibekit/config.json'));

      const { migrated, report } = await migrateLegacy(root, { dryRun: false });

      migrated === false
        ? rep.ok('S3: HYBRID migrated:false (refused)')
        : rep.bad(`S3: HYBRID migrated=${migrated} — REGRESSION: should refuse`);

      report.some((l) => /BOTH/i.test(l))
        ? rep.ok('S3: HYBRID report warns BOTH installs')
        : rep.bad(`S3: HYBRID no BOTH warning: ${JSON.stringify(report)}`);

      sha256(join(root, 'contextkit/config.json')) === hCkCfg
        ? rep.ok('S3: HYBRID contextkit/config.json unchanged (not clobbered)')
        : rep.bad('S3: HYBRID contextkit/config.json modified — REGRESSION: data loss');

      sha256(join(root, 'contextkit/memory/decisions/0099-my-adr.md')) === hCkAdr
        ? rep.ok('S3: HYBRID contextkit/ ADR unchanged')
        : rep.bad('S3: HYBRID contextkit/ ADR modified — REGRESSION: data loss');

      existsSync(join(root, 'vibekit/config.json')) && sha256(join(root, 'vibekit/config.json')) === hVkCfg
        ? rep.ok('S3: HYBRID vibekit/ preserved intact')
        : rep.bad('S3: HYBRID vibekit/ removed or modified');
    } finally { rmSync(root, { recursive: true, force: true }); }
  })();

  // ── S4: LEGACY CONFIG PATHS ────────────────────────────────────────────────
  // migrateConfigPaths heals allowlisted vibekit/ prefixes only (ADR-0095).
  await (async () => {
    const root = tmp();
    try {
      write(root, 'contextkit/memory/SESSIONS.md', '# Sessions\n');
      write(root, 'contextkit/memory/decisions/index.md', '# Decisions\n');

      const cfg = {
        ledger: {
          registration: ['vibekit/memory/SESSIONS.md', 'docs/CHANGELOG.md'],
          important: ['vibekit/memory/decisions', 'src/api/'],
          irrelevant: [],
        },
        l5: { highRiskPaths: ['vibekit/memory/ghost.md', 'src/index.mjs'] },
        qa: { criticalPaths: ['vibekit/memory/decisions/index.md'] },
      };
      const count = migrateConfigPaths(root, cfg);

      count >= 1 ? rep.ok(`S4: migrateConfigPaths: ${count} rewrite(s)`) : rep.bad(`S4: count=${count} expected ≥1`);
      cfg.ledger.registration.includes('contextkit/memory/SESSIONS.md') ? rep.ok('S4: SESSIONS.md healed') : rep.bad('S4: SESSIONS.md not healed');
      cfg.ledger.registration.includes('docs/CHANGELOG.md') ? rep.ok('S4: docs/ path untouched') : rep.bad('S4: docs/ was rewritten');
      cfg.ledger.important.includes('src/api/') ? rep.ok('S4: src/api/ untouched') : rep.bad('S4: src/api/ was rewritten');
      cfg.l5.highRiskPaths.includes('vibekit/memory/ghost.md') ? rep.ok('S4: unresolvable path left as-is') : rep.bad('S4: ghost path guessed');
      cfg.l5.highRiskPaths.includes('src/index.mjs') ? rep.ok('S4: src/ path untouched in l5') : rep.bad('S4: src/index.mjs rewritten');
    } finally { rmSync(root, { recursive: true, force: true }); }
  })();

  // ── S5: NO GLOBAL REPLACE ──────────────────────────────────────────────────
  // Historical prose containing "vibekit" inside a user ADR must survive intact.
  await (async () => {
    const root = tmp();
    try {
      buildLegacy(root);
      const prose = '# ADR-0042\nWe formerly used vibekit as the folder name.\nThe vibekit era ended in 3.0.0.\n';
      write(root, 'vibekit/memory/decisions/0042-rename.md', prose);
      const hProse = createHash('sha256').update(prose, 'utf-8').digest('hex');

      await migrateLegacy(root, { dryRun: false });

      const dst = join(root, 'contextkit/memory/decisions/0042-rename.md');
      if (!existsSync(dst)) {
        rep.bad('S5: relocated ADR not found in contextkit/');
      } else {
        sha256(dst) === hProse
          ? rep.ok('S5: historical prose hash unchanged — no global replace')
          : rep.bad('S5: historical prose modified — global replace present');
        read(dst).includes('vibekit era ended')
          ? rep.ok('S5: "vibekit" prose text intact inside relocated ADR')
          : rep.bad('S5: prose text was rewritten by migrateLegacy');
      }
    } finally { rmSync(root, { recursive: true, force: true }); }
  })();

  // ── S6: IDEMPOTENT SECOND RUN ──────────────────────────────────────────────
  await (async () => {
    const root = tmp();
    try {
      buildLegacy(root);
      const first = await migrateLegacy(root, { dryRun: false });
      first.migrated === true ? rep.ok('S6: first run migrated:true') : rep.bad(`S6: first run migrated=${first.migrated}`);

      const hCfg = existsSync(join(root, 'contextkit/config.json')) ? sha256(join(root, 'contextkit/config.json')) : null;
      const second = await migrateLegacy(root, { dryRun: false });

      second.migrated === false ? rep.ok('S6: second run migrated:false (idempotent)') : rep.bad(`S6: second run migrated=${second.migrated}`);
      second.report.length === 0 ? rep.ok('S6: second run empty report') : rep.bad(`S6: second run non-empty report: ${JSON.stringify(second.report)}`);
      hCfg && sha256(join(root, 'contextkit/config.json')) === hCfg ? rep.ok('S6: contextkit/config.json unchanged on 2nd run') : rep.bad('S6: config.json modified by 2nd run');
      !existsSync(join(root, 'vibekit')) ? rep.ok('S6: vibekit/ absent after 2nd run') : rep.bad('S6: vibekit/ re-appeared');
    } finally { rmSync(root, { recursive: true, force: true }); }
  })();

  rep.finish('VibeKit backward-compatibility (3.1.2, P0-08)');
})();
