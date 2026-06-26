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
import { generateReference } from './docs-generate.mjs';

/**
 * Runs every generated-doc refresh that is safe outside the installer:
 * first regenerate the feature-reference fact tables (ADR-0114) from the
 * registry, then re-index the Diátaxis navigation so the new pages are listed.
 * @param {string} root project root
 * @returns {{ok:boolean, reference: ReturnType<typeof generateReference>, docs: ReturnType<typeof reindexDocs>}} refresh report
 */
export function refreshDocs(root = process.cwd()) {
  const reference = generateReference(root, { write: true });
  return { ok: true, reference, docs: reindexDocs(root) };
}

function printReport(report) {
  const docs = report.docs;
  if (report.reference) {
    const changed = report.reference.files.filter((f) => f.changed).map((f) => f.path);
    console.log(`docs-refresh: reference ${changed.length ? 'regenerated (' + changed.join(', ') + ')' : 'in sync'} — commands=${report.reference.counts.commands} agents=${report.reference.counts.agents} hosts=${report.reference.counts.hosts}`);
  }
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
