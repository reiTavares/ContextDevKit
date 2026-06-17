#!/usr/bin/env node
/**
 * ContextDevKit installer — entry point + orchestration.
 *
 * Bootstraps the AI-assisted development platform into ANY project (greenfield
 * or existing, any stack). Idempotent: re-run it to change level or pull engine
 * updates. It never clobbers your own content (CLAUDE.md, memory, config
 * overrides); it only overwrites the kit's own engine code and slash commands.
 *
 * This file is a THIN ORCHESTRATOR [ADR-0037]: it resolves the install context
 * (level / name / mode / --update), then calls the focused installers under
 * `tools/install/` — wireClaudeSettings + installClaudeHost (claude.mjs),
 * installEngine (engine.mjs), installAntigravityHost (antigravity.mjs),
 * installCodexHost (codex.mjs), and installVcsIntegration (git.mjs). It detects
 * --update and owns the summary; the
 * per-file update guards live next to the writes they protect. Adding a third host
 * is a new module + one call here, not more interleaving.
 * Run `node install.mjs --help` for usage and the full flag list.
 */
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline/promises';
import { ensureDir, read } from './tools/install/fs.mjs';
import { requireBasename, looksGreenfield } from './tools/install/project.mjs';
import { installVcsIntegration } from './tools/install/git.mjs';
import { installEngine, stampEngineVersion } from './tools/install/engine.mjs';
import { runPreflight } from './tools/install/update-preflight.mjs';
import { snapshotCriticalState, newUpdateId } from './tools/install/update-snapshot.mjs';
import { DEFERRED_ACTIVE_SESSIONS, DEFERRED_SELF_UPDATE, FAILED_SNAPSHOT, UPDATED_WITH_PENDING_MERGES } from './tools/install/update-status.mjs';
import { wireClaudeSettings, installClaudeHost } from './tools/install/claude.mjs';
import { installAntigravityHost } from './tools/install/antigravity.mjs';
import { installCodexHost } from './tools/install/codex.mjs';
import { installBridges } from './tools/install/bridges/index.mjs';
import { uninstall } from './tools/install/uninstall.mjs';
import { migrateLegacy } from './tools/install/migrate.mjs';
import { loadManifest, saveManifest, resolveConflicts } from './tools/install/sync.mjs';
import { isValidLevel } from './templates/contextkit/runtime/config/levels.mjs';
import { renumberByStarted } from './templates/contextkit/tools/scripts/workflow-number.mjs';
import { parseArgs, HELP, prompt, LEVEL_LABELS } from './tools/install/cli.mjs';
import { maybeGenerateBaseline } from './tools/install/project-map-baseline.mjs';

const KIT_ROOT = dirname(fileURLToPath(import.meta.url));
const TPL = resolve(KIT_ROOT, 'templates');

