/**
 * Self-check — CONFIG / TAXONOMY invariants.
 *
 * Owns the two checks that guard the configuration surface:
 *   - level taxonomy single-sourced + bounds (guards 024 / 025).
 *   - zod schema agreement (passthrough + level bounds + sections; 018).
 *     Skipped silently when zod is not installed (optional dep by design).
 *
 * Split out of the legacy `selfcheck-checks.mjs` (ADR-0016 H1 / task 037 —
 * by invariant category). The original `checkLevelsAndSchema` carried two
 * jobs (SRP-and `Levels AND Schema`) and is now `checkLevels` + `checkSchema`,
 * called in order by `runConfigChecks(rep, ctx)`.
 *
 * Every function takes the reporter `rep` ({ ok, bad }) plus only what it
 * needs. Entry point: `runConfigChecks(rep, ctx)` where `ctx = { RT, mods }`.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

/** Level taxonomy single-sourced + bounds + 7 labels. Guards 024/025. */
function checkLevels(rep, mods) {
  const { ok, bad } = rep;
  console.log('Checking level taxonomy...');
  const levels = mods['config/levels.mjs'];
  const load = mods['config/load.mjs'];
  if (levels) {
    levels.MAX_LEVEL === 7 && levels.isValidLevel(7) && !levels.isValidLevel(8) && !levels.isValidLevel(0)
      ? ok('levels: MAX_LEVEL 7 + isValidLevel bounds') : bad('levels bounds wrong');
    levels.clampLevel(99) === 7 && levels.clampLevel(-5) === 1 ? ok('levels: clampLevel clamps to range') : bad('clampLevel wrong');
    Object.keys(levels.LEVEL_LABELS).length === 7 ? ok('levels: 7 labels in the single table') : bad('LEVEL_LABELS count wrong');
  } else bad('config/levels.mjs not loaded');
  if (load?.getLevel) {
    const root = mkdtempSync(join(tmpdir(), 'contextkit-lv-'));
    try {
      mkdirSync(resolve(root, 'contextkit'), { recursive: true });
      writeFileSync(resolve(root, 'contextkit/config.json'), JSON.stringify({ level: 7 }));
      load.getLevel(root) === 7 ? ok('getLevel accepts L7') : bad('getLevel rejects L7');
      writeFileSync(resolve(root, 'contextkit/config.json'), JSON.stringify({ level: 8 }));
      load.getLevel(root) === 2 ? ok('getLevel rejects an out-of-range level (fallback 2)') : bad('getLevel did not reject L8');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }
}

/**
 * Zod schema agreement — passthrough keeps every section, level bounds match
 * the taxonomy. Skipped silently when zod is not installed (optional dep).
 * Guards 018.
 */
async function checkSchema(rep, mods, RT) {
  const { ok } = rep;
  const defaults = mods['config/defaults.mjs']?.DEFAULT_CONFIG;
  let zodAvailable = false;
  try {
    await import('zod');
    zodAvailable = true;
  } catch {
    /* optional dep */
  }
  if (!zodAvailable) {
    ok('schema validation skipped (zod not installed — optional dep by design)');
    return;
  }
  console.log('Checking config schema (zod)...');
  const { bad } = rep;
  const schema = await import('file://' + resolve(RT, 'config/schema.mjs').replaceAll('\\', '/'));
  const good = schema.validateConfig(defaults);
  good.ok && good.config.qa && good.config.pipeline
    ? ok('schema validates DEFAULT_CONFIG + passthrough keeps every section') : bad('schema rejected defaults / dropped sections');
  schema.validateConfig({ ...defaults, level: 7 }).ok ? ok('schema accepts level 7') : bad('schema rejects level 7');
  !schema.validateConfig({ ...defaults, level: 9 }).ok ? ok('schema rejects an out-of-range level') : bad('schema accepted level 9');
}

/** Runs every config/taxonomy check in order. `ctx` = { RT, mods }. */
export async function runConfigChecks(rep, { RT, mods }) {
  checkLevels(rep, mods);
  await checkSchema(rep, mods, RT);
}
