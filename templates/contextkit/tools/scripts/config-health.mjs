#!/usr/bin/env node
/**
 * Config corruption detector + safe recovery — P0 hotfix 3.0.1 (ADR-0095 errata).
 *
 * Diagnoses installs already damaged by the v3.0.0 path-migration bug, where
 * legitimate path lists collapsed into duplicate bare `contextkit/` entries. It
 * NEVER invents values: the original strings (`src/`, `dist/`, …) are gone once
 * collapsed, so an ambiguous case is reported `manual_repair_required`, not
 * silently rewritten. Deterministic repair is offered ONLY when a healthy
 * `config.json.bak` exists (restore from backup), and even then it is dry-run by
 * default — `--repair` writes atomically after backing up the corrupted file.
 *
 * Run:  node contextkit/tools/scripts/config-health.mjs [--json] [--repair]
 */
import { existsSync, readFileSync, writeFileSync, renameSync, copyFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PLATFORM_DIR } from '../../runtime/config/paths.mjs';

/** The bare platform entry the buggy healer emitted (e.g. `contextkit/`). */
const BARE = `${PLATFORM_DIR}/`;
/** Path-bearing config lists, by dotted address. */
const PATH_LISTS = Object.freeze([
  'ledger.registration', 'ledger.important', 'ledger.irrelevant', 'l5.highRiskPaths', 'qa.criticalPaths',
]);

/** Diagnostic states (spec §5.5). */
export const CONFIG_HEALTH_STATES = Object.freeze({
  HEALTHY: 'healthy', SUSPECTED: 'suspected_corruption', REPAIRABLE: 'repairable',
  MANUAL: 'manual_repair_required', REPAIRED: 'repaired', SKIPPED: 'skipped',
});

/** Reads a dotted address (`a.b`) off an object, safely. */
function at(obj, dotted) {
  return dotted.split('.').reduce((acc, k) => (acc && typeof acc === 'object' ? acc[k] : undefined), obj);
}

/**
 * Detects the v3.0.0 collapse signature in a parsed config. Pure (no I/O).
 * A list is suspicious when it contains a bare `contextkit/` entry — the corrected
 * healer can never emit one — and corrupt when ≥2 collapse to the same bare value.
 *
 * @param {object} cfg parsed config.json
 * @returns {{ status: string, findings: object[], suspiciousCount: number }}
 */
export function detectConfigCorruption(cfg) {
  if (!cfg || typeof cfg !== 'object') return { status: CONFIG_HEALTH_STATES.SKIPPED, findings: [], suspiciousCount: 0 };
  const findings = [];
  let suspiciousCount = 0;
  for (const dotted of PATH_LISTS) {
    const list = at(cfg, dotted);
    if (!Array.isArray(list)) continue;
    const bare = list.filter((e) => e === BARE);
    if (bare.length === 0) continue;
    suspiciousCount += bare.length;
    findings.push({
      section: dotted,
      bareCount: bare.length,
      total: list.length,
      collapsed: bare.length >= 2,
      reason: bare.length >= 2
        ? `${bare.length} entries collapsed to bare "${BARE}" (original paths unrecoverable from config alone)`
        : `1 entry is a bare "${BARE}" — original path lost or a legitimate whole-dir entry`,
    });
  }
  if (findings.length === 0) return { status: CONFIG_HEALTH_STATES.HEALTHY, findings, suspiciousCount };
  // Any bare entry is a corruption signal; repairability (backup vs manual) is decided in planRepair.
  return { status: CONFIG_HEALTH_STATES.SUSPECTED, findings, suspiciousCount };
}

/**
 * Plans a deterministic recovery. The ONLY safe source is a healthy backup —
 * the collapsed strings cannot be reconstructed from the corrupted file. Returns
 * the recovery verdict + the config to write (when restorable). Pure.
 *
 * @param {object} corrupt parsed corrupted config
 * @param {object|null} backup parsed `config.json.bak` (or null when absent)
 * @returns {{ status: string, restored: object|null, method: string }}
 */
export function planRepair(corrupt, backup) {
  if (!backup || typeof backup !== 'object') {
    return { status: CONFIG_HEALTH_STATES.MANUAL, restored: null, method: 'no backup — restore the affected lists by hand (see findings)' };
  }
  const backupHealth = detectConfigCorruption(backup);
  if (backupHealth.status !== CONFIG_HEALTH_STATES.HEALTHY) {
    return { status: CONFIG_HEALTH_STATES.MANUAL, restored: null, method: 'config.json.bak is itself damaged — manual repair' };
  }
  // Restore only the path lists from backup; keep every other current value (level, setup, new sections).
  const restored = JSON.parse(JSON.stringify(corrupt));
  for (const dotted of PATH_LISTS) {
    const fromBackup = at(backup, dotted);
    if (fromBackup === undefined) continue;
    const [head, key] = dotted.split('.');
    if (!restored[head] || typeof restored[head] !== 'object') restored[head] = {};
    restored[head][key] = JSON.parse(JSON.stringify(fromBackup));
  }
  // Verify the restored config is actually clean before claiming it is repairable
  // (constitution §8 — never an assumed pass). A "healthy" backup that simply OMITS
  // the corrupted list(s) would leave them in place; that is a manual repair, not a fix.
  if (detectConfigCorruption(restored).status !== CONFIG_HEALTH_STATES.HEALTHY) {
    return { status: CONFIG_HEALTH_STATES.MANUAL, restored: null, method: 'config.json.bak does not supply a clean replacement for the corrupted list(s) — manual repair' };
  }
  return { status: CONFIG_HEALTH_STATES.REPAIRABLE, restored, method: 'restore path lists from healthy config.json.bak' };
}

