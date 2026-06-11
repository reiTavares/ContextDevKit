/**
 * Antigravity host installation — ContextDevKit's second native host [ADR-0036].
 *
 * Extracted from install.mjs when the Antigravity wiring pushed the installer past
 * the constitution's RED line (> 308). One cohesive unit: the `ctx.mjs` CLI runner
 * (`agy`), the target package.json script shortcuts, the `.agents` asset tree the
 * agy binary natively reads (skills/agents/playbooks/workflows) [ADR-0048], and
 * the `INSTRUCTIONS.md` boot context. The Claude Code host (settings, slash
 * commands, agents) stays in install.mjs.
 */
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { ANTIGRAVITY_DIR, ANTIGRAVITY_LEGACY_DIR } from '../../templates/contextkit/runtime/config/paths.mjs';
import { composeAgentHooks } from '../../templates/contextkit/runtime/config/agent-hooks-compose.mjs';
import { read, overwrite, copyTree, render } from './fs.mjs';

/**
 * Adds the `ctx` + `agy` script shortcuts to the target package.json when present.
 * Silent no-op when there is no package.json; never throws into the install flow.
 * @param {string} target - project root
 * @param {string[]} report - mutated with a progress line
 */
async function patchPackageScripts(target, report) {
  const pkgPath = join(target, 'package.json');
  if (!existsSync(pkgPath)) return;
  try {
    const pkg = JSON.parse(await read(pkgPath));
    if (!pkg.scripts) pkg.scripts = {};
    let modified = false;
    for (const key of ['ctx', 'agy']) {
      if (pkg.scripts[key] !== 'node ctx.mjs') {
        pkg.scripts[key] = 'node ctx.mjs';
        modified = true;
      }
    }
    if (modified) {
      await overwrite(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
      report.push('✓ package.json patched with "ctx" and "agy" script shortcuts');
    }
  } catch (err) {
    report.push(`⚠️  failed to patch package.json: ${err.message}`);
  }
}

/**
 * Renders INSTRUCTIONS.md (the Antigravity boot context) when missing; on a name
 * collision writes a side file to merge by hand. Never touched on `--update`.
 * @param {string} target - project root
 * @param {string} tplDir - templates dir
 * @param {{name:string, level:number, mode:string, args:object}} ctx - render context
 * @param {string[]} report - mutated with a progress line
 */
async function installInstructions(target, tplDir, ctx, report) {
  const instPath = join(target, 'INSTRUCTIONS.md');
  if (ctx.args.update && existsSync(instPath)) return; // leave the user's file untouched
  const instTpl = await read(join(tplDir, 'INSTRUCTIONS.md.tpl'));
  const instOut = render(instTpl, {
    PROJECT_NAME: ctx.name,
    DATE: new Date().toISOString().slice(0, 10),
    LEVEL: String(ctx.level),
    MODE: ctx.mode,
  });
  if (!existsSync(instPath) || ctx.args.force) {
    await overwrite(instPath, instOut);
    report.push('✓ INSTRUCTIONS.md created');
  } else {
    await overwrite(join(target, 'INSTRUCTIONS.contextdevkit.md'), instOut);
    report.push('⚠️  INSTRUCTIONS.md exists — wrote INSTRUCTIONS.contextdevkit.md to merge by hand');
  }
}

/**
 * Wires the agy lifecycle hooks into `.agents/hooks.json` for the level
 * [ADR-0049], preserving any user-owned hook groups. An unparsable existing
 * file is left untouched (refuse over clobber) with a warning.
 * @param {string} target - project root
 * @param {number} level - activation level 1–7
 * @param {string[]} report - mutated with a progress line
 */
async function wireAntigravityHooks(target, level, report) {
  const hooksPath = join(target, ANTIGRAVITY_DIR, 'hooks.json');
  let existing = null;
  if (existsSync(hooksPath)) {
    try {
      existing = JSON.parse((await read(hooksPath)).replace(/^\uFEFF/, ''));
    } catch {
      report.push(`⚠️  ${ANTIGRAVITY_DIR}/hooks.json is not valid JSON — left untouched, fix or delete it and re-run`);
      return;
    }
  }
  await overwrite(hooksPath, JSON.stringify(composeAgentHooks(existing, level), null, 2) + '\n');
  report.push(`✓ agy lifecycle hooks wired (${ANTIGRAVITY_DIR}/hooks.json, level ${level})`);
}

/**
 * Installs the full Antigravity host into the target (runner + assets + boot file).
 * Ordering-independent of the Claude Code steps — call once after the engine lands.
 * @param {string} target - project root
 * @param {string} tplDir - templates dir
 * @param {{name:string, level:number, mode:string, args:object}} ctx - install context
 * @param {string[]} report - mutated with progress lines
 */
export async function installAntigravityHost(target, tplDir, ctx, report) {
  // Central CLI runner (ctx.mjs): always overwrite — kit runner, not user-editable.
  await overwrite(join(target, 'ctx.mjs'), await read(join(tplDir, 'ctx.mjs')));
  report.push('✓ central CLI runner installed (ctx.mjs)');

  await patchPackageScripts(target, report);

  // Antigravity assets (skills/agents/playbooks/workflows): always overwrite.
  // `.agents/` is the directory the agy binary actually resolves [ADR-0048].
  await copyTree(join(tplDir, 'antigravity'), join(target, ANTIGRAVITY_DIR));
  report.push(`✓ Antigravity skills, agents, playbooks and workflows installed (${ANTIGRAVITY_DIR}/)`);

  // Pre-ADR-0048 installs used `.antigravity/` — a kit-owned, always-overwrite
  // tree (never user content), so removing the stale twin is safe and prevents
  // the two trees from drifting apart.
  const legacyTree = join(target, ANTIGRAVITY_LEGACY_DIR);
  if (existsSync(legacyTree)) {
    await rm(legacyTree, { recursive: true, force: true });
    report.push(`✓ legacy ${ANTIGRAVITY_LEGACY_DIR}/ tree removed (assets migrated to ${ANTIGRAVITY_DIR}/, ADR-0048)`);
  }

  await wireAntigravityHooks(target, ctx.level, report);

  await installInstructions(target, tplDir, ctx, report);
}
