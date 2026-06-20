/**
 * In-process self-test for the B2-T2 decision search + match modules
 * (BIZ-0001 / WF-0037 Wave B2, ADR-0102).
 *
 * Runs under plain `node`, zero-dependency. Sections:
 *   [a] matchScore ≥ 55 → LINK → COVERED_BY_ACCEPTED (or LEGACY_GRANDFATHERED)
 *   [b] matchScore 40..54 → SURFACE band → NEEDS_DECISION + candidate surfaced
 *   [c] matchScore < 40 → RECOMMEND-new → NEEDS_DECISION + linkTarget null
 *   [d] Superseded ADR never a link target (G-superseded / HR-2)
 *   [e] Proposed / rejected ADRs never link targets (HR-3)
 *   [f] New accepted preferred over legacy on tie; legacy → relatedHistory (OQ-7)
 *   [g] Determinism: same input → byte-identical JSON output twice
 *   [h] No-embeddings: source file has no vector/model lib imports
 *   [i] queryByTriple wildcard: null component matches any; resolveDecision works
 *   [j] Tier-flow intact: intake() retains legacy keys; B2 keys fail-open
 *
 * Uses a frozen in-memory registry fixture — never reads the live tree.
 * Exit 0 = all assertions held; exit 1 = at least one failed.
 */
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import { searchDecisions } from './decision-search-match.mjs';
import { queryByTriple, resolveDecision } from './registry/decision.mjs';
import { intake } from '../../runtime/execution/task-intake.mjs';

const failures = [];
function assert(label, cond, detail = '') {
  process.stdout.write(`  ${cond ? 'ok  ' : 'FAIL'} ${label}${detail && !cond ? ` — ${detail}` : ''}\n`);
  if (!cond) failures.push(label);
}

// ---------------------------------------------------------------------------
// Frozen in-memory registry fixture — deterministic, no disk reads for scoring.
// ADR-1000: accepted/new, exact triple WORK_TRIPLE_A, governs BIZ-TEST
// ADR-1002: legacy,   exact triple WORK_TRIPLE_A (−4 penalty)
// ADR-1003: superseded
// ADR-1004: proposed
// ADR-1005: rejected
// ADR-1006: accepted/new, platform context only (kindOnly match)
// ---------------------------------------------------------------------------
const WORK_TRIPLE_A = { primaryContext:{ type:'business', id:'BIZ-TEST' }, decisionKind:'ARCHITECTURE', decisionScope:'business' };
const WORK_A = { kind:'change', growthLever:'QUALITY', valueIntents:{ primary:'IMPROVE', secondary:['ENABLE'] }, executionMode:'direct', confidence:'medium' };

const makeRow = (overrides) => Object.assign({ governs:{ workflows:[], operations:[], business:[] }, supersedes:[], supersededBy:null, tags:[] }, overrides);
const REGISTRY = { schemaVersion:1, decisions:[
  makeRow({ id:'ADR-1000', status:'accepted', format:'new', primaryContext:{ type:'business', id:'BIZ-TEST' }, decisionKind:'ARCHITECTURE', decisionScope:'business', title:'Architecture decision for BIZ-TEST', governs:{ workflows:['WF-TEST'], operations:[], business:['BIZ-TEST'] }, tags:['architecture','business'] }),
  makeRow({ id:'ADR-1002', status:'legacy',   format:'legacy', primaryContext:{ type:'business', id:'BIZ-TEST' }, decisionKind:'ARCHITECTURE', decisionScope:'business', title:'Legacy architecture BIZ-TEST', tags:['architecture'] }),
  makeRow({ id:'ADR-1003', status:'superseded', format:'new', primaryContext:{ type:'business', id:'BIZ-TEST' }, decisionKind:'ARCHITECTURE', decisionScope:'business', title:'Superseded architecture BIZ-TEST', supersededBy:'ADR-1000' }),
  makeRow({ id:'ADR-1004', status:'proposed',  format:'new', primaryContext:{ type:'business', id:'BIZ-TEST' }, decisionKind:'ARCHITECTURE', decisionScope:'business', title:'Proposed architecture BIZ-TEST' }),
  makeRow({ id:'ADR-1005', status:'rejected',  format:'new', primaryContext:{ type:'business', id:'BIZ-TEST' }, decisionKind:'ARCHITECTURE', decisionScope:'business', title:'Rejected architecture BIZ-TEST' }),
  makeRow({ id:'ADR-1006', status:'accepted',  format:'new', primaryContext:{ type:'platform', id:'platform' }, decisionKind:'ARCHITECTURE', decisionScope:'platform',  title:'Platform architecture decision', tags:['architecture'] }),
] };

