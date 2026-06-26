/**
 * Architecture-debt gate — the `DebtRegistryAdapter` (WF-0057, ADR-0122,
 * decisions.md fork #5 / spec §22).
 *
 * ┌──────────────────────── DATA-OWNERSHIP BOUNDARY (fork #5) ────────────────┐
 * │ • FACTS + per-finding STATE  →  `tech-debt-findings.json` (the EXISTING    │
 * │     findings store). Keyed by the stable finding-id. There is NO second    │
 * │     store; this adapter EVOLVES that one file (envelope is a superset of   │
 * │     today's `{ fileCount, findings }`, W0-contracts §7).                   │
 * │ • LIFECYCLE TRANSITIONS  →  DevPipeline / `state.json` substrate. The      │
 * │     11-state machine (`debt-lifecycle.mjs`) only validates legality; the   │
 * │     pipeline owns owner/expiry/intentional-debt records. The lifecycle     │
 * │     STATE is projected onto each finding as `lifecycleState`.              │
 * │ • PROJECTION  →  `tech-debt-board.md` is render-ONLY, regenerated from the │
 * │     structured data. It is NEVER authored and NEVER the source of truth:   │
 * │     mutating the markdown cannot change a finding's state.                 │
 * └───────────────────────────────────────────────────────────────────────────┘
 *
 * This module is a THIN ADAPTER: the pure merge/projection logic
 * (`upsertFindings`, `toBoard`) takes the in-memory store; the only I/O boundary
 * (`readStore` / `writeStore`) reads/writes an INJECTED path — never a hardcoded
 * one (immutable rule #4: paths are injected, forward-slash, no `contextkit/`).
 *
 * Zero runtime deps, ESM, `node:`/relative imports only (immutable rule #1).
 * Fail-fast: lifecycle moves THROW via `transition` (constitution §8).
 */

import { readFileSync, writeFileSync, renameSync } from 'node:fs';
import { DebtState, transition, currentState } from './debt-lifecycle.mjs';

export { DebtState, DEBT_STATES, transition, isLegalTransition, currentState, LEGAL_TRANSITIONS }
  from './debt-lifecycle.mjs';

/** The store envelope version (W0-contracts §7/§30). */
const STORE_VERSION = '1.0.0';

/** An empty, valid store envelope (superset of the legacy `{ fileCount, findings }`). */
export function emptyStore() {
  return { gateVersion: STORE_VERSION, fileCount: 0, findings: [] };
}

/**
 * Strip a UTF-8 BOM before parsing (immutable rule #4) and tolerate a missing /
 * empty file by returning an empty store — a fresh project has no findings yet.
 *
 * @param {string} jsonPath  injected absolute path to `tech-debt-findings.json`.
 * @returns {{gateVersion?:string,fileCount:number,findings:Object[]}} the store.
 */
export function readStore(jsonPath) {
  let raw;
  try {
    raw = readFileSync(jsonPath, 'utf-8');
  } catch {
    return emptyStore(); // no store on disk yet → empty, never throw on the hot path
  }
  const text = raw.replace(/^﻿/, '').trim();
  if (text.length === 0) return emptyStore();
  const parsed = JSON.parse(text);
  return {
    gateVersion: parsed.gateVersion ?? STORE_VERSION,
    fileCount: typeof parsed.fileCount === 'number' ? parsed.fileCount : (parsed.findings || []).length,
    findings: Array.isArray(parsed.findings) ? parsed.findings : [],
    ...(parsed.outcome ? { outcome: parsed.outcome } : {}),
  };
}

/**
 * Atomically persist the structured store to the INJECTED path (tmp + rename, so
 * a crashed write never corrupts the canonical facts — constitution §8 atomic
 * apply). Returns the path written.
 *
 * @param {string} jsonPath  injected absolute path to `tech-debt-findings.json`.
 * @param {Object} store     the store to persist.
 * @returns {string} the path written.
 */
export function writeStore(jsonPath, store) {
  const serialized = JSON.stringify(store, null, 2) + '\n';
  const tmp = `${jsonPath}.tmp`;
  writeFileSync(tmp, serialized, 'utf-8');
  // rename is atomic on the same filesystem; fall back to a direct write on EXDEV.
  try {
    renameSync(tmp, jsonPath);
  } catch {
    writeFileSync(jsonPath, serialized, 'utf-8');
  }
  return jsonPath;
}

