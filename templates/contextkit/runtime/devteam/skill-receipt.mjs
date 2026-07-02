/**
 * skill-receipt.mjs — the §18 skill-application receipt (ADR-0128 §18, WF-0064).
 *
 * Skill SELECTION is not proof of APPLICATION: this receipt records what was
 * actually injected/applied (skill, version, sections, target, content hash) so
 * selected-vs-applied can be compared by governance and QA (ADR-0128 evidence
 * ruling — a name in a prompt does not count).
 *
 * `buildSkillReceipt` is pure (timestamp injectable); `recordSkillApplication`
 * persists defensively (atomic write, FIFO-bounded, never throws — rule 2).
 *
 * @module devteam/skill-receipt
 */
import { createHash } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { writeFileAtomicSync, readJsonSafe } from '../hooks/safe-io.mjs';
import { pathsFor } from '../config/paths.mjs';

/** Receipt schema version — bump on any breaking shape change. */
export const SKILL_RECEIPT_SCHEMA_VERSION = 1;

/**
 * Computes the sha256 content hash (prefixed `sha256:`) of the applied skill
 * content — the anchor that distinguishes real injection from a mere mention.
 *
 * @param {string} content the skill content actually applied.
 * @returns {string}
 */
export function skillContentHash(content) {
  return `sha256:${createHash('sha256').update(String(content ?? ''), 'utf8').digest('hex')}`;
}

/**
 * Builds one §18 skill-application receipt. Pure given an injected `at`.
 *
 * @param {object} params
 * @param {string} params.skill skill id (skills-registry.json).
 * @param {string} [params.version] applied skill/policy version.
 * @param {string[]} [params.sections] section ids actually injected.
 * @param {string} [params.appliedTo] target (agent id, packet id or file).
 * @param {string} [params.taskId] governing task/request id.
 * @param {string} [params.content] applied content — hashed, never stored raw.
 * @param {string} [params.contentHash] pre-computed hash (wins over content).
 * @param {string} [params.at] ISO timestamp (injectable for tests).
 * @returns {object} receipt record.
 */
export function buildSkillReceipt(params) {
  const p = params && typeof params === 'object' ? params : {};
  return {
    schemaVersion: SKILL_RECEIPT_SCHEMA_VERSION,
    skill: typeof p.skill === 'string' ? p.skill : 'unknown',
    version: p.version ?? null,
    sections: Array.isArray(p.sections) ? p.sections.filter((s) => typeof s === 'string') : [],
    appliedTo: p.appliedTo ?? null,
    taskId: p.taskId ?? null,
    contentHash: typeof p.contentHash === 'string' ? p.contentHash : skillContentHash(p.content),
    shadow: true,
    at: p.at ?? new Date().toISOString(),
  };
}

/** Absolute path of the skill-application receipt log (co-located with state). */
export function skillReceiptPathFor(root) {
  return join(pathsFor(root).pipeline, 'state', 'devteam', 'skill-receipts.json');
}

/**
 * Records one skill application: builds the receipt and appends it to the
 * bounded log. Never throws (rule 2) — on any I/O error it returns the receipt
 * flagged `persisted: false` with the RECEIPT_WRITE_FAILED reason, never a
 * false pass.
 *
 * @param {string} root project root.
 * @param {object} params see buildSkillReceipt().
 * @param {number} [maxReceipts] retention cap (default 5000, FIFO).
 * @returns {{ receipt: object, persisted: boolean, reasonCode: string }}
 */
export function recordSkillApplication(root, params, maxReceipts = 5000) {
  const receipt = buildSkillReceipt(params);
  try {
    const file = skillReceiptPathFor(root);
    mkdirSync(join(pathsFor(root).pipeline, 'state', 'devteam'), { recursive: true });
    const existing = readJsonSafe(file, { schemaVersion: SKILL_RECEIPT_SCHEMA_VERSION, receipts: [] });
    const receipts = Array.isArray(existing.receipts) ? existing.receipts : [];
    receipts.push(receipt);
    const bounded = receipts.length > maxReceipts ? receipts.slice(receipts.length - maxReceipts) : receipts;
    writeFileAtomicSync(file, JSON.stringify({ schemaVersion: SKILL_RECEIPT_SCHEMA_VERSION, receipts: bounded }, null, 2));
    return { receipt, persisted: true, reasonCode: 'RECEIPT_RECORDED' };
  } catch {
    return { receipt, persisted: false, reasonCode: 'RECEIPT_WRITE_FAILED' };
  }
}

/**
 * Reads the persisted receipt log, or the empty shape when absent (rule 2).
 *
 * @param {string} root project root.
 * @returns {{ schemaVersion: number, receipts: object[] }}
 */
export function loadSkillReceipts(root) {
  return readJsonSafe(skillReceiptPathFor(root), { schemaVersion: SKILL_RECEIPT_SCHEMA_VERSION, receipts: [] });
}
