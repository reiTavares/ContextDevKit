/**
 * Integration test for the READ-ONLY workflow audit (WF0035, W3-T1).
 *
 * Builds synthetic legacy packs in a throwaway temp dir and exercises
 * `auditWorkflow` / `auditAll` from the templates source. Proves:
 *   - a CONSISTENT pack yields zero contradictions;
 *   - a pack whose frontmatter disagrees with its narrative is flagged WITH the
 *     disagreeing sources;
 *   - two `CONTINUATION-PROMPT-WAVE*.md` files are flagged as fragmented;
 *   - a NOT-APPLIED vs APPLIED disagreement is flagged;
 *   - a degenerate single-ADR pack is flagged;
 *   - a missing core file is detected and an unknown custom file is classified;
 *   - the audit NEVER writes — file contents AND mtimes are byte-identical
 *     before and after the run.
 *
 * Optionally points `auditAll` at the real workflows dir (read-only, bounded)
 * and asserts WF0019 is flagged for multiple continuation files.
 *
 * Standalone, zero deps beyond `node:*` + the shared reporter. Not registered
 * here — the orchestrator owns suite registration.
 */
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { reporter } from './it-helpers.mjs';
import { auditWorkflow, auditAll } from '../templates/contextkit/tools/scripts/workflow/audit.mjs';

const rep = reporter();
const root = mkdtempSync(join(tmpdir(), 'wf-audit-it-'));

/** Write a pack file, creating the pack dir on demand. */
function writePackFile(pack, name, body) {
  const dir = join(root, pack);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, name), body, 'utf-8');
}

/** Build a frontmatter + history index body. */
function indexBody({ number, slug, ship, history }) {
  const fm = [
    '---', `slug: ${slug}`, 'kind: feature', `number: ${number}`,
    'currentPhase: ship', 'intake: done', 'prd: done', 'spec: done',
    'adr: done', 'adr-ref: ADR-0042', 'roadmap: done', 'pipeline: done',
    `ship: ${ship}`, 'testing: pending', 'conclusion: pending', '---', '',
    `# Workflow - ${slug}`, '', '## History', '',
  ];
  return `${fm.join('\n')}${history.map((h) => `- ${h}`).join('\n')}\n`;
}

// --- Synthetic fixtures -----------------------------------------------------

// 1. CLEAN pack: ship done, narrative agrees, single continuation.
const clean = '0101-clean-pack';
writePackFile(clean, 'index.md', indexBody({
  number: '0101', slug: 'clean-pack', ship: 'done',
  history: ['2026-06-12 - ship done (ref: branch x); next phase: testing'],
}));
for (const f of ['prd.md', 'spec.md', 'decisions.md', 'tasks.md', 'memory.md']) writePackFile(clean, f, `# ${f}\nclean\n`);
writePackFile(clean, 'CONTINUATION-PROMPT.md', 'Single continuation, all good.\n');

// 2. CONTRADICTORY pack: ship pending but history+tasks say IMPLEMENTED; 2 continuations.
const contra = '0102-contradictory-pack';
writePackFile(contra, 'index.md', indexBody({
  number: '0102', slug: 'contradictory-pack', ship: 'pending',
  history: ['2026-06-15 - ship Wave 8 IMPLEMENTED on main; awaiting merge (Gate B)'],
}));
writePackFile(contra, 'prd.md', '# prd\n');
writePackFile(contra, 'spec.md', '# spec\n');
writePackFile(contra, 'decisions.md', '# decisions\nADR-0042\n');
writePackFile(contra, 'tasks.md', '# tasks\nship: all tasks IMPLEMENTED and DONE.\n');
writePackFile(contra, 'memory.md', '# memory\nWave 8 shipped.\n');
writePackFile(contra, 'CONTINUATION-PROMPT-WAVE7.md', 'wave7 continuation\n');
writePackFile(contra, 'CONTINUATION-PROMPT-WAVE8.md', 'wave8 continuation\n');
writePackFile(contra, 'weird-custom-notes.md', 'something nonstandard\n');

