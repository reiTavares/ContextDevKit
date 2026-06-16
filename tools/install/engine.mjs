/**
 * Engine + substrate installation — the host-neutral core both hosts share [ADR-0037].
 *
 * Lays down everything that is NOT a host front-end: the engine code
 * (`contextkit/runtime` + `tools`), the memory/pipeline/workflow/detector/starter
 * seeds, `config.json`, the CHANGELOG, and the Diátaxis docs spine. The Claude and
 * Antigravity host installers sit on top of this. Extracted from install.mjs when a
 * second host turned the linear recipe into three interleaved concerns.
 */
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { PLATFORM_DIR } from '../../templates/contextkit/runtime/config/paths.mjs';
import { applyPreset, listPresets } from '../../templates/contextkit/runtime/config/presets.mjs';
import { migrateConfigSections } from './config-migrate.mjs';
import { migratePolicyStores } from './policy-migrate.mjs';
import { DEFAULT_CONFIG } from '../../templates/contextkit/runtime/config/defaults.mjs';
import { reindexDocs } from '../../templates/contextkit/tools/scripts/docs-reindex.mjs';
import { read, overwrite, atomicWrite, backup, copyTree, copyTreeIfMissing, writeIfMissing, ensureDir, render } from './fs.mjs';
import { syncFile, syncTree } from './sync.mjs';
import { migrateConfigPaths } from './config-paths.mjs';

// Memory/substrate files seeded write-if-missing so the user's edits survive a re-install.
const MEMORY_SEEDS = [
  'memory/SESSIONS.md', 'memory/WORKSPACE.md', 'memory/GLOSSARY.md', 'memory/roadmap.md',
  'memory/DELIBERATIONS.md', 'memory/decisions/_TEMPLATE.md', 'memory/decisions/0000-record-architecture-decisions.md',
  'memory/deliberations/_TEMPLATE.md', 'memory/deliberations/.gitkeep', 'memory/business-rules/_TEMPLATE.md',
  'memory/predictions/.gitkeep', 'memory/project-map/.gitkeep', 'memory/project-map/rules.example.json', 'memory/sessions/.gitkeep',
  'memory/workflows/.gitkeep', 'memory/workflows/_TEMPLATE/index.md', 'memory/workflows/_TEMPLATE/prd.md',
  'memory/workflows/_TEMPLATE/spec.md', 'memory/workflows/_TEMPLATE/decisions.md',
  'memory/workflows/_TEMPLATE/tasks.md', 'memory/workflows/_TEMPLATE/memory.md',
  'memory/workflows/_TEMPLATE/reports/.gitkeep', 'instrucoes.md', 'best-practices.md',
  'review-protocol.md', 'behaviors.md', 'behaviors-examples.md', 'CLAUDE.child.md.tpl', 'squads/README.md',
  'squads/_BRIEFING.md.tpl', 'policy/complexity-rubric.json', 'policy/routing-policy.json', 'policy/squads-registry.json',
  'policy/capability-registry.json', '.env.example',
];

/** Copies the engine (always overwrite — kit code) and stamps the version [ADR-0033]. */
async function copyEngine(target, tplDir, version, report) {
  await copyTree(join(tplDir, 'contextkit', 'runtime'), join(target, 'contextkit', 'runtime'));
  await copyTree(join(tplDir, 'contextkit', 'tools'), join(target, 'contextkit', 'tools'));
  // SessionStart compares this to a per-session "seen" marker and announces updates.
  await overwrite(join(target, 'contextkit', '.engine-version'), `${version}\n`);
  report.push('✓ engine installed (contextkit/runtime, contextkit/tools)');
}

/** Seeds memory, pipeline and detectors (write-if-missing, user-owned); syncs workflows, overwrites starters. */
async function seedSubstrate(target, tplDir, ctx, report) {
  const force = ctx.args.force;
  for (const rel of MEMORY_SEEDS) {
    const src = join(tplDir, 'contextkit', rel);
    if (!existsSync(src)) continue;
    if (await writeIfMissing(join(target, 'contextkit', rel), await read(src), force)) report.push(`✓ seeded contextkit/${rel}`);
  }
  for (const d of ['sessions', 'decisions', 'business-rules', 'predictions', 'deliberations', 'project-map', 'workflows']) {
    await ensureDir(join(target, 'contextkit', 'memory', d));
  }
  const pipeCount = await copyTreeIfMissing(join(tplDir, 'contextkit', 'pipeline'), join(target, 'contextkit', 'pipeline'));
  if (pipeCount > 0) report.push(`✓ seeded contextkit/pipeline (${pipeCount} file(s))`);
  for (const s of ['backlog', 'testing', 'conclusion']) await ensureDir(join(target, 'contextkit', 'pipeline', s));
  // Workflow guides + playbooks: kit content the user may tune — 3-way sync so a
  // personalized playbook survives --update, while kit renames/edits still land [ADR-0054].
  const wf = await syncTree(join(tplDir, 'contextkit', 'workflows'), target, 'contextkit/workflows', ctx.sync);
  report.push(`✓ workflow guides + playbooks installed (contextkit/workflows)${wf.kept ? ` — kept ${wf.kept} personalized` : ''}`);
  const detCount = await copyTreeIfMissing(join(tplDir, 'contextkit', 'detectors'), join(target, 'contextkit', 'detectors'));
  if (detCount > 0) report.push(`✓ seeded contextkit/detectors (${detCount} file(s))`);
  // Curated-stack starters: always overwrite — pure templates, copied OUT by /aidevtool-from0.
  await copyTree(join(tplDir, 'contextkit', 'starters'), join(target, 'contextkit', 'starters'));
  report.push('✓ curated-stack starters installed (contextkit/starters)');
}

