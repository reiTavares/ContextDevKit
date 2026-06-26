/**
 * playbook-compile.mjs — Playbook selection + bounded section injection (WF0038, ADR-0107 §16/§17).
 *
 * Loads the Playbook Capability Registry, selects the playbooks applicable to a
 * request (by intent/context/path/risk/phase), then compiles a BOUNDED context
 * pack containing only the relevant `## ` sections — never the whole file, never
 * just a path (a path alone is not activation, §16). Enforces a token budget and
 * records selected playbooks, injected sections, token count, reasons and any
 * missing coverage.
 *
 * Pure given (classification, registry) + read-only section extraction from the
 * playbook source. Zero runtime dependencies. Fail-open: missing registry/source
 * yields an empty pack with a reason code, never throws.
 *
 * @module playbook-compile
 */
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join, basename } from 'node:path';
import { pathsFor } from '../config/paths.mjs';

/** ~4 chars/token heuristic — deterministic, no tokenizer dependency. */
const CHARS_PER_TOKEN = 4;

/**
 * Loads the playbook registry from policy/. Returns {playbooks:[]} on error.
 * @param {string} root project root
 * @returns {{ playbooks: object[] }}
 */
export function loadPlaybookRegistry(root) {
  try {
    const p = join(pathsFor(root).policy, 'playbook-registry.json');
    if (!existsSync(p)) return { playbooks: [] };
    const parsed = JSON.parse(readFileSync(p, 'utf-8').replace(/^﻿/, ''));
    return parsed && Array.isArray(parsed.playbooks) ? parsed : { playbooks: [] };
  } catch {
    return { playbooks: [] };
  }
}

/**
 * Scores a playbook's applicability to the classification + context. The booleans
 * are used by the eligibility gate so generic context/risk matches do not activate
 * every playbook in the registry.
 *
 * @param {object} pb playbook registry entry
 * @param {object} cls classification
 * @param {object} ctx { phase, paths }
 * @returns {{ score: number, reasons: string[], pathMatched: boolean, intentMatched: boolean, contextMatched: boolean, riskMatched: boolean, phaseMatched: boolean }}
 */
function scorePlaybook(pb, cls, ctx) {
  let score = 0; const reasons = [];
  const has = (arr, v) => Array.isArray(arr) && arr.includes(v);
  const contextMatched = has(pb.contexts, cls.primaryType);
  const intentMatched = has(pb.intents, cls.intent);
  const riskMatched = has(pb.riskTriggers, cls.risk);
  const phaseMatched = Boolean(ctx?.phase && has(pb.workflowPhases, ctx.phase));
  const pathMatched = pathMatch(pb.pathPatterns, ctx?.paths);
  if (pathMatched) { score += 6; reasons.push('path'); }
  if (intentMatched) { score += 4; reasons.push(`intent(${cls.intent})`); }
  if (contextMatched) { score += 2; reasons.push(`context(${cls.primaryType})`); }
  if (riskMatched) { score += 1; reasons.push(`risk(${cls.risk})`); }
  if (phaseMatched) { score += 1; reasons.push(`phase(${ctx.phase})`); }
  return { score, reasons, pathMatched, intentMatched, contextMatched, riskMatched, phaseMatched };
}

/** Substring-stem path match (mirrors request-agent-select). */
function pathMatch(patterns, paths) {
  if (!Array.isArray(patterns) || !Array.isArray(paths) || !paths.length) return false;
  return patterns.some((pat) => {
    const stem = String(pat).replace(/\*+/g, '').replace(/\/+$/, '');
    return stem && paths.some((f) => String(f).includes(stem));
  });
}

/**
 * True when a playbook should be eligible without a path hit. Intent and phase
 * matches are explicit enough; context/risk-only matches are advisory and stay
 * out of the injected playbook pack.
 */
function isEligiblePlaybook(s) {
  return s.intentMatched || s.phaseMatched || (s.contextMatched && s.riskMatched && (s.risk === 'high' || s.risk === 'critical'));
}

/**
 * Selects applicable playbooks, highest first. If any playbook owns an affected
 * path, path ownership is the activation boundary for that request.
 *
 * @param {object} classification result of classifyRequest()
 * @param {object} [ctx] { phase, paths, root }
 * @param {object} [registry] playbook registry (defaults to load via ctx.root)
 * @returns {{ selected: object[], reasonCodes: string[] }}
 */
export function selectPlaybooks(classification, ctx = {}, registry = null) {
  try {
    const cls = classification && typeof classification === 'object' ? classification : {};
    const reg = registry ?? loadPlaybookRegistry(ctx.root);
    const playbooks = Array.isArray(reg.playbooks) ? reg.playbooks : [];
    if (cls.complexity === 'trivial') return { selected: [], reasonCodes: ['trivial complexity — no playbook injection'] };
    const scored = playbooks
      .map((pb) => ({ pb, ...scorePlaybook(pb, cls, ctx) }))
      .filter((s) => s.score > 0);
    const pathBound = scored.some((s) => s.pathMatched);
    const eligible = scored
      .filter((s) => (pathBound ? s.pathMatched : isEligiblePlaybook({ ...s, risk: cls.risk })))
      .sort((a, b) => b.score - a.score || String(a.pb.id).localeCompare(String(b.pb.id)));
    return {
      selected: eligible.map((s) => s.pb),
      reasonCodes: eligible.map((s) => `${s.pb.id}: ${s.reasons.join(' ')}`),
    };
  } catch {
    return { selected: [], reasonCodes: ['fail-open: playbook selection degraded'] };
  }
}