async function kitVersion() {
  try {
    return JSON.parse(await read(join(KIT_ROOT, 'package.json'))).version ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.help) {
    console.log(HELP);
    return;
  }
  if (args.version) {
    console.log(`contextdevkit ${await kitVersion()}`);
    return;
  }

  const target = resolve(args.target || process.cwd());
  await ensureDir(target);

  if (args.uninstall) {
    await uninstall(target, args.purge);
    return;
  }

  // Standalone migration: carry a legacy vibekit/ install forward, then stop.
  if (args.migrate) {
    const { report } = await migrateLegacy(target, { dryRun: args.dryRun });
    console.log(report.length ? '\n' + report.join('\n') + '\n' : '\nℹ️  no legacy vibekit/ install found — nothing to migrate.\n');
    return;
  }

  // Auto-migration: before ANYTHING reads contextkit/ (config, settings), carry a
  // legacy vibekit/ install forward so `npx contextdevkit --update` just works.
  const migration = await migrateLegacy(target, { dryRun: false });
  if (migration.report.length) console.log('\n' + migration.report.join('\n') + '\n');

  const interactive = !args.yes && process.stdout.isTTY;
  let level = Number.isInteger(args.level) ? args.level : undefined;
  let name = args.name;
  let mode = args.mode;

  if (interactive) {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    console.log('\n🌀 ContextDevKit installer\n');
    console.log(`Target: ${target}\n`);
    if (!name) name = await prompt(rl, 'Project name', requireBasename(target));
    if (!mode) {
      const auto = looksGreenfield(target) ? 'greenfield' : 'existing';
      mode = await prompt(rl, 'Mode (greenfield/existing)', auto);
    }
    if (!level) {
      console.log('\nLevels:');
      for (const [k, v] of Object.entries(LEVEL_LABELS)) console.log(`  ${k}. ${v}`);
      level = Number(await prompt(rl, '\nStart at level', String(mode === 'greenfield' ? 3 : 7)));
    }
    // CI Squad action is opt-in (ADR-0064): costs API credits + needs a repo secret.
    if (args.ciSquad === undefined) {
      const ans = await prompt(rl, '\nInstall the CI Squad GitHub Action (issue→draft PR; needs ANTHROPIC_API_KEY)? (y/N)', 'N');
      args.ciSquad = /^y/i.test(ans);
    }
    rl.close();
  }

  // Recommended starting level by project type: L3 for greenfield, L7 for a project
  // that already has code (full toolkit; gates stay inert until configured). [ADR-0009]
  const effMode = mode === 'greenfield' || mode === 'existing' ? mode : looksGreenfield(target) ? 'greenfield' : 'existing';
  const recommended = effMode === 'greenfield' ? 3 : 7;

  // Safe re-run / update: if no explicit --level, preserve the project's current
  // level (read from config) instead of silently downgrading to the default.
  if (!isValidLevel(level)) {
    try {
      const existingCfg = JSON.parse(await read(join(target, 'contextkit', 'config.json')));
      if (Number.isInteger(existingCfg.level)) level = existingCfg.level;
    } catch {
      /* no config yet */
    }
  }
  level = isValidLevel(level) ? level : recommended;
  name = name || requireBasename(target);
  mode = effMode;

  const report = [];
  const version = await kitVersion();

  // Read the prior installed engine version BEFORE installEngine stamps the new one,
  // so the update notice can honestly show the "from → to" delta.
  let priorVersion = null;
  try {
    priorVersion = (await read(join(target, 'contextkit', '.engine-version'))).trim() || null;
  } catch { /* no prior install — first-run */ }

  // Shared 3-way-sync context [ADR-0054]: host installers collect conflicts here;
  // they are resolved in ONE pass below, then the manifest baseline is stamped.
  const sync = { manifest: await loadManifest(target), nextFiles: {}, conflicts: [] };
  const ctx = { name, level, mode, version, args, sync, priorVersion };

  // --rewire: recompose ONLY .claude/settings.json for the level, then stop.
  if (args.rewire) {
    await wireClaudeSettings(target, level, report);
    console.log(report.join('\n'));
    console.log(`\n✅ Rewired to Level ${level}. Restart your host (Claude Code, Antigravity, or Codex) to load the new hooks.`);
    return;
  }

  // Preflight + external snapshot (UPDATE only) — runs BEFORE the first mutation so
  // an unsafe update defers with ZERO writes [ADR-0099 P0-02/03/04]. Active sessions
  // or a self-hosted source update default to a deferral; explicit flags override
  // (one consent never implies the other). The snapshot lives OUTSIDE the repo.
  if (args.update) {
    const preflight = await runPreflight(target, KIT_ROOT, args);
    if (preflight.status) {
      console.log(`\n⏸️  ContextDevKit update DEFERRED: ${preflight.status} — no changes were made.`);
      for (const reason of preflight.reasons) console.log(`   • ${reason}`);
      if (preflight.status === DEFERRED_ACTIVE_SESSIONS) {
        console.log('   Override (after saving your work): re-run with --allow-active-sessions.');
      }
      if (preflight.status === DEFERRED_SELF_UPDATE) {
        console.log('   Override: re-run with --allow-self-update (add --allow-active-sessions if both apply).');
      }
      return;
    }
    const updateId = newUpdateId();
    const snap = await snapshotCriticalState(target, updateId);
    if (!snap.ok) {
      console.error(`\n❌ ContextDevKit update ABORTED: ${FAILED_SNAPSHOT} — external critical-state snapshot failed to verify. No changes were made.`);
      return;
    }
    ctx.preflight = preflight;
    report.push(`✓ external snapshot taken before update (${snap.files.length} file(s), id ${updateId})`);
  }

  // Host-neutral engine + substrate (runtime, tools, seeds, config, changelog, docs).
  await installEngine(target, TPL, ctx, report);

  // 2b. Number existing workflows by start date (ADR-0071) — idempotent; a no-op
  // once they are numbered. Runs on fresh + --update; never blocks the install.
  try {
    const renamed = renumberByStarted(join(target, 'contextkit', 'memory', 'workflows'), { write: true });
    if (renamed.length) report.push(`✓ numbered ${renamed.length} workflow(s) by start date (ADR-0071)`);
  } catch { /* never block install on a numbering hiccup */ }

  // 3. Antigravity host — second native host [ADR-0036].
  await installAntigravityHost(target, TPL, ctx, report);

  // 4. Codex host — third native host (AGENTS.md, .codex, cdx runner).
  await installCodexHost(target, TPL, ctx, report);

  // 5. Claude Code host front-end (slash commands, agents/squads, CLAUDE.md).
  await installClaudeHost(target, TPL, ctx, report);

  // 5b. Resolve personalization conflicts (user decides on a TTY; "keep both" otherwise)
  // and persist the manifest baseline for the next update [ADR-0054].
  report.push(...(await resolveConflicts(target, sync, version)));
  await saveManifest(target, sync, version);

  // 5c. Claude Code settings.json (hook wiring) written LATE [ADR-0099 P0-05]: after
  // engine + hosts, write-if-changed, so file-watchers fire at most once and an
  // unchanged settings.json never churns mtime (the host-reload trigger).
  await wireClaudeSettings(target, level, report);

  // 6. VCS integration (exclude/.gitignore/.gitattributes, GitHub templates, git hooks, remote hint).
  await installVcsIntegration(target, TPL, level, args, report);

  // 7. Context bridges for non-native tools — opt-in per tool via config
  //    `bridges.enabled`; context only, no enforcement [ADR-0068].
  await installBridges(target, ctx, report);

  // FINAL critical write [ADR-0099 P0-06/P0-08]: stamp .engine-version only now that
  // engine, hosts, config, conflicts and settings have all landed. A throw at any
  // earlier step leaves the prior version (the update never "half-claims" success).
  await stampEngineVersion(target, version);
  report.push(`✓ .engine-version stamped → v${version}`);

  // ── summary ──
  console.log('\n' + report.join('\n'));
  // Install-mode banner (CDK-014): state the VCS posture explicitly and how to
  // switch, WITHOUT changing the default. Default is LOCAL-ONLY [ADR-0054];
  // --tracked opts into committing the kit. Switching is non-destructive (re-run
  // with the other flag) -- it only toggles .git/info/exclude, never the index/edits.
  if (args.tracked) {
    console.log('\n📦 Install mode: TRACKED — kit artifacts are committable (visible to teammates, other machines, CI).');
    console.log('   Switch to local-only later: re-run without --tracked (writes a .git/info/exclude block; your files stay).');
  } else {
    console.log('\n🔒 Install mode: LOCAL-ONLY (default) — kit artifacts stay out of git history via .git/info/exclude [ADR-0054].');
    console.log('   Good for solo / experiments. Team, multi-machine, or CI? Re-run with --tracked, then `git add` the kit.');
  }
  if (args.update) {
    // PMB-01 (ADR-0098) + P0-09 (ADR-0099): generate the first project-map baseline
    // when absent — but DEFER while sessions are active / on a self-update (preflight
    // carries the signal). Post-update + fail-open: non-critical, never blocks/aborts.
    const baseline = await maybeGenerateBaseline(target, { preflight: ctx.preflight });
    if (baseline?.note) console.log(`  ${baseline.note}`);

    // Honest status [ADR-0099 P0-07/P0-10]: a non-TTY run that deferred real merges
    // preserved both sides but is NOT a clean success — say so.
    if (sync.pendingMerges > 0) {
      console.log(`\n⚠️  ${UPDATED_WITH_PENDING_MERGES}: v${version} applied, but ${sync.pendingMerges} personalization conflict(s) were preserved unresolved (your files kept; kit versions stashed under contextkit/.updates/v${version}/). Merge them by hand.`);
    } else {
      console.log(`\n✅ ContextDevKit UPDATED to v${version} (Level ${level} preserved) in ${target}`);
    }
    console.log('   Refreshed: engine + host assets + hook wiring.');
    console.log('   Never modifies user-authored memory (ADRs, sessions, roadmap, business rules, project');
    console.log('   docs), CLAUDE.md, AGENTS.md, config, or pipeline tasks. Every agent/command/workflow');
    console.log('   YOU personalized is kept (conflicts: see ⚠️ lines above). Derived artifacts (project-map)');
    console.log('   may be regenerated transactionally when safe.');
    console.log('   Restart your host (Claude Code, Antigravity, or Codex) to load the refreshed hooks.');
    // Honest version-delta notice: only shown when a real version change occurred.
    // Points to CHANGELOG.md rather than enumerating changes here (source of truth is the log).
    if (priorVersion && priorVersion !== version) {
      console.log(`\n📦 Updated v${priorVersion} → v${version}. New config sections were merged where missing (see the ✓ lines above); full change list in CHANGELOG.md.`);
    }
    console.log('');
    return;
  }
  console.log(`\n✅ ContextDevKit installed at Level ${level} into ${target}`);
  console.log('\nNext steps:');
  console.log('  1. Open the project in Claude Code (it reads .claude/ + CLAUDE.md).');
  console.log('  2. Approve the hooks on first run (one-time per hook).');
  console.log('  3. ⭐ Run  /setupcontextdevkit  — it fits the kit to THIS project');
  console.log('     (detects stack, tunes config, fills CLAUDE.md, flags risks).');
  console.log('     The first-run trigger will remind you automatically.');
  console.log('  4. Then work normally. /log-session at the end.');
  if (level < 5) console.log(`  5. Level up later:  /context-level ${Math.min(level + 1, 5)}`);
  console.log('\n  Using Antigravity instead? Read INSTRUCTIONS.md, then run `node ctx.mjs`');
  console.log('  to list commands — or `node ctx.mjs session start` to begin a session.');
  console.log('  Using Codex? Read AGENTS.md; `node cdx.mjs help` lists the same command runner.');
  console.log('');
}

main().catch((err) => {
  console.error('\n❌ ContextDevKit install failed:', err?.stack || err);
  process.exit(1);
});
