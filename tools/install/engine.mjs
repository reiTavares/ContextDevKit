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
import {
  read,
  overwrite,
  atomicWrite,
  copyTree,
  copyTreeIfMissing,
  writeIfMissing,
  ensureDir,
  pruneTreeToSource,
  render,
} from './fs.mjs';
import { syncFile, syncTree } from './sync.mjs';
import { migrateDecisions } from './decisions-migrate.mjs';

// ADR-0103 activation go-live notice: Economy Runtime ships ON (advisory). Shown
// once when the `economy` config section is freshly created or distributed.
const ECONOMY_NOTICE =
  '📊 Economy Runtime is ON by default (advisory — it never blocks your work). ' +
  'Disable one module via contextkit/config.json → economy.<module>.enabled=false, ' +
  'or turn it all off with economy.enabled=false.';

// Deterministic methodology-plane contract tables (WF-0086 IN1, ADR-0148). Kit code,
// not user data: each is schema-coupled to the runtime module that reads it, so they
// ship always-overwrite in lockstep with the engine. Per-project tuning lives in
// `config.json`, never in these files.
const POLICY_TABLES = [
  'work-classification.json',
  'decision-intelligence.json',
  'host-projections.json',
];

// Memory/substrate files seeded write-if-missing so the user's edits survive a re-install.
const MEMORY_SEEDS = [
  'memory/SESSIONS.md', 'memory/WORKSPACE.md', 'memory/GLOSSARY.md', 'memory/roadmap.md',
  'memory/DELIBERATIONS.md', 'memory/decisions/_TEMPLATE.md', 'memory/decisions/0000-record-architecture-decisions.md',
  // BIZ-0001 / WF-0037 — new decision subtree (business/operation/legacy guides + ADR templates),
  // seeded write-if-missing so a fresh install gains them and user edits survive --update.
  'memory/decisions/business/README.md', 'memory/decisions/operations/README.md', 'memory/decisions/legacy/README.md',
  'memory/decisions/_templates/adr-business.template.md', 'memory/decisions/_templates/adr-operation.template.md',
  'memory/decisions/_templates/adr-routine-operation-governance.template.md',
  'memory/decisions/_templates/adr-emergency-governance.template.md',
  'memory/deliberations/_TEMPLATE.md', 'memory/deliberations/.gitkeep', 'memory/business-rules/_TEMPLATE.md',
  'memory/predictions/.gitkeep', 'memory/project-map/.gitkeep', 'memory/project-map/rules.example.json', 'memory/sessions/.gitkeep',
  'memory/workflows/.gitkeep', 'instrucoes.md', 'best-practices.md',
  'review-protocol.md', 'behaviors.md', 'behaviors-examples.md', 'CLAUDE.child.md.tpl', 'squads/README.md',
  'squads/_BRIEFING.md.tpl', 'policy/complexity-rubric.json', 'policy/routing-policy.json', 'policy/squads-registry.json',
  'policy/capability-registry.json', 'policy/agent-capability-registry.json', 'policy/playbook-registry.json', '.env.example',
];

/** Copies the engine (always overwrite — kit code). The version is NOT stamped
 *  here: `.engine-version` is written LAST, only on final success [ADR-0099 P0-06],
 *  via {@link stampEngineVersion}, so a crash mid-install leaves the prior version. */