// 3. NOT-APPLIED vs APPLIED (Origem WF0016 genuine case), missing core file (no memory.md).
const applied = '0103-applied-pack';
writePackFile(applied, 'index.md', indexBody({
  number: '0103', slug: 'applied-pack', ship: 'pending',
  history: ['2026-06-15 - Wave 1 NOT APPLIED in production'],
}));
writePackFile(applied, 'prd.md', '# prd\n');
writePackFile(applied, 'spec.md', '# spec\n');
writePackFile(applied, 'decisions.md', '# decisions\n');
writePackFile(applied, 'tasks.md', '# tasks\nWave 1 APLICADA EM PRODUCAO.\n');
// memory.md intentionally absent → filesAbsent must report it.

// 4. DEGENERATE single-ADR pack: many phase refs collapse to one ADR.
const degen = '0104-degenerate-pack';
const degenFm = [
  '---', 'slug: degenerate-pack', 'number: 0104', 'currentPhase: conclusion',
  'intake: done', 'intake-ref: ADR-0072', 'prd: done', 'prd-ref: ADR-0072',
  'spec: done', 'spec-ref: ADR-0072', 'adr: done', 'adr-ref: ADR-0072',
  'roadmap: done', 'roadmap-ref: ADR-0072', 'pipeline: done', 'pipeline-ref: ADR-0072',
  'ship: done', 'ship-ref: ADR-0072', 'testing: done', 'conclusion: done',
  '---', '', '# Workflow - degenerate-pack', '', '## History', '',
  '- 2026-06-16 - conclusion done (ref: ADR-0072); workflow complete',
].join('\n');
writePackFile(degen, 'index.md', `${degenFm}\n`);
for (const f of ['prd.md', 'spec.md', 'decisions.md', 'tasks.md', 'memory.md']) writePackFile(degen, f, `# ${f}\n`);

// --- Read-only snapshot (content + mtime) before any audit ------------------

/** Snapshot every file in the temp tree: relpath → { content, mtimeMs }. */
function snapshot(dir) {
  const out = {};
  for (const pack of readdirSync(dir)) {
    const packDir = join(dir, pack);
    if (!statSync(packDir).isDirectory()) continue;
    for (const name of readdirSync(packDir)) {
      const file = join(packDir, name);
      out[`${pack}/${name}`] = { content: readFileSync(file, 'utf-8'), mtimeMs: statSync(file).mtimeMs };
    }
  }
  return out;
}
const before = snapshot(root);

// --- Run the audits ---------------------------------------------------------

const reports = auditAll(root);
const byId = Object.fromEntries(reports.map((r) => [r.slug, r]));

// 1. clean
const cleanReport = byId['clean-pack'];
cleanReport && cleanReport.contradictions.length === 0
  ? rep.ok('clean pack: zero contradictions') : rep.bad('clean pack should have no contradictions');
cleanReport && cleanReport.redundancies.length === 0
  ? rep.ok('clean pack: zero redundancies') : rep.bad(`clean pack should have no redundancies (got ${JSON.stringify(cleanReport && cleanReport.redundancies)})`);
cleanReport && cleanReport.continuationShape === 'single'
  ? rep.ok('clean pack: single continuation shape') : rep.bad('clean pack continuationShape should be single');
cleanReport && cleanReport.filesAbsent.length === 0
  ? rep.ok('clean pack: no missing core files') : rep.bad('clean pack should have all core files');

// 2. contradictory
const contraReport = byId['contradictory-pack'];
const statusContra = contraReport && contraReport.contradictions.find((c) => c.kind === 'status-contradiction');
statusContra ? rep.ok('contradictory pack: status-contradiction flagged') : rep.bad('contradictory pack should flag a status-contradiction');
statusContra && statusContra.sources.length >= 2 && statusContra.sources.some((s) => /frontmatter/.test(s.file)) && statusContra.sources.some((s) => /history|tasks/.test(s.file))
  ? rep.ok('status-contradiction lists disagreeing sources') : rep.bad('status-contradiction must list both disagreeing sources');
