/**
 * Business-driven methodology auto-adoption for install + `--update`
 * (BIZ-0001 / WF-0036; activates the design ADR-0125 shipped).
 *
 * WHY THIS EXISTS. v3.4.0 ships the methodology ENGINE active (guarded intake
 * gate + auto-classifier on every session), but the ADOPTION ARTIFACTS — the
 * `memory/business/` and `memory/operations/` roots and the Root Business
 * BIZ-0001 that governs intake — were created lazily (only when a developer ran
 * `work intake` / `/dev-start`). A fresh install therefore looked "incomplete":
 * the motor was on, but the casing was empty and silent. This module seeds the
 * casing so the methodology is adopted, not merely available.
 *
 * DESIGN (mirrors {@link maybeGenerateBaseline}):
 *   - Decision-before-action: only scaffolds BIZ-0001 when NO `BIZ-####` exists.
 *   - NO invented domain content (constitution §9): the scaffold is the project
 *     name + `[FILL: …]` placeholders + a refusal-by-default `business.json`
 *     (status 'draft'). The developer fills the real business case via one
 *     `work intake` step the installer announces loudly.
 *   - Idempotent + write-if-missing: never clobbers a BIZ-0001 the dev filled.
 *   - Fail-open: any error returns a structured skip, never throws (rule 2).
 *   - Opt-out: `config.methodology.autoSeed === false` disables it (active by
 *     default per the project owner's directive, but an escape hatch exists).
 *   - Reuse over rebuild: the canonical builders + validator + registry writer
 *     are imported, not reimplemented.
 *
 * @module seed-methodology
 */
import { readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { read, writeIfMissing, ensureDir } from './fs.mjs';
import { pathsFor } from '../../templates/contextkit/runtime/config/paths.mjs';
import { buildBusinessJson, buildBusinessPrompt } from '../../templates/contextkit/tools/scripts/business-templates.mjs';
import { validateBusiness } from '../../templates/contextkit/runtime/work/schema-business.mjs';
import { slugify } from '../../templates/contextkit/tools/scripts/work-io.mjs';
import { writeWorkContextRegistry } from '../../templates/contextkit/tools/scripts/registry/work-context.mjs';

/** @typedef {'seeded'|'already_adopted'|'disabled'|'deferred'|'failed'} MethodologyStatus */

/** Preflight statuses (ADR-0099) under which seeding user memory must NOT run. */
const DEFER_STATUSES = new Set(['DEFERRED_ACTIVE_SESSIONS', 'DEFERRED_SELF_UPDATE']);

/**
 * Rebuilds the work-context registry only when something changed or it is absent
 * — `writeFileAtomicSync` is write-ALWAYS, so an unconditional rebuild would churn
 * the file's mtime on a no-op `--update`. Best-effort; never throws.
 *
 * @param {string} target - project root.
 * @param {boolean} changed - true when this run wrote at least one file.
 * @returns {void}
 */
function rebuildRegistryIfNeeded(target, changed) {
  try {
    if (changed || !existsSync(pathsFor(target).workContextRegistry)) writeWorkContextRegistry(target);
  } catch { /* registry rebuild is best-effort */ }
}

/** Root README explaining a work-context root and the one adoption command. */
function rootReadme(kind, idPrefix) {
  const jsonName = kind === 'Business' ? 'business.json' : 'operation.json';
  const tail = kind === 'Business'
    ? '# then fill business-case.md / growth.md / investment-decision.md in BIZ-0001'
    : '# create an operation context:\nnode contextkit/tools/scripts/work.mjs operation "<title>" --apply';
  return [
    `# ${kind} work contexts (Business-driven methodology — BIZ-0001)`,
    '',
    `This folder is the **${kind} root**. Each subfolder is one \`${idPrefix}-####\``,
    `work context (with its \`${jsonName}\` + docs).`,
    '',
    'The methodology is **active** (the intake gate runs guarded every session and',
    'the classifier auto-runs on each request). To adopt or extend it:',
    '',
    '```',
    '# classify what you are about to do (read-only):',
    'node contextkit/tools/scripts/work.mjs intake "<your objective>"',
    tail,
    '```',
    '',
    '_In Claude Code use the `/work` slash command; `ctx`/`cdx` are the Antigravity/Codex runners._',
    '_Seeded by the installer; safe to edit — `--update` never overwrites your content._',
    '',
  ].join('\n');
}

/** Returns true when any `BIZ-####-*` context folder already exists. */
function hasBusinessContext(businessRoot) {
  try {
    return readdirSync(businessRoot).some((name) => /^BIZ-\d{4}-/.test(name));
  } catch {
    return false; // root absent → none yet
  }
}

/** Builds the BIZ-0001 scaffold files (refusal-by-default; placeholders only). */
function planRootBusiness(projectName) {
  let slug;
  try {
    slug = slugify(projectName);
  } catch {
    slug = 'root-business';
  }
  const business = buildBusinessJson({
    id: 'BIZ-0001',
    title: projectName,
    slug,
    kind: 'PLATFORM',
    strategicFacet: 'unknown',
    valueIntents: { primary: 'ENABLE', secondary: [] },
    status: 'draft',
  });
  const verdict = validateBusiness(business);
  if (!verdict.ok) throw new Error(`BIZ-0001 scaffold invalid — ${verdict.errors.join('; ')}`);
  return {
    dir: `BIZ-0001-${slug}`,
    files: [
      { name: 'business.json', content: `${JSON.stringify(business, null, 2)}\n` },
      { name: 'business-case.md', content: buildBusinessPrompt('business-case') },
      { name: 'growth.md', content: buildBusinessPrompt('growth') },
      { name: 'investment-decision.md', content: buildBusinessPrompt('investment-decision') },
    ],
  };
}

/**
 * Seeds the methodology adoption casing into a target project. Creates the
 * business/operations roots (with a README template), scaffolds the Root
 * Business BIZ-0001 when none exists, and rebuilds the work-context registry.
 *
 * @param {string} target - absolute path to the target project.
 * @param {{ name?: string, preflight?: {status?: string}, selfHost?: boolean }} [ctx] - install context.
 * @returns {Promise<{status: MethodologyStatus, note: string}>}
 */
export async function maybeSeedMethodology(target, ctx = {}) {
  try {
    // Update-safety parity with maybeGenerateBaseline (ADR-0099): never mutate user
    // memory mid-deferral. Today the install.mjs call sits ABOVE the preflight-return,
    // so a deferred --update never reaches here — this guard makes that safety
    // self-evident instead of positional, surviving any future reordering.
    if (ctx.selfHost === true || DEFER_STATUSES.has(ctx.preflight?.status)) {
      return { status: 'deferred', note: `methodology auto-seed: deferred (${ctx.preflight?.status || 'self-host'})` };
    }

    let cfg = {};
    try {
      cfg = JSON.parse(await read(join(target, 'contextkit', 'config.json')));
    } catch { /* absent or unparseable → treat as not-opted-out (safe: seed is additive + idempotent) */ }
    if (cfg?.methodology?.autoSeed === false) {
      return { status: 'disabled', note: 'methodology auto-seed: disabled via config (methodology.autoSeed=false)' };
    }

    const paths = pathsFor(target);
    const businessRoot = paths.business;
    const operationsRoot = paths.operations;
    await ensureDir(businessRoot);
    await ensureDir(operationsRoot);
    let wrote = 0;
    if (await writeIfMissing(join(businessRoot, 'README.md'), rootReadme('Business', 'BIZ'))) wrote += 1;
    if (await writeIfMissing(join(operationsRoot, 'README.md'), rootReadme('Operations', 'OP'))) wrote += 1;

    // Decision-before-action: only scaffold the Root Business when none exists.
    if (hasBusinessContext(businessRoot)) {
      rebuildRegistryIfNeeded(target, wrote > 0);
      return { status: 'already_adopted', note: 'methodology: Root Business already present — roots ensured' };
    }

    const projectName = ctx.name || 'Root Business';
    const plan = planRootBusiness(projectName);
    const bizDir = join(businessRoot, plan.dir);
    for (const file of plan.files) {
      if (await writeIfMissing(join(bizDir, file.name), file.content)) wrote += 1;
    }
    rebuildRegistryIfNeeded(target, wrote > 0);

    return {
      status: 'seeded',
      note: `✓ methodology adopted — scaffolded Root Business ${plan.dir} (${wrote} file(s), status: draft)`,
    };
  } catch (err) {
    return { status: 'failed', note: `methodology auto-seed skipped: ${err?.message ?? err}` };
  }
}
