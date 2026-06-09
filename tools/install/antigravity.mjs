/**
 * Antigravity host installation — ContextDevKit's second native host [ADR-0036].
 *
 * Extracted from install.mjs when the Antigravity wiring pushed the installer past
 * the constitution's RED line (> 308). One cohesive unit: the `ctx.mjs` CLI runner
 * (`agy`), the target package.json script shortcuts, the `.antigravity` asset tree
 * (skills/agents/playbooks/workflows), and the `INSTRUCTIONS.md` boot context. The
 * Claude Code host (settings, slash commands, agents) stays in install.mjs.
 */
import { join } from 'node:path';
import { existsSync } from 'node:fs';

/**
 * Adds the `ctx` + `agy` script shortcuts to the target package.json when present.
 * Silent no-op when there is no package.json; never throws into the install flow.
 * @param {string} target - project root
 * @param {{read:Function, overwrite:Function}} io - fs helpers
 * @param {string[]} report - mutated with a progress line
 */
async function patchPackageScripts(target, io, report) {
  const pkgPath = join(target, 'package.json');
  if (!existsSync(pkgPath)) return;
  try {
    const pkg = JSON.parse(await io.read(pkgPath));
    if (!pkg.scripts) pkg.scripts = {};
    let modified = false;
    for (const key of ['ctx', 'agy']) {
      if (pkg.scripts[key] !== 'node ctx.mjs') {
        pkg.scripts[key] = 'node ctx.mjs';
        modified = true;
      }
    }
    if (modified) {
      await io.overwrite(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
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
 * @param {{read:Function, overwrite:Function, render:Function}} io - fs helpers
 * @param {{name:string, level:number, mode:string, args:object}} ctx - render context
 * @param {string[]} report - mutated with a progress line
 */
async function installInstructions(target, tplDir, io, ctx, report) {
  const instPath = join(target, 'INSTRUCTIONS.md');
  if (ctx.args.update && existsSync(instPath)) return; // leave the user's file untouched
  const instTpl = await io.read(join(tplDir, 'INSTRUCTIONS.md.tpl'));
  const instOut = io.render(instTpl, {
    PROJECT_NAME: ctx.name,
    DATE: new Date().toISOString().slice(0, 10),
    LEVEL: String(ctx.level),
    MODE: ctx.mode,
  });
  if (!existsSync(instPath) || ctx.args.force) {
    await io.overwrite(instPath, instOut);
    report.push('✓ INSTRUCTIONS.md created');
  } else {
    await io.overwrite(join(target, 'INSTRUCTIONS.contextdevkit.md'), instOut);
    report.push('⚠️  INSTRUCTIONS.md exists — wrote INSTRUCTIONS.contextdevkit.md to merge by hand');
  }
}

/**
 * Installs the full Antigravity host into the target (runner + assets + boot file).
 * Ordering-independent of the Claude Code steps — call once after the engine lands.
 * @param {string} target - project root
 * @param {string} tplDir - templates dir
 * @param {{read:Function, overwrite:Function, copyTree:Function, render:Function}} io - fs helpers
 * @param {{name:string, level:number, mode:string, args:object}} ctx - install context
 * @param {string[]} report - mutated with progress lines
 */
export async function installAntigravityHost(target, tplDir, io, ctx, report) {
  // Central CLI runner (ctx.mjs): always overwrite — kit runner, not user-editable.
  await io.overwrite(join(target, 'ctx.mjs'), await io.read(join(tplDir, 'ctx.mjs')));
  report.push('✓ central CLI runner installed (ctx.mjs)');

  await patchPackageScripts(target, io, report);

  // Antigravity assets (skills/agents/playbooks/workflows): always overwrite.
  await io.copyTree(join(tplDir, 'antigravity'), join(target, '.antigravity'));
  report.push('✓ Antigravity skills, agents, playbooks and workflows installed (.antigravity/)');

  await installInstructions(target, tplDir, io, ctx, report);
}
