#!/usr/bin/env node
/**
 * Optional subagent scope recommendation (ADR-0158).
 *
 * The default path is inert: no required touch-set, spawn counter, ledger write,
 * receipt, or denial. A controller may attach an explicit result report for a
 * one-shot canary comparison. Missing/corrupt reports and evaluator failures are
 * silent continuation, never dispatch or delivery blockers.
 */
import { resolve } from 'node:path';
import { evaluateSubagentScope } from '../execution/evaluate-subagent-scope.mjs';
import { emitAdvisory, hookHost } from './host-adapter.mjs';

/** @returns {Promise<string>} hook stdin with a short fail-open timeout. */
async function readStdin() {
  return new Promise((complete) => {
    let buffer = '';
    process.stdin.setEncoding('utf-8');
    process.stdin.on('data', (chunk) => { buffer += chunk; });
    process.stdin.on('end', () => complete(buffer));
    setTimeout(() => complete(buffer), 250).unref?.();
  });
}

/**
 * Normalizes a report path list without deriving scope from free text.
 * @param {unknown} value candidate path list.
 * @returns {string[]} explicit paths only.
 */
function pathList(value) {
  return Array.isArray(value)
    ? value.filter((entry) => typeof entry === 'string' && entry.trim().length > 0)
    : [];
}

/**
 * Evaluates an explicitly supplied result report as canary-only guidance.
 *
 * @param {object} report controller-supplied declared/touched/forbidden paths.
 * @returns {Readonly<object>} non-binding recommendation.
 */
export function evaluateSubagentRecommendation(report = {}) {
  const label = typeof report.label === 'string' && report.label.trim()
    ? report.label.trim().slice(0, 80)
    : 'subagent';
  try {
    const finding = evaluateSubagentScope({
      declared: pathList(report.declared),
      touched: pathList(report.touched),
      forbidden: pathList(report.forbidden),
      mode: 'advisory',
    });
    return Object.freeze({
      decision: 'recommend',
      mode: 'canary',
      binding: false,
      blocking: false,
      persisted: false,
      label,
      status: finding.reasonCodes.length > 0 ? 'finding' : 'clear',
      reasonCodes: Object.freeze(finding.reasonCodes.slice()),
      detail: finding.detail,
      remediation: Object.freeze(finding.remediation.slice()),
      continuation: Object.freeze({ allowed: true, reason: 'subagent-scope-is-advisory' }),
    });
  } catch (error) {
    return Object.freeze({
      decision: 'recommend',
      mode: 'canary',
      binding: false,
      blocking: false,
      persisted: false,
      label,
      status: 'unavailable',
      reasonCodes: Object.freeze([`scope-evaluator-unavailable:${error?.message || String(error)}`]),
      detail: null,
      remediation: Object.freeze([]),
      continuation: Object.freeze({ allowed: true, reason: 'subagent-scope-evaluator-unavailable' }),
    });
  }
}

/**
 * Formats the single optional canary message.
 * @param {object} recommendation scope recommendation.
 * @returns {string} host-facing advisory.
 */
function recommendationText(recommendation) {
  const lines = [
    `[subagent-scope] Canary recommendation for "${recommendation.label}"; delivery continues.`,
    `Reason codes: ${recommendation.reasonCodes.join(', ')}`,
  ];
  for (const step of recommendation.remediation) lines.push(`  - ${step}`);
  return `${lines.join('\n')}\n`;
}

/** @returns {Promise<void>} completion after optional explicit-report handling. */
async function main() {
  const raw = await readStdin();
  let payload;
  try {
    payload = raw ? JSON.parse(raw.replace(/^\uFEFF/, '')) : {};
  } catch {
    return;
  }
  const report = payload?.contextdevkit_scope_report
    ?? payload?.tool_input?.contextdevkit_scope_report
    ?? null;
  if (!report || typeof report !== 'object') return;
  const recommendation = evaluateSubagentRecommendation(report);
  if (recommendation.status !== 'finding') return;
  emitAdvisory(recommendationText(recommendation), hookHost(), payload?.hook_event_name || 'SubagentStop');
}

const isMain = process.argv[1] && resolve(process.argv[1]).endsWith('subagent-gate.mjs');
if (isMain) main().catch(() => process.exit(0));
