#!/usr/bin/env node
/**
 * Refreshes generated documentation surfaces.
 *
 * This command is intentionally narrow: it updates the generated Diataxis
 * navigation under `docs/` and leaves human-owned README content alone. Installed
 * `contextkit/README.md` updates are handled by the installer through the
 * conflict-safe manifest sync path.
 */
import { reindexDocs } from './docs-reindex.mjs';

/**
 * Runs every generated-doc refresh that is safe outside the installer.
 * @param {string} root project root
 * @returns {{ok:boolean, docs: ReturnType<typeof reindexDocs>}} refresh report
 */
export function refreshDocs(root = process.cwd()) {
  return { ok: true, docs: reindexDocs(root) };
}

function printReport(report) {
  const docs = report.docs;
  console.log(`docs-refresh: ${docs.indexed} doc(s) indexed`);
  if (docs.seeded.length) console.log(`seeded: ${docs.seeded.join(', ')}`);
  if (!docs.indexWritten) console.log('docs/README.md is hand-written; left untouched');
  if (docs.unclassified.length) console.log(`unclassified: ${docs.unclassified.join(', ')}`);
}

if (process.argv[1]?.endsWith('docs-refresh.mjs')) {
  const report = refreshDocs(process.cwd());
  if (process.argv.includes('--json')) console.log(JSON.stringify(report, null, 2));
  else printReport(report);
}