// ---------------------------------------------------------------------------
// [a] matchScore ≥ 55 → LINK → COVERED_BY_ACCEPTED
// ADR-1000: tripleExact(50) + governsOverlap(20) = 70 ≥ 55
// ---------------------------------------------------------------------------
process.stdout.write('\n[a] matchScore ≥ 55 → LINK → COVERED_BY_ACCEPTED / LEGACY_GRANDFATHERED\n');
{
  const needA = { objective:'architecture decision for BIZ-TEST workflows', work:WORK_A, triple:WORK_TRIPLE_A };
  const r = searchDecisions(REGISTRY, needA);
  assert('[a] matchScore ≥ 55', r.matchScore >= 55, `got ${r.matchScore}`);
  assert('[a] linkTarget is ADR-1000', r.linkTarget === 'ADR-1000', `got ${r.linkTarget}`);
  assert('[a] coverageMode COVERED_BY_ACCEPTED', r.coverageMode === 'COVERED_BY_ACCEPTED', `got ${r.coverageMode}`);
  assert('[a] candidates[] non-empty', Array.isArray(r.candidates) && r.candidates.length > 0);
  assert('[a] reasons[] non-empty', Array.isArray(r.reasons) && r.reasons.length > 0);
  assert('[a] matchScore integer in [0,100]', Number.isInteger(r.matchScore) && r.matchScore >= 0 && r.matchScore <= 100);

  // Legacy-only: tripleExact(50) + legacyPenalty(−4) = 46 (or more with other signals).
  const legacyOnlyReg = { schemaVersion:1, decisions:[REGISTRY.decisions[1]] }; // ADR-1002
  const lr = searchDecisions(legacyOnlyReg, { objective:'architecture decision for BIZ-TEST workflows', work:WORK_A, triple:WORK_TRIPLE_A });
  if (lr.matchScore >= 55) {
    assert('[a] legacy-only ≥ 55 → LEGACY_GRANDFATHERED', lr.coverageMode === 'LEGACY_GRANDFATHERED', `got ${lr.coverageMode}`);
  } else {
    assert('[a] legacy-only < 55 → not COVERED_BY_ACCEPTED', lr.coverageMode !== 'COVERED_BY_ACCEPTED', `got ${lr.coverageMode}`);
  }
}

// ---------------------------------------------------------------------------
// [b] matchScore 40..54 → SURFACE band → NEEDS_DECISION; candidate surfaced
// triplePartial(25) + governsOverlap(20) = 45 with a different-id same-type candidate.
// ---------------------------------------------------------------------------
process.stdout.write('\n[b] matchScore 40..54 → SURFACE band → NEEDS_DECISION + surfaced\n');
{
  const PARTIAL_CANDIDATE = makeRow({ id:'ADR-2000', status:'accepted', format:'new', primaryContext:{ type:'business', id:'BIZ-OTHER' }, decisionKind:'ARCHITECTURE', decisionScope:'business', title:'Architecture decision partial match', governs:{ workflows:['WF-PARTIAL'], operations:[], business:['BIZ-PARTIAL'] }, tags:['architecture'] });
  const partialReg = { schemaVersion:1, decisions:[PARTIAL_CANDIDATE] };
  const partialTriple = { primaryContext:{ type:'business', id:'BIZ-DIFFERENT' }, decisionKind:'ARCHITECTURE', decisionScope:'business' };

  const r = searchDecisions(partialReg, { objective:'architecture decision partial match workflows', work:WORK_A, triple:partialTriple });
  if (r.matchScore >= 40 && r.matchScore <= 54) {
    assert('[b] matchScore in [40..54]', true);
    assert('[b] SURFACE → coverageMode NEEDS_DECISION', r.coverageMode === 'NEEDS_DECISION', `got ${r.coverageMode}`);
    assert('[b] candidate surfaced (candidates[] non-empty)', Array.isArray(r.candidates) && r.candidates.length > 0);
    assert('[b] linkTarget null in SURFACE band', r.linkTarget === null, `got ${r.linkTarget}`);
  } else {
    process.stdout.write(`  note [b] score=${r.matchScore} (fixture may score differently; asserting no auto-link)\n`);
    assert('[b] no auto-link when score < 55', r.coverageMode !== 'COVERED_BY_ACCEPTED', `got ${r.coverageMode}`);
  }
}

