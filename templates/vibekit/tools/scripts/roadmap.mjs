#!/usr/bin/env node
/**
 * Roadmap helper — find / status / init for the product roadmap.
 *
 * The roadmap is prose managed by the `/roadmap` command; this gives that
 * command deterministic facts:
 *   - `find`   — scan the repo for an EXISTING roadmap/PRD/spec/vision doc to
 *                import (so we don't recreate one the project already has).
 *   - `status` — is `vibekit/memory/roadmap.md` defined (vs the placeholder)?
 *   - `init`   — create the seed roadmap.md if missing.
 *
 * Usage:  node vibekit/tools/scripts/roadmap.mjs <find|status|init> [--json]
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const ROOT = process.cwd();
const CANON = resolve(ROOT, 'vibekit/memory/roadmap.md');
const PLACEHOLDER = 'ROADMAP-NOT-DEFINED';
const SKIP = new Set(['node_modules', '.git', 'dist', 'build', 'out', '.next', '.turbo', 'vendor', 'target', '__pycache__', '.claude']);
const NAME_RE = /(road[\s_-]?map|^prd\b|product[\s_-]?spec|product[\s_-]?vision|^vision|^spec)\b/i;

function walk(dir, depth, acc) {
  if (depth > 3) return acc;
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return acc;
  }
  for (const e of entries) {
    if (e.isDirectory()) {
      if (!SKIP.has(e.name) && !e.name.startsWith('.tmp')) walk(join(dir, e.name), depth + 1, acc);
    } else if (/\.(md|markdown|txt)$/i.test(e.name)) {
      const rel = relative(ROOT, join(dir, e.name)).replaceAll('\\', '/');
      // Don't report our own canonical/seed file as a "found" external roadmap.
      if (rel === 'vibekit/memory/roadmap.md') continue;
      if (NAME_RE.test(e.name)) acc.push(rel);
    }
  }
  return acc;
}

function isDefined() {
  if (!existsSync(CANON)) return false;
  try {
    const t = readFileSync(CANON, 'utf-8');
    return !t.includes(PLACEHOLDER) && t.trim().length > 0;
  } catch {
    return false;
  }
}

const cmd = process.argv[2];
const json = process.argv.includes('--json');

if (cmd === 'find') {
  const found = walk(ROOT, 0, []);
  if (json) console.log(JSON.stringify({ canonicalDefined: isDefined(), found }, null, 2));
  else {
    console.log(isDefined() ? '✅ vibekit/memory/roadmap.md is defined.' : 'ℹ️  vibekit/memory/roadmap.md not defined yet.');
    if (found.length) {
      console.log('\nPossible existing roadmap/PRD/spec files to import:');
      for (const f of found) console.log(`  - ${f}`);
    } else {
      console.log('\nNo existing roadmap/PRD/spec found — propose one from analysis + user objectives.');
    }
  }
} else if (cmd === 'status') {
  if (json) console.log(JSON.stringify({ defined: isDefined(), path: 'vibekit/memory/roadmap.md' }));
  else console.log(isDefined() ? 'defined' : 'not-defined');
  process.exit(isDefined() ? 0 : 1);
} else if (cmd === 'init') {
  if (existsSync(CANON)) {
    console.log('roadmap.md already exists — leaving it untouched.');
  } else {
    mkdirSync(resolve(ROOT, 'vibekit/memory'), { recursive: true });
    writeFileSync(CANON, `# Product Roadmap\n\n<!-- ${PLACEHOLDER} -->\n_No roadmap defined yet._ Run \`/roadmap\`.\n`, 'utf-8');
    console.log('✅ seeded vibekit/memory/roadmap.md');
  }
} else {
  console.error('Usage: roadmap.mjs <find|status|init> [--json]');
  process.exit(1);
}
