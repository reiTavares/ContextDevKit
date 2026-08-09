#!/usr/bin/env node
/**
 * claims-gate.mjs — COMP-001 fails-closed evidence-tier gate for public claims.
 *
 * Refuses any public claim that lacks traceable evidence and a snapshot date.
 * Default verdict is REFUSE; only a complete, evidenced claim reaches PUBLISHABLE.
 *
 * Tier rules (constitution §8 — refuse-by-default):
 *   proven | supported | measured — require evidenceIds.length >= 1 + snapshotDate.
 *   measured — additionally requires reps >= 3 (ADR-0080); absent reps → WARN only.
 *   blocked | misleading — never publishable; always refused.
 *   unknown tier — typed error; claim refused.
 *
 * CLI: node claims-gate.mjs <manifest.json>
 *      Exit 0 only when ALL claims are publishable; non-zero otherwise.
 *
 * Zero runtime deps — node:* only.
 * ADR-0080 / COMP-001 / card #354. ≤ 280 lines.
 */

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Closed set of valid tiers. */
const EVIDENCED_TIERS = new Set(['proven', 'supported', 'measured']);
const BANNED_TIERS = new Set(['blocked', 'misleading']);
const VALID_TIERS = new Set([...EVIDENCED_TIERS, ...BANNED_TIERS]);

/** ISO date pattern YYYY-MM-DD. */
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Minimum replications required for a `measured` claim (ADR-0080). */
const MEASURED_MIN_REPS = 3;

// ---------------------------------------------------------------------------
// Types (JSDoc only)
// ---------------------------------------------------------------------------

/**
 * @typedef {{ id: string, text: string, tier: string, evidenceIds: string[], snapshotDate: string, reps?: number }} Claim
 * @typedef {{ id: string, publishable: boolean, reasons: string[] }} Verdict
 * @typedef {{ ok: boolean, verdicts: Verdict[] }} GateResult
 */

// ---------------------------------------------------------------------------
// Pure evaluation helpers
// ---------------------------------------------------------------------------

/**
 * Normalises a raw claim object, filling in safe defaults so the evaluator
 * never crashes on malformed input (§8 "never throws on bad shape").
 *
 * @param {unknown} raw
 * @returns {Claim}
 */
function normaliseClaim(raw) {
  const obj = raw && typeof raw === 'object' ? raw : {};
  return {
    id: typeof obj.id === 'string' ? obj.id : '<unknown>',
    text: typeof obj.text === 'string' ? obj.text : '',
    tier: typeof obj.tier === 'string' ? obj.tier : '',
    evidenceIds: Array.isArray(obj.evidenceIds) ? obj.evidenceIds.filter((e) => typeof e === 'string' && e.length > 0) : [],
    snapshotDate: typeof obj.snapshotDate === 'string' ? obj.snapshotDate.trim() : '',
    reps: typeof obj.reps === 'number' ? obj.reps : undefined,
  };
}

/**
 * Evaluates one claim and returns its verdict.
 *
 * Never throws — all paths produce a Verdict (publishable=false on any doubt).
 * Constitution §8: the default state is REFUSE; only a fully-evidenced claim
 * exits as publishable.
 *
 * @param {unknown} rawClaim
 * @returns {Verdict}
 */
