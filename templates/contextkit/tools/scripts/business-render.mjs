/**
 * Deterministic Business document renderer (BIZ-0001 / WF-0036 A3-T1).
 *
 * Projects a `business.json` object into an idempotent managed-block Markdown
 * section inside a business document (e.g. `business-case.md`, `growth.md`,
 * `investment-decision.md`).  Mirrors the managed-block pattern established by
 * `work-render.mjs` and `workflow/render.mjs` (ADR-0067):
 *
 *   - Human content OUTSIDE the managed markers is preserved byte-for-byte.
 *   - The generated block is replaced deterministically on re-render.
 *   - Atomic write only when the result differs (no mtime churn).
 *   - Status/values are NEVER invented — read directly off the business object.
 *   - Zero runtime dependencies (`node:*` + sibling modules only — ADR-0001).
 *
 * The renderer does NOT call the Growth validator; that is the caller's concern
 * (single responsibility).
 */
import { existsSync, readFileSync } from 'node:fs';
import { updateManagedBlock, writeIfChanged } from './workflow/io.mjs';

/** Managed-block id for the machine-generated business summary section. */
export const BUSINESS_SUMMARY_BLOCK = 'business-summary';

/**
 * Escape a Markdown table cell value so a literal pipe never breaks the table.
 *
 * @param {unknown} value - raw value (any type).
 * @returns {string} safe cell content.
 */
function escapeCell(value) {
  return String(value ?? '—')
    .replace(/\r?\n/g, ' ')
    .replace(/\|/g, '\\|')
    .trim();
}

/**
 * Formats a `valueIntents` object as `PRIMARY [+ secondary, …]`.
 *
 * @param {{ primary?: unknown, secondary?: unknown[] } | null | undefined} intents
 * @returns {string}
 */
function formatValueIntents(intents) {
  if (!intents || typeof intents !== 'object') return '—';
  const parts = [intents.primary].filter(Boolean);
  if (Array.isArray(intents.secondary)) {
    for (const s of intents.secondary) {
      if (s) parts.push(s);
    }
  }
  return parts.join(', ') || '—';
}

/**
 * Formats an array or scalar as a comma-separated list.
 *
 * @param {unknown} value - array or scalar.
 * @returns {string}
 */
function formatList(value) {
  if (Array.isArray(value)) return value.filter(Boolean).join(', ') || '—';
  return String(value ?? '—');
}

/**
 * Renders the inner content of the `business-summary` managed block from a
 * Business object.  The block is a compact metadata table; values are read
 * directly from the object — never invented.
 *
 * @param {object} business - a parsed business.json object (any schema version).
 * @returns {string} markdown content (inner block — no managed-block markers).
 */
export function renderBusinessSummary(business) {
  if (!business || typeof business !== 'object') {
    return '_Business object is missing or malformed — regenerate from business.json._';
  }

  const growth = business.growth ?? {};
  const investment = business.investment ?? {};
  const decisions = business.decisions ?? {};
  const workflows = business.workflows ?? {};

  const rows = [
    ['ID', escapeCell(business.id)],
    ['Title', escapeCell(business.title)],
    ['Status', escapeCell(business.status)],
    ['Kind', escapeCell(business.kind)],
    ['Strategic facet', escapeCell(business.strategicFacet)],
    ['Value intents', escapeCell(formatValueIntents(business.valueIntents))],
    ['Growth lever', escapeCell(growth.primaryLever)],
    ['Investment rec.', escapeCell(investment.recommendation)],
    ['Decisions status', escapeCell(decisions.status)],
    ['Primary decision', escapeCell(decisions.primary)],
    ['Governing ADRs', escapeCell(formatList(decisions.governing))],
    ['Authorized workflows', escapeCell(formatList(workflows.authorized))],
    ['Updated at', escapeCell(business.updatedAt)],
  ];

  const lines = ['| Field | Value |', '| --- | --- |'];
  for (const [label, value] of rows) {
    lines.push(`| ${label} | ${value} |`);
  }

  return lines.join('\n');
}

/**
 * Renders a `business` object to the deterministic `business-summary` block
 * STRING (pure — no disk I/O). Use `renderBusinessFile` to write it idempotently
 * into a Markdown file's managed block. Same input always yields the same output.
 *
 * @param {object} business - parsed business.json object.
 * @param {object} [opts] - optional render options (reserved for future use).
 * @returns {string} the rendered `business-summary` block content.
 */
export function renderBusiness(business, opts = {}) {
  void opts; // Reserved — no option keys consumed yet.
  return renderBusinessSummary(business);
}

/**
 * Idempotently renders `business` into the `business-summary` managed block of
 * `docPath` and writes the file atomically when the content has changed.
 *
 * @param {string} docPath - absolute path to the target Markdown file.
 * @param {object} business - parsed business.json object.
 * @returns {{ changed: boolean }} whether a disk write occurred.
 * @throws {TypeError} when `docPath` is not provided.
 */
export function renderBusinessFile(docPath, business) {
  if (!docPath) throw new TypeError('renderBusinessFile: docPath is required');
  const source = existsSync(docPath) ? readFileSync(docPath, 'utf-8') : '';
  const inner = renderBusinessSummary(business);
  const next = updateManagedBlock(source, BUSINESS_SUMMARY_BLOCK, inner);
  return writeIfChanged(docPath, next);
}