contraReport && contraReport.continuationShape === 'fragmented' && contraReport.redundancies.some((r) => r.kind === 'fragmented-continuation')
  ? rep.ok('contradictory pack: fragmented continuation flagged') : rep.bad('two continuation prompts should be flagged as fragmented');
contraReport && contraReport.classification['weird-custom-notes.md'] === 'unknown-custom'
  ? rep.ok('unknown custom file classified as unknown-custom') : rep.bad('weird-custom-notes.md should classify as unknown-custom');
contraReport && contraReport.classification['index.md'] === 'governance'
  ? rep.ok('index.md classified as governance') : rep.bad('index.md should classify as governance');

// 3. applied-state + missing core
const appliedReport = byId['applied-pack'];
appliedReport && appliedReport.contradictions.some((c) => c.kind === 'applied-state-contradiction')
  ? rep.ok('applied pack: NOT-APPLIED vs APPLIED flagged') : rep.bad('applied pack should flag an applied-state-contradiction');
appliedReport && appliedReport.filesAbsent.includes('memory.md')
  ? rep.ok('missing core file (memory.md) detected') : rep.bad('missing memory.md should appear in filesAbsent');

// 4. degenerate
const degenReport = byId['degenerate-pack'];
degenReport && degenReport.redundancies.some((r) => r.kind === 'degenerate-adr-ref')
  ? rep.ok('degenerate pack: degenerate-adr-ref flagged') : rep.bad('degenerate pack should flag degenerate-adr-ref');

// auditAll tolerance: a non-pack dir must not crash the run.
mkdirSync(join(root, 'not-a-workflow'));
writeFileSync(join(root, 'loose-file.txt'), 'ignored\n', 'utf-8');
Array.isArray(auditAll(root)) && auditAll(root).every((r) => /^\d{4}/.test(r.id) || r.skipped)
  ? rep.ok('auditAll ignores non-NNNN entries without throwing') : rep.bad('auditAll should tolerate non-pack entries');

// --- Read-only property: nothing changed ------------------------------------

const after = snapshot(root);
const beforeKeys = Object.keys(before);
let unchanged = beforeKeys.length === Object.keys(after).filter((k) => before[k]).length;
for (const key of beforeKeys) {
  const a = before[key];
  const b = after[key];
  if (!b || a.content !== b.content || a.mtimeMs !== b.mtimeMs) unchanged = false;
}
unchanged ? rep.ok('audit is READ-ONLY: content + mtime identical before/after')
  : rep.bad('audit mutated a file (content or mtime changed) — must be read-only');

// --- Optional: real workflows dir (read-only, bounded) ----------------------

const realRoot = join(process.cwd(), 'contextkit', 'memory', 'workflows');
const realWf0019 = join(realRoot, '0019-economic-autonomy-control-plane');
if (existsSync(realWf0019)) {
  let realReports;
  let threw = false;
  try { realReports = auditAll(realRoot); } catch { threw = true; }
  !threw && Array.isArray(realReports) && realReports.length > 0
    ? rep.ok(`auditAll over real workflows returned ${realReports.length} reports without throwing`)
    : rep.bad('auditAll over real workflows should return results without throwing');
  const wf0019 = (realReports || []).find((r) => r.slug === 'economic-autonomy-control-plane' && r.continuationShape === 'fragmented');
  wf0019 && wf0019.redundancies.some((r) => r.kind === 'fragmented-continuation')
    ? rep.ok('real WF0019 flagged for fragmented continuation') : rep.bad('real WF0019 should flag fragmented continuation');
} else {
  rep.ok('complete dogfood WF0019 absent — optional real-tree check skipped');
}

// --- Cleanup ----------------------------------------------------------------
rmSync(root, { recursive: true, force: true });
rep.finish('workflow-audit');