/** Atomic JSON write (tmp + rename) so the config is never partially written. */
function atomicWriteJson(path, obj) {
  const tmp = `${path}.tmp-${process.pid}`;
  writeFileSync(tmp, JSON.stringify(obj, null, 2) + '\n', 'utf8');
  renameSync(tmp, path);
}

/**
 * End-to-end health run for a project root. Reads config + optional backup,
 * detects, and (only with --repair AND a deterministic plan) restores atomically
 * after copying the corrupted file to `config.json.corrupt`. Never throws.
 *
 * @param {string} root project root
 * @param {{ repair?: boolean }} [opts]
 * @returns {object} structured result (safe to JSON.stringify)
 */
export function runConfigHealth(root, opts = {}) {
  const cfgPath = resolve(root, 'contextkit', 'config.json');
  const bakPath = `${cfgPath}.bak`;
  const result = { schemaVersion: 'config-health/1', configPath: cfgPath, status: CONFIG_HEALTH_STATES.SKIPPED, findings: [], repair: null };
  let cfg;
  try {
    cfg = JSON.parse(readFileSync(cfgPath, 'utf8').replace(/^﻿/, ''));
  } catch {
    result.status = CONFIG_HEALTH_STATES.SKIPPED;
    result.note = 'config.json missing or invalid JSON — nothing to diagnose';
    return result;
  }
  const detected = detectConfigCorruption(cfg);
  result.status = detected.status;
  result.findings = detected.findings;
  result.suspiciousCount = detected.suspiciousCount;
  if (detected.status === CONFIG_HEALTH_STATES.HEALTHY) return result;

  let backup = null;
  try { backup = JSON.parse(readFileSync(bakPath, 'utf8').replace(/^﻿/, '')); } catch { /* no backup */ }
  const plan = planRepair(cfg, backup);
  result.repair = { plan: plan.status, method: plan.method, applied: false };

  if (opts.repair && plan.restored) {
    try {
      // Preserve evidence without clobbering a prior .corrupt capture.
      const evidence = existsSync(`${cfgPath}.corrupt`) ? `${cfgPath}.corrupt-${process.pid}` : `${cfgPath}.corrupt`;
      copyFileSync(cfgPath, evidence);
      atomicWriteJson(cfgPath, plan.restored);
      result.status = CONFIG_HEALTH_STATES.REPAIRED;
      result.repair.applied = true;
      result.repair.backupOfCorrupt = evidence;
    } catch (err) {
      result.repair.error = String(err?.message ?? err);
    }
  } else if (plan.status === CONFIG_HEALTH_STATES.REPAIRABLE) {
    result.status = CONFIG_HEALTH_STATES.REPAIRABLE; // restorable but dry-run (no --repair)
  } else {
    result.status = CONFIG_HEALTH_STATES.MANUAL;
  }
  return result;
}

/**
 * One-line doctor surface. Returns `{ ok, message, fix }`; doctor decides severity.
 * @param {object} result from runConfigHealth
 */
export function summarizeForDoctor(result) {
  const S = CONFIG_HEALTH_STATES;
  if (result.status === S.HEALTHY || result.status === S.SKIPPED) {
    return { ok: true, message: 'config.json shows no v3.0.0 path-collapse corruption', fix: null };
  }
  const sections = result.findings.map((f) => f.section).join(', ');
  const fix = result.status === S.REPAIRABLE
    ? 'run: node contextkit/tools/scripts/config-health.mjs --repair (restores from config.json.bak)'
    : 'manual: restore the affected list(s) in contextkit/config.json — originals are not in the file (see --json)';
  return { ok: false, message: `config.json path corruption (${result.status}) in: ${sections}`, fix };
}

// --- CLI -------------------------------------------------------------------
if (process.argv[1] && process.argv[1].endsWith('config-health.mjs')) {
  const repair = process.argv.includes('--repair') || process.argv.includes('--write');
  const out = runConfigHealth(process.cwd(), { repair });
  if (process.argv.includes('--json')) {
    process.stdout.write(JSON.stringify(out, null, 2) + '\n');
  } else {
    const s = summarizeForDoctor(out);
    console.log(`\n🩺 config-health: ${out.status}`);
    if (out.findings?.length) for (const f of out.findings) console.log(`  • ${f.section}: ${f.reason}`);
    if (out.repair) console.log(`  repair: ${out.repair.applied ? 'APPLIED' : 'available'} — ${out.repair.method}`);
    console.log(`  ${s.ok ? '✅' : '→ ' + s.fix}\n`);
  }
  process.exit(out.status === CONFIG_HEALTH_STATES.HEALTHY || out.status === CONFIG_HEALTH_STATES.REPAIRED || out.status === CONFIG_HEALTH_STATES.SKIPPED ? 0 : 1);
}