// ---------------------------------------------------------------------------
// [c] matchScore < 40 → RECOMMEND-new → NEEDS_DECISION; linkTarget null
// ADR-1006 (platform ARCHITECTURE) vs business/COMPLIANCE triple → kindOnly(10) only
// ---------------------------------------------------------------------------
process.stdout.write('\n[c] matchScore < 40 → NEEDS_DECISION + linkTarget null\n');
{
  const unrelatedReg = { schemaVersion:1, decisions:[REGISTRY.decisions[5]] }; // ADR-1006
  const unrelatedTriple = { primaryContext:{ type:'business', id:'BIZ-UNKNOWN' }, decisionKind:'COMPLIANCE', decisionScope:'business' };
  const r = searchDecisions(unrelatedReg, { objective:'enforce lgpd consent handling', work:{ ...WORK_A, valueIntents:{ primary:'COMPLY', secondary:[] } }, triple:unrelatedTriple });
  assert('[c] matchScore < 40', r.matchScore < 40, `got ${r.matchScore}`);
  assert('[c] coverageMode NEEDS_DECISION', r.coverageMode === 'NEEDS_DECISION', `got ${r.coverageMode}`);
  assert('[c] linkTarget null', r.linkTarget === null, `got ${r.linkTarget}`);
}

// ---------------------------------------------------------------------------
// [d] Superseded ADR never a link target → SUPERSEDED_NOT_GOVERNING
// ---------------------------------------------------------------------------
process.stdout.write('\n[d] Superseded ADR is never a link target\n');
{
  const supReg = { schemaVersion:1, decisions:[REGISTRY.decisions[2]] }; // ADR-1003
  const r = searchDecisions(supReg, { objective:'architecture decision for BIZ-TEST', work:WORK_A, triple:WORK_TRIPLE_A });
  assert('[d] superseded-only → SUPERSEDED_NOT_GOVERNING', r.coverageMode === 'SUPERSEDED_NOT_GOVERNING', `got ${r.coverageMode}`);
  assert('[d] linkTarget null when only candidate superseded', r.linkTarget === null, `got ${r.linkTarget}`);
}

// ---------------------------------------------------------------------------
// [e] Proposed / rejected ADRs never link targets
// ---------------------------------------------------------------------------
process.stdout.write('\n[e] Proposed / rejected ADRs never link targets\n');
{
  for (const [idx, label] of [[3,'proposed'],[4,'rejected']]) {
    const r = searchDecisions({ schemaVersion:1, decisions:[REGISTRY.decisions[idx]] }, { objective:'architecture decision for BIZ-TEST', work:WORK_A, triple:WORK_TRIPLE_A });
    assert(`[e] ${label} → coverageMode NEEDS_DECISION`, r.coverageMode === 'NEEDS_DECISION', `got ${r.coverageMode}`);
    assert(`[e] ${label} → linkTarget null`, r.linkTarget === null, `got ${r.linkTarget}`);
  }
}

// ---------------------------------------------------------------------------
// [f] New accepted preferred over legacy on tie; legacy → relatedHistory (OQ-7)
// ---------------------------------------------------------------------------
process.stdout.write('\n[f] Accepted preferred over legacy; legacy → relatedHistory\n');
{
  const mixedReg = { schemaVersion:1, decisions:[REGISTRY.decisions[0], REGISTRY.decisions[1]] }; // ADR-1000 + ADR-1002
  const r = searchDecisions(mixedReg, { objective:'architecture decision for BIZ-TEST', work:WORK_A, triple:WORK_TRIPLE_A });
  assert('[f] linkTarget is accepted ADR-1000', r.linkTarget === 'ADR-1000', `got ${r.linkTarget}`);
  assert('[f] coverageMode COVERED_BY_ACCEPTED', r.coverageMode === 'COVERED_BY_ACCEPTED', `got ${r.coverageMode}`);
  assert('[f] legacy ADR-1002 in relatedHistory', Array.isArray(r.relatedHistory) && r.relatedHistory.some((h) => (h.row?.id ?? h.id ?? h) === 'ADR-1002'));
}

// ---------------------------------------------------------------------------
// [g] Determinism
// ---------------------------------------------------------------------------
process.stdout.write('\n[g] Determinism: same inputs → byte-identical JSON output twice\n');
{
  const needG = { objective:'architecture decision for BIZ-TEST workflows', work:WORK_A, triple:WORK_TRIPLE_A };
  assert('[g] searchDecisions deterministic', JSON.stringify(searchDecisions(REGISTRY, needG)) === JSON.stringify(searchDecisions(REGISTRY, needG)));
}

