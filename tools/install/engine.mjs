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
import { DEFAULT_CONFIG } from '../../templates/contextkit/runtime/config/defaults.mjs';
import { reindexDocs } from '../../templates/contextkit/tools/scripts/docs-reindex.mjs';
import { read, overwrite, copyTree, copyTreeIfMissing, writeIfMissing, ensureDir, render } from './fs.mjs';
import { syncFile, syncTree } from './sync.mjs';

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
  'squads/_BRIEFING.md.tpl', 'policy/complexity-rubric.json', 'policy/routing-policy.json', 'policy/squads-registry.json', '.env.example',
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
 * Migrates a config path list off a renamed platform dir (deferred half of card
 * 145; ticket 146). The folder migration (`migrateLegacy`) moves `vibekit/` →
 * `contextkit/` on disk but leaves the `ledger.*` / `l5.highRiskPaths` /
 * `qa.criticalPaths` STRINGS inside config.json pointing at the dead prefix —
 * doctor flags that rot (card 145), this heals it.
 *
 * Generic by construction (rule 4 — no literal "vibekit"): for each entry that
 * does NOT resolve on disk, it swaps the leading path segment for the current
 * `PLATFORM_DIR` and adopts the rewrite ONLY when the candidate exists (rule 8 —
 * never silently rewrite to another nonexistent path; leave the rest for doctor).
 * @param {string} target project root
 * @param {string[]|undefined} entries the path list to heal
 * @param {{n:number}} counter mutated with the number of rewrites
 * @returns {string[]|undefined} the healed list (same reference shape)
 */
function healPathList(target, entries, counter) {
  if (!Array.isArray(entries)) return entries;
  return entries.map((entry) => {
    if (typeof entry !== 'string' || !entry.includes('/')) return entry;
    if (existsSync(join(target, entry))) return entry; // current path is fine
    const head = entry.slice(0, entry.indexOf('/'));
    if (head === PLATFORM_DIR) return entry; // already current prefix, genuinely missing — doctor's job
    const candidate = `${PLATFORM_DIR}/${entry.slice(entry.indexOf('/') + 1)}`;
    if (!existsSync(join(target, candidate))) return entry; // unverifiable — don't guess
    counter.n += 1;
    return candidate;
  });
}

/** Heals every renamed-dir entry across the three path-bearing config lists; returns rewrite count. */
function migrateConfigPaths(target, cfg) {
  const counter = { n: 0 };
  if (cfg.ledger) {
    for (const key of ['registration', 'important', 'irrelevant']) {
      if (cfg.ledger[key]) cfg.ledger[key] = healPathList(target, cfg.ledger[key], counter);
    }
  }
  if (cfg.l5) cfg.l5.highRiskPaths = healPathList(target, cfg.l5.highRiskPaths, counter);
  if (cfg.qa) cfg.qa.criticalPaths = healPathList(target, cfg.qa.criticalPaths, counter);
  return counter.n;
}

/** Creates config.json (level + first-run flag) or updates the level, preserving a finished setup. */
async function writeConfig(target, tplDir, level, args, report) {
  const cfgPath = join(target, 'contextkit', 'config.json');
  const preset = args.preset && listPresets().includes(args.preset) ? args.preset : null;
  if (args.preset && !preset) report.push(`⚠️  unknown --preset "${args.preset}" (have: ${listPresets().join(', ')}) — ignored`);
  if (existsSync(cfgPath)) {
    try {
      let cfg = JSON.parse(await read(cfgPath));
      cfg.level = level;
      if (cfg.setup?.completed !== true) cfg.setup = { completed: false, installedAt: new Date().toISOString() };
      const healed = migrateConfigPaths(target, cfg);
      // Additively merge any new default config sections introduced in this kit version.
      // Never clobbers user values — migrateConfigSections is strictly additive [ADR-0037].
      const { cfg: withDefaults, added } = migrateConfigSections(cfg, DEFAULT_CONFIG);
      cfg = withDefaults;
      if (preset) cfg = applyPreset(cfg, preset);
      await overwrite(cfgPath, JSON.stringify(cfg, null, 2) + '\n');
      report.push(`✓ updated contextkit/config.json level → ${level}${preset ? ` (+preset ${preset})` : ''}`);
      if (added.length) report.push(`✓ added ${added.length} new config section(s) on update: ${added.join(', ')}`);
      if (healed > 0) report.push(`✓ migrated ${healed} config path(s) onto ${PLATFORM_DIR}/ (renamed platform dir)`);
    } catch {
      /* leave malformed file for the user */
    }
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
  await syncContextReadme(target, tplDir, ctx, report);
  await writeConfig(target, tplDir, ctx.level, ctx.args, report);
  await seedDocs(target, tplDir, ctx.name, report);
}
