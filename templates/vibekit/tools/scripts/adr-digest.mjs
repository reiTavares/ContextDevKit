#!/usr/bin/env node
/**
 * ADR digest — compact catalog of Architecture Decision Records. [ADR-0027]
 *
 * Replaces "read 3–5 ADRs to find the relevant one" (~110 lines each) with a
 * ~1-line-per-ADR catalog (number · status · title · one-line decision), with an
 * optional keyword filter. Read the catalog, then open at most ONE full ADR.
 * Read-only, zero third-party deps. Parsing is single-sourced in `adr-digest-core.mjs`.
 *
 * Usage:
 *   node vibekit/tools/scripts/adr-digest.mjs                 # full catalog (human)
 *   node vibekit/tools/scripts/adr-digest.mjs --search token  # only matching ADRs
 *   node vibekit/tools/scripts/adr-digest.mjs --last 5        # the 5 most recent
 *   node vibekit/tools/scripts/adr-digest.mjs --json
 */
import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathsFor } from '../../runtime/config/paths.mjs';
import { ADR_FILENAME_RE, parseAdr, renderCatalogLine } from './adr-digest-core.mjs';

const ROOT = process.cwd();
const P = pathsFor(ROOT);
const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const opt = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};

const readSafe = (abs) => readFile(abs, 'utf-8').catch(() => null);

/** ADR filenames (excluding `_TEMPLATE.md`), newest first (zero-padded numeric sort). */
async function listAdrFiles() {
  let files = [];
  try {
    files = await readdir(P.decisions);
  } catch {
    return [];
  }
  return files.filter((f) => ADR_FILENAME_RE.test(f) && f !== '_TEMPLATE.md').sort().reverse();
}

async function main() {
  const search = opt('--search');
  const limit = Number.parseInt(opt('--last') || '0', 10) || 0;

  const records = [];
  for (const name of await listAdrFiles()) {
    const text = await readSafe(resolve(P.decisions, name));
    if (text !== null) records.push(parseAdr(text, name));
  }

  let selected = records;
  if (search) {
    const query = search.toLowerCase();
    selected = records.filter((r) =>
      `${r.number} ${r.title} ${r.decision} ${r.status} ${r.slug}`.toLowerCase().includes(query),
    );
  }
  if (limit > 0) selected = selected.slice(0, limit);

  if (flag('--json')) {
    process.stdout.write(JSON.stringify({ count: selected.length, adrs: selected }, null, 2) + '\n');
    return;
  }
  if (selected.length === 0) {
    console.log(search ? `No ADRs match "${search}".` : 'No ADRs found (vibekit/memory/decisions/).');
    return;
  }
  console.log(`\n🏛️  ADR catalog — ${selected.length} decision(s)${search ? ` matching "${search}"` : ''}, newest first\n`);
  console.log(selected.map(renderCatalogLine).join('\n'));
  console.log('\nOpen a full ADR in vibekit/memory/decisions/ only when you need its full context.');
}

main().catch((err) => {
  console.error('❌ adr-digest failed:', err?.message ?? err);
  process.exit(1);
});
