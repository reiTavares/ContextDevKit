/**
 * READ-ONLY legacy consistency + redundancy audit for the universal wave
 * workflow engine (WF0035, spec §22 "Audit mode", ADR-0101 §11).
 *
 * Given a legacy/hybrid pack directory it scans the human Markdown breadcrumbs
 * (`index.md` frontmatter + History, `tasks.md`, `memory.md`,
 * `CONTINUATION-PROMPT*.md`) and reports — never resolves — the status
 * contradictions, status redundancy, and degenerate references that motivated
 * the engine (the WF0019 / WF0018 / WF0030-0031 patterns from the WAVE 0 audit).
 *
 * Hard contract (prompt §22.2): this module MUST report, never silently choose a
 * winner, and MUST NEVER mutate a workflow — there is no write path here. JSON
 * reads reuse the orchestrator-owned `readJsonSafe` so a malformed plan/state
 * can never throw the whole run.
 *
 * Heuristic stance: a contradiction is reported ONLY when two live status
 * signals genuinely disagree. An intentional historical snapshot (a spec frozen
 * at an earlier wave, a dated past History line) is NOT a contradiction — only
 * the CURRENT frontmatter phase verdict is weighed against present-tense
 * "IMPLEMENTED / APPLIED / DONE" claims in tasks/memory/continuation.
 *
 * Zero deps — `node:*` only (ADR-0001). Deterministic: no `Date.now()` /
 * `Math.random()`; output ordering is stable.
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { basename, join } from 'node:path';
import { readJsonSafe } from './io.mjs';

/** Core governance files a profile-bearing pack is expected to carry. */
const CORE_FILES = Object.freeze(['index.md', 'prd.md', 'spec.md', 'decisions.md', 'tasks.md', 'memory.md']);
/** The immutable ADR-0057 journey phases, in order. */
const PHASES = Object.freeze([
  'intake', 'prd', 'spec', 'adr', 'roadmap', 'pipeline', 'ship', 'testing', 'conclusion',
]);
/** Present-tense markers that assert a phase actually happened. */
const DONE_MARKERS = /\b(IMPLEMENTED|APLICAD[AO]|APPLIED|SHIPPED|MERGED|COMPLETE[D]?|DONE|CONCLU[ÍI]D[AO])\b/;
/** Markers asserting a phase did NOT happen / was reverted. */
const NOT_DONE_MARKERS = /\b(NOT APPLIED|N[ÃA]O APLICAD[AO]|NOT MERGED|PENDING|REVERTED|ROLLED BACK)\b/i;

/**
 * Read a UTF-8 text file, BOM-stripped, returning '' when absent or unreadable.
 * Defensive: an audit over a malformed pack must degrade, never throw.
 * @param {string} path
 * @returns {string}
 */
function readTextSafe(path) {
  try {
    return existsSync(path) ? readFileSync(path, 'utf-8').replace(/^﻿/, '') : '';
  } catch {
    return '';
  }
}

/**
 * Parse the leading `--- ... ---` YAML-ish frontmatter into a flat string map.
 * Only `key: value` scalar lines are read (the legacy index shape); nested
 * structures are ignored on purpose.
 * @param {string} text full file content
 * @returns {Record<string,string>}
 */
function parseFrontmatter(text) {
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  const fields = {};
  if (!match) return fields;
  for (const line of match[1].split(/\r?\n/)) {
    const pair = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (pair) fields[pair[1]] = pair[2].trim();
  }
  return fields;
}

/**
 * Extract the History bullet lines from an index body (everything after a
 * `## History` heading). Each entry keeps its raw text for source attribution.
 * @param {string} text index.md content
 * @returns {string[]}
 */