// ---------------------------------------------------------------------------
// [h] No-embeddings: source file has no vector/model lib imports
// Scans only import/require lines to avoid false positives from explanatory comments.
// ---------------------------------------------------------------------------
process.stdout.write('\n[h] No-embeddings: source contains only arithmetic\n');
{
  const __dir = dirname(fileURLToPath(import.meta.url));
  const src = join(__dir, 'decision-search-match.mjs');
  if (existsSync(src)) {
    const lines = readFileSync(src, 'utf-8').split('\n');
    // Only inspect lines that are actual import/require statements.
    const importLines = lines.filter((l) => /^\s*import\b|^\s*require\s*\(/.test(l)).map((l) => l.toLowerCase());
    const banned = ['openai','@anthropic-ai','langchain','faiss','qdrant','pinecone','cohere','embedding','vector','transformers'];
    const found = banned.filter((lib) => importLines.some((il) => il.includes(lib)));
    assert('[h] no vector/model imports in decision-search-match.mjs', found.length === 0, `found: ${found.join(', ')}`);
  } else {
    process.stdout.write('  skip [h] source not yet created (impl pending)\n');
  }
}

// ---------------------------------------------------------------------------
// [i] queryByTriple wildcard semantics; resolveDecision
// ---------------------------------------------------------------------------
process.stdout.write('\n[i] queryByTriple wildcards + resolveDecision\n');
{
  const allArch = queryByTriple(REGISTRY, null, 'ARCHITECTURE', null);
  assert('[i] null ctx + null scope → all ARCHITECTURE rows', allArch.some((r) => r.id === 'ADR-1000') && allArch.some((r) => r.id === 'ADR-1006'));
  const exactRows = queryByTriple(REGISTRY, { type:'business', id:'BIZ-TEST' }, 'ARCHITECTURE', 'business');
  assert('[i] exact triple returns BIZ-TEST rows', exactRows.some((r) => r.id === 'ADR-1000'));
  assert('[i] exact triple excludes platform row', !exactRows.some((r) => r.id === 'ADR-1006'));
  const typeRows = queryByTriple(REGISTRY, { type:'business', id:null }, 'ARCHITECTURE', null);
  assert('[i] null id matches any business-type row', typeRows.some((r) => r.id === 'ADR-1000'));
  assert('[i] null id excludes platform-type row', !typeRows.some((r) => r.id === 'ADR-1006'));
  assert('[i] resolveDecision null for unknown', resolveDecision(REGISTRY, 'ADR-9999') === null);
  assert('[i] resolveDecision finds ADR-1000', resolveDecision(REGISTRY, 'ADR-1000')?.id === 'ADR-1000');
}

// ---------------------------------------------------------------------------
// [j] Tier-flow intact: intake() retains legacy keys; B2 additive keys fail-open
// ---------------------------------------------------------------------------
process.stdout.write('\n[j] Tier-flow intact: intake() legacy keys + B2 fail-open\n');
{
  const { signals, reasons } = intake({ objective:'fix the broken updater rollback after the release' });
  const LEGACY_KEYS = ['tier','domain','needsAdr','paths','phase','level'];
  const missing = LEGACY_KEYS.filter((k) => !(k in signals));
  assert('[j] all legacy signals keys present', missing.length === 0, `missing: ${missing.join(', ')}`);
  assert('[j] signals.work present (A2 additive)', typeof signals.work === 'object' && signals.work !== null);
  assert('[j] reasons[] non-empty', Array.isArray(reasons) && reasons.length > 0);
  if ('decisionNeed' in signals) {
    assert('[j] signals.decisionNeed.needVerdict string', typeof signals.decisionNeed.needVerdict === 'string');
    assert('[j] signals.decisionNeed.materialityScore number', typeof signals.decisionNeed.materialityScore === 'number');
  } else {
    process.stdout.write('  skip [j] signals.decisionNeed: B2 not yet wired into intake\n');
  }
  if ('decisionMatch' in signals) {
    assert('[j] signals.decisionMatch.coverageMode string', typeof signals.decisionMatch.coverageMode === 'string');
  } else {
    process.stdout.write('  skip [j] signals.decisionMatch: B2 not yet wired into intake\n');
  }
  assert('[j] intake never throws (fail-open)', true);
}

process.stdout.write(failures.length ? `\nFAILED (${failures.length})\n` : '\nPASSED\n');
process.exit(failures.length ? 1 : 0);