async function copyEngine(target, tplDir, report) {
  let removedLegacyEntries = 0;
  for (const tree of ['runtime', 'tools', 'methodology', 'docs', 'mcp', 'mcp-server']) {
    const sourceTree = join(tplDir, 'contextkit', tree);
    const destinationTree = join(target, 'contextkit', tree);
    const pruned = await pruneTreeToSource(sourceTree, destinationTree, tree === 'mcp'
      ? { preserveRelativePaths: ['project-manifest.json'] }
      : {});
    removedLegacyEntries += pruned.removedFiles + pruned.removedDirectories;
    await copyTree(sourceTree, destinationTree);
  }
  // Domain Engineering contract tables (WF-0068, ADR-0128 §26): the deterministic
  // classifier's SINGLE SOURCE (`runtime/domain-engineering/policy-load.mjs`),
  // schema-coupled to the runtime that reads them — distributed always-overwrite in
  // lockstep with the engine, exactly like runtime/ code. Per-project calibration
  // lives in `config.json → domainEngineering.*` (thresholds + enforcement), NEVER
  // by editing these tables, so overwriting them never loses user tuning. These
  // subtrees were the known WF-0068 distribution gap. The flat policy registries the
  // user EXTENDS (routing/squads/capability) stay seeded write-if-missing + additive
  // (MEMORY_SEEDS + policy-migrate); these deterministic tables are kit code.
  for (const sub of ['domain-engineering', 'devteam', 'domain-artifacts']) {
    const sourceTree = join(tplDir, 'contextkit', 'policy', sub);
    const destinationTree = join(target, 'contextkit', 'policy', sub);
    const pruned = await pruneTreeToSource(sourceTree, destinationTree);
    removedLegacyEntries += pruned.removedFiles + pruned.removedDirectories;
    await copyTree(sourceTree, destinationTree);
  }
  // Methodology-plane contract tables: work-classification and decision-materiality
  // inputs plus host-projection ownership.
  // Same class as the domain-engineering tables above — deterministic kit data that
  // the runtime is schema-coupled to (`work/journey-verifier.mjs`,
  // `execution/work-classifier.mjs`, `execution/materiality-score.mjs`), tuned per
  // project through `config.json`, never by editing these files. They ship
  // always-overwrite in lockstep with the engine rather than seeded write-if-missing
  // like the flat registries a user EXTENDS. Undistributed, every reader silently
  // degraded to its embedded fallback on a fresh install.
  // Report what actually shipped, not what was intended: a table missing from the
  // source is SKIPPED and must say so. An unconditional "✓ … policy/a|b|c" line
  // would let a silent skip read as a successful install — the same §8 failure this
  // whole wave exists to fix, one layer up in the report instead of the copy.
  const copiedTables = [];
  const skippedTables = [];
  for (const table of POLICY_TABLES) {
    const src = join(tplDir, 'contextkit', 'policy', table);
    if (!existsSync(src)) { skippedTables.push(table); continue; }
    await overwrite(join(target, 'contextkit', 'policy', table), await read(src));
    copiedTables.push(table);
  }
  const tableReport = copiedTables.length ? `, policy/${copiedTables.join('|')}` : '';
  report.push(`✓ engine installed (contextkit/runtime, contextkit/tools, contextkit/methodology, contextkit/docs, contextkit/mcp, contextkit/mcp-server, policy/domain-engineering|devteam|domain-artifacts${tableReport})`);
  if (removedLegacyEntries > 0) {
    report.push(`engine cleanup removed ${removedLegacyEntries} obsolete kit-owned entr${removedLegacyEntries === 1 ? 'y' : 'ies'}`);
  }
  if (skippedTables.length) {
    report.push(`⚠ policy table(s) SKIPPED — absent from the kit source, their readers will fall back to embedded defaults: ${skippedTables.join(', ')}`);
  }
}

/**
 * Stamps `contextkit/.engine-version` — the FINAL write of a successful install/
 * update [ADR-0099 P0-06]. SessionStart compares this to a per-session "seen"
 * marker to announce updates. Called by the orchestrator only after engine,
 * hosts, config, conflicts, settings and the post-update steps have all landed.
 * @param {string} target project root
 * @param {string} version kit version to record
 */
export async function stampEngineVersion(target, version) {
  await overwrite(join(target, 'contextkit', '.engine-version'), `${version}\n`);
}