/**
 * Resolves a playbook's source .md to an absolute path, trying the registry
 * `sourcePath` under the platform dir first, then a basename search under the
 * squads tree (path conventions vary by squad).
 *
 * @param {string} root project root
 * @param {object} pb playbook entry
 * @returns {string|null}
 */
function resolveSource(root, pb) {
  const paths = pathsFor(root);
  const sourcePath = String(pb.sourcePath ?? '');
  const candidates = [
    join(paths.playbooks, sourcePath),                          // workflows/playbooks/<sourcePath>
    join(paths.playbooks, basename(sourcePath)),                // workflows/playbooks/<file>
    join(paths.platform, sourcePath),                           // platform/<sourcePath>
  ];
  for (const c of candidates) if (c && existsSync(c)) return c;
  // Fallback: basename search one level under the playbooks dir (squads/ etc.).
  const base = basename(sourcePath || `${pb.id}.md`);
  try {
    for (const sub of readdirSync(paths.playbooks, { withFileTypes: true })) {
      if (!sub.isDirectory()) continue;
      const guess = join(paths.playbooks, sub.name, base);
      if (existsSync(guess)) return guess;
    }
  } catch { /* fall through */ }
  return null;
}

/**
 * Extracts the named `## ` sections from a markdown body. Returns the matched
 * section blocks (heading + content up to the next `## `).
 *
 * @param {string} md markdown content
 * @param {string[]} sectionNames required section headings
 * @returns {{ found: {name:string, text:string}[], missing: string[] }}
 */
export function extractSections(md, sectionNames) {
  const found = []; const missing = [];
  const names = Array.isArray(sectionNames) ? sectionNames : [];
  const lines = String(md ?? '').split(/\r?\n/);
  // Index every top-level "## " heading → its line range (up to the next "## ").
  const blocks = new Map();
  let current = null; let buf = [];
  const flush = () => { if (current !== null) blocks.set(current.toLowerCase(), buf.join('\n').trim()); };
  for (const line of lines) {
    const h = /^##\s+(.+?)\s*$/.exec(line);
    if (h && !line.startsWith('###')) { flush(); current = h[1].replace(/[^\w\s-]/g, '').trim(); buf = []; }
    else if (current !== null) buf.push(line);
  }
  flush();
  for (const name of names) {
    const key = String(name).replace(/[^\w\s-]/g, '').trim().toLowerCase();
    const body = blocks.get(key);
    if (typeof body === 'string') found.push({ name, text: `## ${name}\n${body}`.trim() });
    else missing.push(name);
  }
  return { found, missing };
}

/**
 * Compiles a bounded playbook context pack from the selected playbooks, injecting
 * only the required sections up to `maxTokens`. Never injects a whole file.
 *
 * @param {object[]} selected selected playbook entries
 * @param {object} opts { root, maxTokens }
 * @returns {{ playbooks: object[], injectedTokens: number, missingCoverage: object[], reasonCodes: string[] }}
 */
export function compilePlaybookContext(selected, opts = {}) {
  const root = opts.root;
  const maxTokens = Number(opts.maxTokens ?? 3000);
  const out = { playbooks: [], injectedTokens: 0, missingCoverage: [], reasonCodes: [] };
  try {
    for (const pb of (Array.isArray(selected) ? selected : [])) {
      const src = resolveSource(root, pb);
      if (!src) { out.missingCoverage.push({ id: pb.id, reason: 'source not found' }); continue; }
      const md = readFileSync(src, 'utf-8').replace(/^﻿/, '');
      const { found, missing } = extractSections(md, pb.requiredSections);
      const sections = [];
      for (const s of found) {
        const tok = Math.ceil(s.text.length / CHARS_PER_TOKEN);
        if (out.injectedTokens + tok > maxTokens) { out.reasonCodes.push(`budget reached at ${pb.id}/${s.name}`); break; }
        out.injectedTokens += tok;
        sections.push({ name: s.name, tokens: tok, text: s.text });
      }
      out.playbooks.push({ id: pb.id, sourcePath: pb.sourcePath, sections });
      if (missing.length) out.missingCoverage.push({ id: pb.id, missingSections: missing });
    }
    if (!out.playbooks.length) out.reasonCodes.push('no playbook sections compiled');
    return out;
  } catch {
    return { playbooks: [], injectedTokens: 0, missingCoverage: [], reasonCodes: ['fail-open: playbook compile degraded'] };
  }
}