/** Refreshes the installed kit README through the ADR-0054 manifest-safe path. */
async function syncContextReadme(target, tplDir, ctx, report) {
  const readme = await syncFile(join(tplDir, 'contextkit', 'README.md'), target, 'contextkit/README.md', ctx.sync);
  if (readme.written) report.push('✓ refreshed contextkit/README.md');
  if (readme.kept) report.push('✓ kept personalized contextkit/README.md');
  if (readme.conflicted) report.push('⚠️  contextkit/README.md changed locally and upstream; conflict queued');
}

/**
 * Updates an existing config.json: level, first-run flag, legacy-path healing and
 * additive section merge. Writes ATOMICALLY and only when the content actually
 * changed (idempotent — a second `--update` is a no-op). A legacy-path rewrite is
 * a repair, so the original is backed up to `config.json.bak` first; a malformed
 * file is left untouched (P0 hotfix 3.0.1).
 */
async function updateConfig(target, cfgPath, level, preset, report) {
  let original;
  try {
    original = await read(cfgPath);
  } catch {
    return; // unreadable — leave it for the user
  }
  let cfg;
  try {
    cfg = JSON.parse(original);
  } catch {
    report.push('⚠️  contextkit/config.json is not valid JSON — left untouched (run /context-doctor)');
    return;
  }
  cfg.level = level;
  if (cfg.setup?.completed !== true) cfg.setup = { completed: false, installedAt: new Date().toISOString() };
  const healed = migrateConfigPaths(target, cfg); // allowlist-gated; never touches project paths
  const { cfg: withDefaults, added } = migrateConfigSections(cfg, DEFAULT_CONFIG);
  cfg = withDefaults;
  if (preset) cfg = applyPreset(cfg, preset);
  const next = JSON.stringify(cfg, null, 2) + '\n';
  if (next === original) return; // no change — don't rewrite (idempotent)
  if (healed > 0 && !(await backup(cfgPath))) {
    report.push('⚠️  could not write config.json.bak before the legacy-path repair — proceeding (allowlist-gated, non-destructive)');
  }
  await atomicWrite(cfgPath, next);
  report.push(`✓ updated contextkit/config.json level → ${level}${preset ? ` (+preset ${preset})` : ''}`);
  if (added.length) report.push(`✓ added ${added.length} new config section(s) on update: ${added.join(', ')}`);
  if (healed > 0) report.push(`✓ migrated ${healed} legacy 'vibekit/' config path(s) onto ${PLATFORM_DIR}/ (backup: config.json.bak)`);
}

/** Creates config.json (level + first-run flag) or updates the level, preserving a finished setup. */
async function writeConfig(target, tplDir, level, args, report) {
  const cfgPath = join(target, 'contextkit', 'config.json');
  const preset = args.preset && listPresets().includes(args.preset) ? args.preset : null;
  if (args.preset && !preset) report.push(`⚠️  unknown --preset "${args.preset}" (have: ${listPresets().join(', ')}) — ignored`);
  if (existsSync(cfgPath)) {
    await updateConfig(target, cfgPath, level, preset, report);
  } else {
    let cfg = JSON.parse(await read(join(tplDir, 'contextkit', 'config.json')));
    cfg.level = level;
    cfg.setup = { completed: false, installedAt: new Date().toISOString() };
    if (preset) cfg = applyPreset(cfg, preset);
    await overwrite(cfgPath, JSON.stringify(cfg, null, 2) + '\n');
    report.push(`✓ created contextkit/config.json (level ${level}, first-run pending${preset ? `, preset ${preset}` : ''})`);
  }
}

/** Renders the CHANGELOG if missing and (re)builds the Diátaxis docs spine [ADR-0030]. */
async function seedDocs(target, tplDir, name, report) {
  const changelogPath = join(target, 'docs', 'CHANGELOG.md');
  if (!existsSync(changelogPath)) {
    const clTpl = await read(join(tplDir, 'docs', 'CHANGELOG.md.tpl'));
    await overwrite(changelogPath, render(clTpl, { PROJECT_NAME: name, DATE: new Date().toISOString().slice(0, 10) }));
    report.push('✓ docs/CHANGELOG.md created');
  }
  // Idempotent + non-destructive: never moves/deletes a content file, never clobbers a
  // hand-written index. Runs on --update too. Defensive: never breaks an install.
  try {
    const docs = reindexDocs(target);
    if (docs.seeded.length) report.push(`✓ seeded Diátaxis docs spine (${docs.seeded.length} bucket README(s))`);
    if (docs.indexWritten) report.push(`✓ regenerated docs/README.md (Diátaxis index — ${docs.indexed} doc(s))`);
  } catch (err) {
    report.push(`ℹ️  docs reindex skipped: ${err?.message ?? err}`);
  }
}

/**
 * Installs the host-neutral engine + substrate into the target.
 * @param {string} target - project root
 * @param {string} tplDir - templates dir
 * @param {{name:string, level:number, version:string, args:object}} ctx - install context
 * @param {string[]} report - mutated with progress lines
 */
export async function installEngine(target, tplDir, ctx, report) {
  await copyEngine(target, tplDir, ctx.version, report);
  await seedSubstrate(target, tplDir, ctx, report);
  // Additively distribute new policy keys into existing stores (ADR-0097/CDK-082).
  // Idempotent + additive; runs after seeding so freshly-seeded stores are skipped.
  await migratePolicyStores(target, tplDir, { read, overwrite }, report);
  await syncContextReadme(target, tplDir, ctx, report);
  await writeConfig(target, tplDir, ctx.level, ctx.args, report);
  await seedDocs(target, tplDir, ctx.name, report);
}