/** Seeds memory, pipeline and detectors (write-if-missing, user-owned); syncs workflows, overwrites starters. */
async function seedSubstrate(target, tplDir, ctx, report) {
  const force = ctx.args.force;
  for (const rel of MEMORY_SEEDS) {
    const src = join(tplDir, 'contextkit', rel);
    if (!existsSync(src)) continue;
    if (await writeIfMissing(join(target, 'contextkit', rel), await read(src), force)) report.push(`✓ seeded contextkit/${rel}`);
  }
  for (const d of ['sessions', 'decisions', 'business-rules', 'predictions', 'deliberations', 'project-map', 'business', 'operations', 'batches', 'workflows']) {
    await ensureDir(join(target, 'contextkit', 'memory', d));
  }
  // Workflow guides + playbooks: kit content the user may tune — 3-way sync so a
  // personalized playbook survives --update, while kit renames/edits still land [ADR-0054].
  const wf = await syncTree(join(tplDir, 'contextkit', 'workflows'), target, 'contextkit/workflows', ctx.sync);
  report.push(`✓ workflow guides + playbooks installed (contextkit/workflows)${wf.kept ? ` — kept ${wf.kept} personalized` : ''}`);
  // Trigger-driven skills (WF-0064/WF-0068, ADR-0128 §11): SKILL.md instruction
  // content the devteam policy references by relative body path (skills/<name>/SKILL.md).
  // Personalizable like agents/commands — 3-way sync so a tuned skill survives --update
  // while kit edits still land. This tree was part of the WF-0068 distribution gap.
  const sk = await syncTree(join(tplDir, 'contextkit', 'skills'), target, 'contextkit/skills', ctx.sync);
  report.push(`✓ devteam skills installed (contextkit/skills)${sk.kept ? ` — kept ${sk.kept} personalized` : ''}`);
  const detCount = await copyTreeIfMissing(join(tplDir, 'contextkit', 'detectors'), join(target, 'contextkit', 'detectors'));
  if (detCount > 0) report.push(`✓ seeded contextkit/detectors (${detCount} file(s))`);
  // Curated-stack starters: always overwrite — pure templates, copied OUT by /aidevtool-from0.
  await pruneTreeToSource(join(tplDir, 'contextkit', 'starters'), join(target, 'contextkit', 'starters'));
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
 * Updates an existing v4 config.json: level, first-run flag, and additive section
 * merge. Writes atomically and only when content changes. Format conversion is
 * owned by the explicit v3-to-v4 migrator, never by a normal install/update.
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
  // Preserve an existing installedAt so a repeated --update is byte-idempotent
  // (P0-05): only stamp it the first time the marker is written, never re-churn it.
  if (cfg.setup?.completed !== true) {
    cfg.setup = { completed: false, installedAt: cfg.setup?.installedAt ?? new Date().toISOString() };
  }
  const { cfg: withDefaults, added } = migrateConfigSections(cfg, DEFAULT_CONFIG);
  cfg = withDefaults;
  if (preset) cfg = applyPreset(cfg, preset);
  const next = JSON.stringify(cfg, null, 2) + '\n';
  if (next === original) return; // no change — don't rewrite (idempotent)
  await atomicWrite(cfgPath, next);
  report.push(`✓ updated contextkit/config.json level → ${level}${preset ? ` (+preset ${preset})` : ''}`);
  if (added.length) report.push(`✓ added ${added.length} new config section(s) on update: ${added.join(', ')}`);
  if (added.includes('economy')) report.push(ECONOMY_NOTICE);
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
    report.push(ECONOMY_NOTICE);
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
  await copyEngine(target, tplDir, report);
  await seedSubstrate(target, tplDir, ctx, report);
  // Additively distribute new policy keys into existing stores (ADR-0097/CDK-082).
  // Idempotent + additive; runs after seeding so freshly-seeded stores are skipped.
  await migratePolicyStores(target, tplDir, { read, overwrite }, report);
  await syncContextReadme(target, tplDir, ctx, report);
  await writeConfig(target, tplDir, ctx.level, ctx.args, report);
  // Tidy loose top-level ADRs into owner folders / legacy (ADR-0123). Fail-open;
  // a fresh install with no loose ADRs is a no-op. Runs after the engine is copied.
  migrateDecisions(target, report);
  await seedDocs(target, tplDir, ctx.name, report);
}
