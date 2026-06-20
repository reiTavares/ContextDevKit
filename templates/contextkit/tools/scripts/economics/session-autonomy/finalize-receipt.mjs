/**
 * finalize-receipt.mjs — Session Autonomy Receipt: fail-open finalization.
 *
 * The single entry point invoked at session finalization (spec §7). It collects
 * signals → builds the canonical receipt → signs → stores → renders, and is
 * ADVISORY + FAIL-OPEN: if any step throws, finalization still "succeeds" from
 * the caller's perspective and a machine-readable reason code is returned. It
 * NEVER throws to the caller (immutable rule 2). Deterministic: `generatedAt` is
 * injected by the caller. Zero deps beyond the receipt modules + node:* (none here).
 */

import { REASON_CODES } from './receipt-schema.mjs';
import { buildReceipt } from './receipt-build.mjs';
import { resolveSigningKey } from './receipt-integrity.mjs';
import { renderTerminal, renderMarkdown } from './receipt-render.mjs';
import {
  storeReceipt, upsertSessionAutonomySection, receiptPaths,
} from './receipt-store.mjs';

/** Reads the feature config block with safe defaults (absent → enabled). */
function receiptConfig(config) {
  const economy = (config && typeof config === 'object' && config.economy) || {};
  const block = (economy && typeof economy === 'object' && economy.sessionAutonomyReceipt) || {};
  return {
    enabled: block.enabled !== false && economy.enabled !== false,
    generateOnSessionFinalize: block.generateOnSessionFinalize !== false,
    showTerminalSummary: block.showTerminalSummary !== false,
    storeMarkdown: block.storeMarkdown !== false,
    storeJson: block.storeJson !== false,
    signReceipts: block.signReceipts !== false,
    minimumConfidenceToDisplay: typeof block.minimumConfidenceToDisplay === 'string' ? block.minimumConfidenceToDisplay : 'low',
    compact: block.compactTerminal === true,
  };
}

/**
 * Finalizes a session by producing (or refreshing) its autonomy receipt.
 *
 * @param {object} args
 * @param {string} args.sessionId
 * @param {string} args.sessionsDir — the flat `.claude/.sessions` directory.
 * @param {object} args.signals — collected session signals for buildReceipt().
 * @param {object} args.config — resolved ContextDevKit config.
 * @param {string} args.generatedAt — ISO timestamp (injected, deterministic).
 * @param {object} [args.env] — environment (for signing-key resolution).
 * @param {string} [args.sessionMarkdownPath] — the session log to upsert into.
 * @returns {{ ok: boolean, status: string, reason: string|null,
 *   receipt: object|null, terminal: string|null, written: string[] }}
 */
export function finalizeReceipt(args = {}) {
  const {
    sessionId = null, sessionsDir = null, signals = {}, config = {},
    generatedAt = null, env = (typeof process !== 'undefined' ? process.env : {}),
    sessionMarkdownPath = null,
  } = args;

  const cfg = receiptConfig(config);
  if (!cfg.enabled || !cfg.generateOnSessionFinalize) {
    return {
      ok: true, status: 'skipped', reason: REASON_CODES.FEATURE_DISABLED,
      receipt: null, terminal: null, written: [],
    };
  }

  let receipt = null;
  try {
    const signingKey = cfg.signReceipts ? resolveSigningKey(config, env) : { available: false };
    receipt = buildReceipt({ ...signals, sessionId, generatedAt, config, signingKey });
  } catch (err) {
    // Estimator/assembler failure must not break finalization (spec §7, §33-G).
    return {
      ok: true, status: 'failed', reason: REASON_CODES.ESTIMATOR_THREW,
      receipt: null, terminal: null, written: [],
      detail: typeof err?.message === 'string' ? err.message : 'estimator threw',
    };
  }

  const RANK = ['insufficient', 'low', 'medium', 'high'];
  const meetsMin = RANK.indexOf(receipt?.confidence?.level) >= RANK.indexOf(cfg.minimumConfidenceToDisplay);
  let terminal = null;
  try {
    terminal = (cfg.showTerminalSummary && meetsMin) ? renderTerminal(receipt, { compact: cfg.compact }) : null;
  } catch { terminal = null; }

  const written = [];
  try {
    if (sessionsDir && sessionId) {
      const stored = storeReceipt({
        sessionsDir, sessionId, receipt,
        markdown: cfg.storeMarkdown ? renderMarkdown(receipt) : null,
        signature: receipt.integrity ?? null,
        storeJson: cfg.storeJson, storeMarkdown: cfg.storeMarkdown,
      });
      if (stored && Array.isArray(stored.written)) written.push(...stored.written);
      const paths = receiptPaths(sessionsDir, sessionId);
      if (sessionMarkdownPath) {
        upsertSessionAutonomySection(sessionMarkdownPath, renderMarkdown({ ...receipt, integrity: { ...receipt.integrity, receiptPath: paths.json } }));
      }
    }
  } catch {
    // Storage failure is non-fatal: the receipt was still computed (spec §7).
    return {
      ok: true, status: 'generated', reason: REASON_CODES.STORAGE_FAILED,
      receipt, terminal, written,
    };
  }

  return { ok: true, status: receipt.status ?? 'generated', reason: null, receipt, terminal, written };
}
