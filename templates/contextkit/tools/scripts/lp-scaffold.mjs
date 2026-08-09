#!/usr/bin/env node
/**
 * Landing-page scaffolder (ADR-0050) — copies the componentized landing starter
 * into the project so the AI fills content tokens instead of hand-writing
 * markup (the token-economy mechanism: copy/structure split).
 *
 *   lp-scaffold.mjs [--dir lp] [--folds hero,problem,solution,proof,offer,faq,footer-cta] [--json]
 *
 * Zero-dep, write-if-missing (never clobbers user edits), ROOT = cwd.
 * Fold names map to sections/NN-<name>.html; default = all seven.
 */
import { cpSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PLATFORM_DIR } from '../../runtime/config/paths.mjs';

const ROOT = process.cwd();
const SELF_DIR = dirname(fileURLToPath(import.meta.url));
const ALL_FOLDS = ['hero', 'problem', 'solution', 'proof', 'offer', 'faq', 'footer-cta'];

/** Locates the installed starter (project copy first, kit checkout as fallback). */
function starterDir() {
  const candidates = [
    resolve(ROOT, PLATFORM_DIR, 'starters', 'landing'),
    resolve(SELF_DIR, '..', '..', 'starters', 'landing'),
  ];
  const found = candidates.find((dir) => existsSync(join(dir, 'shell.html')));
  if (!found) {
    console.error('✖ landing starter not found — expected at ' + candidates[0]);
    process.exit(1);
  }
  return found;
}

function parseArgs(argv) {
  const parsed = { dir: 'lp', folds: ALL_FOLDS, json: false };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--dir' && argv[i + 1]) parsed.dir = argv[(i += 1)];
    else if (argv[i] === '--folds' && argv[i + 1]) parsed.folds = argv[(i += 1)].split(',').map((f) => f.trim()).filter(Boolean);
    else if (argv[i] === '--json') parsed.json = true;
    else if (argv[i] === '--help' || argv[i] === '-h') {
      console.log('Usage: lp-scaffold.mjs [--dir lp] [--folds a,b,c] [--json]');
      process.exit(0);
    }
  }
  const unknown = parsed.folds.filter((f) => !ALL_FOLDS.includes(f));
  if (unknown.length) {
    console.error(`✖ unknown fold(s): ${unknown.join(', ')} — valid: ${ALL_FOLDS.join(', ')}`);
    process.exit(1);
  }
  return parsed;
}

/** Recursive copy that REFUSES to overwrite (rule 8: user edits are sacred). */
function copyIfMissing(srcDir, destDir, rel, written, skipped) {
  const src = join(srcDir, rel);
  const dest = join(destDir, rel);
  if (existsSync(dest)) {
    skipped.push(rel);
    return;
  }
  mkdirSync(dirname(dest), { recursive: true });
  cpSync(src, dest);
  written.push(rel);
}

function main() {
  const { dir, folds, json } = parseArgs(process.argv.slice(2));
  const src = starterDir();
  const dest = resolve(ROOT, dir);
  const written = [];
  const skipped = [];

  for (const file of ['shell.html', 'lp.config.json', 'README.md']) copyIfMissing(src, dest, file, written, skipped);
  for (const sub of ['content', 'partials', 'styles', 'js', 'legal', 'meta']) {
    for (const file of readdirSync(join(src, sub))) copyIfMissing(src, dest, join(sub, file), written, skipped);
  }
  for (const section of readdirSync(join(src, 'sections'))) {
    const foldName = section.replace(/^\d+-/, '').replace(/\.html$/, '');
    if (folds.includes(foldName)) copyIfMissing(src, dest, join('sections', section), written, skipped);
  }

  if (json) {
    console.log(JSON.stringify({ dir, folds, written, skipped }, null, 2));
    return;
  }
  console.log(`🏗️  Landing scaffold → ${dir}/ (${folds.length} fold(s): ${folds.join(', ')})`);
  for (const file of written) console.log(`  + ${file}`);
  if (skipped.length) console.log(`  (kept ${skipped.length} existing file(s) untouched)`);
  console.log('\nNext: fill lp/content/copy.json + content/legal.json, then run lp-build.mjs.');
}

main();