function evaluateClaim(rawClaim) {
  const claim = normaliseClaim(rawClaim);
  const reasons = [];

  // ── Unknown tier ──────────────────────────────────────────────────────────
  if (!VALID_TIERS.has(claim.tier)) {
    reasons.push(`Unknown tier "${claim.tier}" — must be one of: ${[...VALID_TIERS].join(', ')}.`);
    return { id: claim.id, publishable: false, reasons };
  }

  // ── Banned tiers (blocked | misleading) ───────────────────────────────────
  if (BANNED_TIERS.has(claim.tier)) {
    reasons.push(`Tier "${claim.tier}" is never publishable.`);
    return { id: claim.id, publishable: false, reasons };
  }

  // ── Evidenced tiers (proven | supported | measured) ───────────────────────

  // Rule 1: evidenceIds required.
  if (claim.evidenceIds.length === 0) {
    reasons.push('No evidenceIds supplied — at least one is required.');
  }

  // Rule 2: snapshotDate required and must match YYYY-MM-DD.
  if (!claim.snapshotDate || !DATE_RE.test(claim.snapshotDate)) {
    reasons.push(`Invalid or missing snapshotDate "${claim.snapshotDate}" — expected YYYY-MM-DD.`);
  }

  // Rule 3 (measured only): reps >= MEASURED_MIN_REPS (ADR-0080).
  if (claim.tier === 'measured') {
    if (claim.reps === undefined) {
      // reps absent → warn, but still block on evidence+date failures above.
      reasons.push(`WARN: "measured" claim missing reps field — ADR-0080 requires >= ${MEASURED_MIN_REPS} replications.`);
    } else if (claim.reps < MEASURED_MIN_REPS) {
      reasons.push(`"measured" claim has reps=${claim.reps} — ADR-0080 requires >= ${MEASURED_MIN_REPS}.`);
    }
  }

  // Publishable only when ALL hard rules pass.
  // For `measured` with absent reps: the WARN is recorded but does not block
  // if evidence+date are otherwise complete (still subject to the hard rules).
  const hardFailures = reasons.filter((r) => !r.startsWith('WARN:'));
  const publishable = hardFailures.length === 0;

  return { id: claim.id, publishable, reasons };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Evaluates an array of claims against the evidence-tier gate.
 *
 * Never throws — malformed items produce refused verdicts. Constitution §8:
 * the gate is fails-closed; ok=true only when every claim is publishable.
 *
 * @param {unknown[]} claims  array of claim objects (may be malformed)
 * @returns {GateResult}
 */
export function evaluateClaims(claims) {
  const safeItems = Array.isArray(claims) ? claims : [];
  const verdicts = safeItems.map(evaluateClaim);
  const ok = verdicts.length > 0 && verdicts.every((v) => v.publishable);
  return { ok, verdicts };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

/**
 * Reads a JSON manifest (stripping BOM), evaluates, prints a compact report,
 * and exits 0 only when all claims pass.
 *
 * @param {string[]} argv  process.argv slice (from index 2)
 * @returns {Promise<void>}
 */
async function main(argv) {
  const manifestPath = argv[0];
  if (!manifestPath) {
    process.stderr.write('Usage: node claims-gate.mjs <manifest.json>\n');
    process.exit(1);
  }

  let raw;
  try {
    const bytes = await readFile(resolve(process.cwd(), manifestPath), 'utf-8');
    // Strip BOM (constitution rule 4 — portable JSON.parse).
    const text = bytes.charCodeAt(0) === 0xfeff ? bytes.slice(1) : bytes;
    raw = JSON.parse(text);
  } catch (err) {
    process.stderr.write(`claims-gate: cannot read manifest — ${err.message}\n`);
    process.exit(2);
  }

  if (!Array.isArray(raw)) {
    process.stderr.write('claims-gate: manifest must be a JSON array of claims\n');
    process.exit(2);
  }

  const { ok, verdicts } = evaluateClaims(raw);

  const publishableCount = verdicts.filter((v) => v.publishable).length;
  const total = verdicts.length;

  process.stdout.write(`\nclaims-gate — ${publishableCount}/${total} publishable\n\n`);

  for (const v of verdicts) {
    const status = v.publishable ? 'PASS' : 'REFUSE';
    process.stdout.write(`  [${status}] ${v.id}\n`);
    for (const reason of v.reasons) {
      process.stdout.write(`         ${reason}\n`);
    }
  }

  process.stdout.write('\n');

  if (!ok) {
    process.stderr.write(`claims-gate: ${total - publishableCount} claim(s) refused — cannot publish\n`);
    process.exit(1);
  }

  process.stdout.write('claims-gate: all claims pass\n');
}

// Guard: run CLI only when invoked directly; library imports stay side-effect-free.
const isMain = (() => {
  try {
    const thisFile = fileURLToPath(import.meta.url);
    const invoked = resolve(process.argv[1] ?? '');
    return thisFile === invoked;
  } catch {
    return false;
  }
})();

if (isMain) {
  main(process.argv.slice(2)).catch((err) => {
    process.stderr.write(`claims-gate: unexpected error — ${err.message}\n`);
    process.exit(2);
  });
}