/**
 * Merge freshly-scanned findings into the existing store, PRESERVING the
 * lifecycle state of any finding already tracked (keyed by stable finding-id,
 * fork #5). A brand-new finding enters at CANDIDATE. The merge is pure — it does
 * not touch disk and returns a new store object.
 *
 * Canonical state lives in the structured data here, NEVER in the markdown board.
 *
 * @param {{findings:Object[]}} store    the existing store (from `readStore`).
 * @param {Object[]} findings            freshly-scanned Finding[] (must have `id`).
 * @param {number} [fileCount]           file count from the scan (defaults to store's).
 * @returns {{gateVersion:string,fileCount:number,findings:Object[]}} the merged store.
 * @throws {TypeError} when a finding lacks a stable `id`.
 */
export function upsertFindings(store, findings, fileCount) {
  const safeStore = store && Array.isArray(store.findings) ? store : emptyStore();
  if (!Array.isArray(findings)) {
    throw new TypeError('upsertFindings: findings must be an array');
  }
  const knownState = new Map();
  for (const existing of safeStore.findings) {
    if (existing && typeof existing.id === 'string') {
      knownState.set(existing.id, currentState(existing));
    }
  }
  const merged = findings.map((finding) => {
    if (!finding || typeof finding.id !== 'string' || finding.id.length === 0) {
      throw new TypeError('upsertFindings: every finding needs a stable string id');
    }
    const priorState = knownState.has(finding.id) ? knownState.get(finding.id) : DebtState.CANDIDATE;
    return { ...finding, lifecycleState: priorState };
  });
  return {
    gateVersion: safeStore.gateVersion ?? STORE_VERSION,
    fileCount: typeof fileCount === 'number' ? fileCount : safeStore.fileCount,
    findings: merged,
    ...(safeStore.outcome ? { outcome: safeStore.outcome } : {}),
  };
}

/**
 * Apply a lifecycle transition to one tracked finding (by id), returning a new
 * store. Fail-fast: an illegal move or an unknown id THROWS (constitution §8) —
 * the canonical state must never drift to a bogus value.
 *
 * @param {{findings:Object[]}} store  the store.
 * @param {string} findingId           the stable id of the finding to advance.
 * @param {string} toState             the target DebtState.
 * @returns {Object} a new store with that finding's state advanced.
 * @throws {RangeError} on an illegal transition or unknown finding id.
 */
export function advanceLifecycle(store, findingId, toState) {
  const idx = store.findings.findIndex((f) => f && f.id === findingId);
  if (idx === -1) throw new RangeError(`advanceLifecycle: no finding with id "${findingId}"`);
  const next = store.findings.slice();
  next[idx] = transition(store.findings[idx], toState);
  return { ...store, findings: next };
}

/**
 * Project the structured store into the render-only board markdown (fork #5).
 * Regenerated from data every time — never authored, never read back as state.
 * Grouped by lifecycle state so the board mirrors the canonical machine.
 *
 * @param {{fileCount:number,findings:Object[]}} store  the structured store.
 * @returns {string} the markdown board source.
 */
export function toBoard(store) {
  const findings = (store && store.findings) || [];
  const fileCount = (store && store.fileCount) || 0;
  const out = [
    '# Tech Debt Board',
    '',
    `> Auto-generated PROJECTION of \`tech-debt-findings.json\` — ${fileCount} file(s), ${findings.length} finding(s).`,
    '> Render-only (WF-0057 fork #5): the structured data is the source of truth; editing this file changes nothing.',
    '',
  ];
  if (findings.length === 0) {
    out.push('No tracked debt. Clean.');
    return out.join('\n') + '\n';
  }
  const byState = new Map();
  for (const stateName of Object.values(DebtState)) byState.set(stateName, []);
  for (const finding of findings) {
    byState.get(currentState(finding)).push(finding);
  }
  for (const [stateName, items] of byState) {
    if (items.length === 0) continue;
    out.push(`## ${stateName} (${items.length})`, '');
    for (const f of items) {
      const loc = `${f.path}${f.line ? `:${f.line}` : ''}`;
      out.push(`- \`${loc}\` — ${f.ruleId}: ${f.message || ''}`.trimEnd());
    }
    out.push('');
  }
  return out.join('\n') + '\n';
}
