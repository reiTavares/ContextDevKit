#!/usr/bin/env node
/**
 * /project-map — deterministic, stack-agnostic structural map of THIS project.
 *
 * Generates a durable, committed map under `<memory>/project-map/` that the
 * agent reads INSTEAD of re-exploring the tree every session — modules
 * classified frontend/backend/shared, file counts, a sampled symbol inventory,
 * the detected stack, and a `manifest.json` that powers the boot staleness
 * nudge. ZERO AI tokens: pure filesystem scan.
 *
 * Usage:
 *   node contextkit/tools/scripts/project-map.mjs            # (re)generate the map
 *   node contextkit/tools/scripts/project-map.mjs --check    # diff vs the saved signature
 *   node contextkit/tools/scripts/project-map.mjs --check --strict   # exit 1 if stale (CI)
 *
 * Single-sourced output path via `pathsFor` (rule 4). Best-effort; never throws
 * on a bad file — a refused scan reports, it does not crash the session.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathsFor } from '../../runtime/config/paths.mjs';
import { scanProject } from './project-map-core.mjs';
import { renderAll } from './project-map-render.mjs';

const ROOT = process.cwd();
const args = process.argv.slice(2);
const flag = (name) => args.includes(name);

/** Reads the saved manifest (signature + generatedAt), or null if never mapped. */
async function readManifest(dir) {
  try {
    return JSON.parse(await readFile(resolve(dir, 'manifest.json'), 'utf-8'));
  } catch {
    return null;
  }
}

/** Writes the three docs + the manifest atomically-enough (mkdir then write). */
async function generate(dir) {
  const model = scanProject(ROOT);
  await mkdir(dir, { recursive: true });
  const docs = renderAll(model);
  for (const [name, body] of Object.entries(docs)) {
    await writeFile(resolve(dir, name), body, 'utf-8');
  }
  const manifest = {
    name: model.name,
    generatedAt: model.generatedAt,
    signature: model.signature,
    fileCount: model.fileCount,
    modules: model.modules.map((m) => ({ path: m.path, role: m.role, files: m.files, bytes: m.bytes })),
  };
  await writeFile(resolve(dir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n', 'utf-8');
  console.log(`✅ Project map written to contextkit/memory/project-map/ (${model.modules.length} modules · ${model.fileCount} files).`);
  console.log('   Read 00-index.md first — it replaces re-greping the tree.');
}

/** Compares the current tree signature against the saved one. */
async function check(dir) {
  const saved = await readManifest(dir);
  if (!saved) {
    console.log('ℹ️  No project map yet. Run `/project-map` to generate one.');
    return 0;
  }
  const current = scanProject(ROOT).signature;
  if (current === saved.signature) {
    console.log(`✅ Project map is fresh (signature ${saved.signature}).`);
    return 0;
  }
  console.log(`⚠️  Project map is STALE — saved \`${saved.signature}\` vs current \`${current}\`.`);
  console.log('   Run `/project-map` to regenerate.');
  return flag('--strict') ? 1 : 0;
}

async function main() {
  const dir = pathsFor(ROOT).projectMap;
  if (flag('--check')) {
    process.exit(await check(dir));
  }
  await generate(dir);
}

main().catch((err) => {
  console.error('❌ project-map failed:', err?.message ?? err);
  process.exit(1);
});