function historyLines(text) {
  const idx = text.search(/^##+\s+History/m);
  if (idx === -1) return [];
  return text.slice(idx).split(/\r?\n/)
    .filter((line) => /^\s*[-*]\s+/.test(line))
    .map((line) => line.replace(/^\s*[-*]\s+/, '').trim());
}

/**
 * Infer a coarse profile from the file population. `legacy` when the pack
 * predates registries (no workflow-plan.json); otherwise `inferred`.
 * @param {string[]} present filenames present in the pack
 * @returns {'legacy'|'inferred'}
 */
function inferProfile(present) {
  return present.includes('workflow-plan.json') ? 'inferred' : 'legacy';
}

/**
 * Bucket a single filename into one of the catalog buckets (prompt §22.2).
 * @param {string} name filename
 * @returns {'governance'|'execution-state'|'human-narrative'|'redundant'|'unknown-custom'}
 */
function classifyFile(name) {
  if (/^(index|prd|spec|decisions)\.md$/.test(name)) return 'governance';
  if (/^(workflow-plan|workflow-state)\.json$/.test(name)) return 'execution-state';
  if (/^(memory|tasks)\.md$/.test(name) || name === 'reports' || name === 'reviews') return 'human-narrative';
  if (/^(acceptance-matrix|risk-register|rollout-plan|benchmark-plan|measurement-dictionary)\.md$/.test(name)) return 'human-narrative';
  if (/CONTINUATION-PROMPT/i.test(name) || /-impl-spec\.md$/.test(name)) return 'human-narrative';
  if (name === '.gitkeep') return 'redundant';
  return 'unknown-custom';
}

/**
 * Locate every `CONTINUATION-PROMPT*.md` in the pack. More than one is the
 * "fragmented continuation" anti-pattern (WF0019 had WAVE6/7/8).
 * @param {string[]} present filenames present in the pack
 * @returns {string[]}
 */
function continuationFiles(present) {
  return present.filter((name) => /^CONTINUATION-PROMPT.*\.md$/i.test(name)).sort();
}

/**
 * Detect status contradictions across the pack's live signals. The frontmatter
 * verdict for each phase (`done`/`pending`) is compared against present-tense
 * claims in History, tasks.md, memory.md and any continuation prompt.
 * @param {object} ctx scan context
 * @returns {Array<{kind:string, sources:Array<{file:string,says:string}>, detail:string}>}
 */
function detectContradictions(ctx) {
  const { frontmatter, history, tasksText, memoryText, continuationText, slug, folderNumber } = ctx;
  const found = [];

  for (const phase of PHASES) {
    const verdict = (frontmatter[phase] || '').toLowerCase();
    if (verdict !== 'pending' && verdict !== '' ) continue; // only a NOT-done verdict can be contradicted
    if (verdict === '' && phase !== 'ship') continue; // be conservative: only weigh declared phases
    const claimSources = [];
    const phaseClaim = new RegExp(`\\b${phase}\\b[^\\n]*`, 'i');
    for (const [file, body] of [['index.md history', history.join('\n')], ['tasks.md', tasksText], ['memory.md', memoryText], ['CONTINUATION-PROMPT', continuationText]]) {
      for (const line of body.split(/\r?\n/)) {
        if (phaseClaim.test(line) && DONE_MARKERS.test(line) && !NOT_DONE_MARKERS.test(line)) {
          claimSources.push({ file, says: line.trim().slice(0, 160) });
          break;
        }
      }
    }
    if (claimSources.length > 0) {
      found.push({
        kind: 'status-contradiction',
        sources: [{ file: 'index.md frontmatter', says: `${phase}: ${verdict || '(unset)'}` }, ...claimSources],
        detail: `Frontmatter marks "${phase}" as ${verdict || 'unset'} but ${claimSources.length} narrative source(s) claim it is done/implemented.`,
      });
    }
  }

  // NOT-APPLIED vs APPLIED across tasks/memory (Origem WF0016 genuine case).
  const indexSaysNot = /NOT APPLIED|N[ÃA]O APLICAD/i.test(history.join('\n'));
  const othersSayApplied = /APLICAD[AO] EM PRODU|APPLIED|IMPLEMENTED/i.test(`${tasksText}\n${memoryText}`);
  if (indexSaysNot && othersSayApplied) {
    found.push({
      kind: 'applied-state-contradiction',
      sources: [{ file: 'index.md history', says: 'NOT APPLIED' }, { file: 'tasks.md/memory.md', says: 'APPLIED / IMPLEMENTED' }],
      detail: 'index history says NOT APPLIED while tasks/memory say applied — genuine apply-state disagreement.',
    });
  }

  // Folder number vs declared frontmatter number (WF0018 collision pattern).
  const declared = (frontmatter.number || '').replace(/^0+/, '') || frontmatter.number;
  if (folderNumber && frontmatter.number && declared !== (folderNumber.replace(/^0+/, '') || folderNumber)) {
    found.push({
      kind: 'number-mismatch',
      sources: [{ file: 'folder name', says: folderNumber }, { file: 'index.md frontmatter', says: `number: ${frontmatter.number}` }],
      detail: `Pack folder is "${folderNumber}-${slug}" but frontmatter declares number ${frontmatter.number}.`,
    });
  }

  return found;
}

/**
 * Detect redundancy: status duplicated across files, degenerate single-ADR
 * references, and fragmented continuation prompts.
 * @param {object} ctx scan context
 * @returns {Array<{kind:string, detail:string, refs?:string[]}>}
 */
function detectRedundancies(ctx) {
  const { continuations, frontmatter, tasksText, memoryText } = ctx;
  const out = [];

  if (continuations.length > 1) {
    out.push({
      kind: 'fragmented-continuation',
      detail: `${continuations.length} continuation prompts exist; the engine expects a single CONTINUATION-PROMPT.md.`,
      refs: continuations,
    });
  }

  // Degenerate ADR refs: MANY phase refs all collapse to one ADR (WF0030/0031).
  // A clean pack with a single ADR named only in `adr-ref` is NOT degenerate.
  const phaseAdrs = [];
  for (const phase of PHASES) {
    const adr = (frontmatter[`${phase}-ref`] || '').match(/ADR-\d{4}/);
    if (adr) phaseAdrs.push(adr[0]);
  }
  const distinctPhaseAdrs = new Set(phaseAdrs);
  if (phaseAdrs.length >= 3 && distinctPhaseAdrs.size === 1) {
    out.push({
      kind: 'degenerate-adr-ref',
      detail: `All ${phaseAdrs.length} phase references point at the single ADR ${phaseAdrs[0]} — possible sub-stack of one program.`,
      refs: [...distinctPhaseAdrs],
    });
  }

  // Status duplicated as a verdict in BOTH tasks.md and memory.md headers.
  const phaseWord = /\b(ship|testing|conclusion)\b[^\n]*\b(IMPLEMENTED|DONE|COMPLETE)\b/i;
  if (phaseWord.test(tasksText) && phaseWord.test(memoryText)) {
    out.push({
      kind: 'duplicated-status',
      detail: 'Execution status is asserted in both tasks.md and memory.md — it should be a single JSON projection.',
    });
  }

  return out;
}

/**
 * Audit a single legacy/hybrid workflow pack. Pure read: opens files, never
 * writes. Returns a structured, deterministic report.
 * @param {string} packDir absolute path to a `NNNN-slug` pack directory
 * @returns {{id:string, slug:string, profile:'legacy'|'inferred', filesPresent:string[], filesAbsent:string[], contradictions:object[], redundancies:object[], classification:Record<string,string>, continuationShape:string}}
 * @throws {TypeError} when packDir is not a readable directory
 */
export function auditWorkflow(packDir) {
  let entries;
  try {
    entries = readdirSync(packDir);
  } catch (cause) {
    throw new TypeError(`auditWorkflow: cannot read pack directory "${packDir}": ${cause.message}`);
  }
  const present = entries.slice().sort();
  const folder = basename(packDir);
  const folderMatch = folder.match(/^(\d{4})-(.+)$/);
  const folderNumber = folderMatch ? folderMatch[1] : '';
  const folderSlug = folderMatch ? folderMatch[2] : folder;

  const indexText = readTextSafe(join(packDir, 'index.md'));
  const frontmatter = parseFrontmatter(indexText);
  const history = historyLines(indexText);
  const tasksText = readTextSafe(join(packDir, 'tasks.md'));
  const memoryText = readTextSafe(join(packDir, 'memory.md'));
  const continuations = continuationFiles(present);
  const continuationText = continuations.map((name) => readTextSafe(join(packDir, name))).join('\n');
  // Touch JSON via the safe reader so a malformed plan never throws (read-only).
  readJsonSafe(join(packDir, 'workflow-plan.json'), null);

  const classification = {};
  for (const name of present) classification[name] = classifyFile(name);

  const slug = frontmatter.slug || folderSlug;
  const ctx = { frontmatter, history, tasksText, memoryText, continuationText, continuations, slug, folderNumber };

  const continuationShape = ['none', 'single'][continuations.length] || 'fragmented';
  return {
    id: frontmatter.number || folderNumber || folder,
    slug,
    profile: inferProfile(present),
    filesPresent: present,
    filesAbsent: CORE_FILES.filter((name) => !present.includes(name)),
    contradictions: detectContradictions(ctx),
    redundancies: detectRedundancies(ctx),
    classification,
    continuationShape,
  };
}

/**
 * Audit every `NNNN-*` pack under a workflows root. Tolerant: a pack that cannot
 * be audited is skipped with a noted reason rather than aborting the whole run.
 * Read-only over the entire tree.
 * @param {string} workflowsRoot absolute path to `contextkit/memory/workflows`
 * @returns {Array<object>} one report per pack (or a `{skipped, reason}` entry)
 * @throws {TypeError} when the root is not a readable directory
 */
export function auditAll(workflowsRoot) {
  let names;
  try {
    names = readdirSync(workflowsRoot);
  } catch (cause) {
    throw new TypeError(`auditAll: cannot read workflows root "${workflowsRoot}": ${cause.message}`);
  }
  const reports = [];
  for (const name of names.slice().sort()) {
    if (!/^\d{4}-/.test(name)) continue;
    const packDir = join(workflowsRoot, name);
    try {
      if (!statSync(packDir).isDirectory()) continue;
      reports.push(auditWorkflow(packDir));
    } catch (cause) {
      reports.push({ id: name, slug: name, skipped: true, reason: cause.message });
    }
  }
  return reports;
}
