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
import { applyPreset, listPresets } from '../../templates/contextkit/runtime/config/presets.mjs';
import { reindexDocs } from '../../templates/contextkit/tools/scripts/docs-reindex.mjs';

// Memory/substrate files seeded write-if-missing so the user's edits survive a re-install.
const MEMORY_SEEDS = [
  'memory/SESSIONS.md', 'memory/WORKSPACE.md', 'memory/GLOSSARY.md', 'memory/roadmap.md',
  'memory/DELIBERATIONS.md', 'memory/decisions/_TEMPLATE.md', 'memory/decisions/0000-record-architecture-decisions.md',
  'memory/deliberations/_TEMPLATE.md', 'memory/deliberations/.gitkeep', 'memory/business-rules/_TEMPLATE.md',
  'memory/predictions/.gitkeep', 'memory/project-map/.gitkeep', 'memory/sessions/.gitkeep', 'README.md', 'instrucoes.md', 'best-practices.md',
  'review-protocol.md', 'behaviors.md', 'behaviors-examples.md', 'CLAUDE.child.md.tpl', 'squads/README.md',
  'squads/_BRIEFING.md.tpl', 'policy/complexity-rubric.json', '.env.example',
];

/** Copies the engine (always overwrite — kit code) and stamps the version [ADR-0033]. */
async function copyEngine(target, tplDir, io, version, report) {
  await io.copyTree(join(tplDir, 'contextkit', 'runtime'), join(target, 'contextkit', 'runtime'));
  await io.copyTree(join(tplDir, 'contextkit', 'tools'), join(target, 'contextkit', 'tools'));
  // SessionStart compares this to a per-session "seen" marker and announces updates.
  await io.overwrite(join(target, 'contextkit', '.engine-version'), `${version}\n`);
  report.push('✓ engine installed (contextkit/runtime, contextkit/tools)');
}

/** Seeds memory, pipeline, workflows, detectors and starters (write-if-missing where user-owned). */
async function seedSubstrate(target, tplDir, io, force, report) {
  for (const rel of MEMORY_SEEDS) {
    const src = join(tplDir, 'contextkit', rel);
    if (!existsSync(src)) continue;
    if (await io.writeIfMissing(join(target, 'contextkit', rel), await io.read(src), force)) report.push(`✓ seeded contextkit/${rel}`);
  }
  for (const d of ['sessions', 'decisions', 'business-rules', 'predictions', 'deliberations', 'project-map']) {
    await io.ensureDir(join(target, 'contextkit', 'memory', d));
  }
  const pipeCount = await io.copyTreeIfMissing(join(tplDir, 'contextkit', 'pipeline'), join(target, 'contextkit', 'pipeline'));
  if (pipeCount > 0) report.push(`✓ seeded contextkit/pipeline (${pipeCount} file(s))`);
  for (const s of ['backlog', 'testing', 'conclusion']) await io.ensureDir(join(target, 'contextkit', 'pipeline', s));
  const wfCount = await io.copyTreeIfMissing(join(tplDir, 'contextkit', 'workflows'), join(target, 'contextkit', 'workflows'));
  if (wfCount > 0) report.push(`✓ seeded contextkit/workflows (${wfCount} file(s))`);
  const detCount = await io.copyTreeIfMissing(join(tplDir, 'contextkit', 'detectors'), join(target, 'contextkit', 'detectors'));
  if (detCount > 0) report.push(`✓ seeded contextkit/detectors (${detCount} file(s))`);
  // Curated-stack starters: always overwrite — pure templates, copied OUT by /aidevtool-from0.
  await io.copyTree(join(tplDir, 'contextkit', 'starters'), join(target, 'contextkit', 'starters'));
  report.push('✓ curated-stack starters installed (contextkit/starters)');
}

/** Creates config.json (level + first-run flag) or updates the level, preserving a finished setup. */
async function writeConfig(target, tplDir, io, level, args, report) {
  const cfgPath = join(target, 'contextkit', 'config.json');
  const preset = args.preset && listPresets().includes(args.preset) ? args.preset : null;
  if (args.preset && !preset) report.push(`⚠️  unknown --preset "${args.preset}" (have: ${listPresets().join(', ')}) — ignored`);
  if (existsSync(cfgPath)) {
    try {
      let cfg = JSON.parse(await io.read(cfgPath));
      cfg.level = level;
      if (cfg.setup?.completed !== true) cfg.setup = { completed: false, installedAt: new Date().toISOString() };
      if (preset) cfg = applyPreset(cfg, preset);
      await io.overwrite(cfgPath, JSON.stringify(cfg, null, 2) + '\n');
      report.push(`✓ updated contextkit/config.json level → ${level}${preset ? ` (+preset ${preset})` : ''}`);
    } catch {
      /* leave malformed file for the user */
    }
  } else {
    let cfg = JSON.parse(await io.read(join(tplDir, 'contextkit', 'config.json')));
    cfg.level = level;
    cfg.setup = { completed: false, installedAt: new Date().toISOString() };
    if (preset) cfg = applyPreset(cfg, preset);
    await io.overwrite(cfgPath, JSON.stringify(cfg, null, 2) + '\n');
    report.push(`✓ created contextkit/config.json (level ${level}, first-run pending${preset ? `, preset ${preset}` : ''})`);
  }
}

/** Renders the CHANGELOG if missing and (re)builds the Diátaxis docs spine [ADR-0030]. */
async function seedDocs(target, tplDir, io, name, report) {
  const changelogPath = join(target, 'docs', 'CHANGELOG.md');
  if (!existsSync(changelogPath)) {
    const clTpl = await io.read(join(tplDir, 'docs', 'CHANGELOG.md.tpl'));
    await io.overwrite(changelogPath, io.render(clTpl, { PROJECT_NAME: name, DATE: new Date().toISOString().slice(0, 10) }));
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
 * @param {object} io - fs helpers (read, overwrite, copyTree, copyTreeIfMissing, writeIfMissing, ensureDir, render)
 * @param {{name:string, level:number, version:string, args:object}} ctx - install context
 * @param {string[]} report - mutated with progress lines
 */
export async function installEngine(target, tplDir, io, ctx, report) {
  await copyEngine(target, tplDir, io, ctx.version, report);
  await seedSubstrate(target, tplDir, io, ctx.args.force, report);
  await writeConfig(target, tplDir, io, ctx.level, ctx.args, report);
  await seedDocs(target, tplDir, io, ctx.name, report);
}
