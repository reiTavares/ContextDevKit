/**
 * receipt-render.mjs — Session Autonomy Receipt: terminal + markdown rendering.
 *
 * Pure presentation layer (constitution §2): consumes an assembled receipt object
 * and emits human-readable text. Zero I/O, zero deps, deterministic — no Date.now,
 * no Math.random; the only timestamp shown (`generatedAt`) is passed in on the
 * receipt by the caller, so identical receipts render identically (spec §23 idempotency).
 *
 * Honesty invariants enforced at render time (spec §24–27, §30):
 *  - Subscription mode (§25) NEVER shows a dollar figure for savings — it states
 *    "Financial savings: unavailable / Reason: subscription allowance".
 *  - Hybrid mode (§26) qualifies the financial line: "covers API usage only".
 *  - Insufficient-evidence (§27) shows usage recorded but NO multiplier — only the
 *    reason the autonomy estimate is unavailable.
 *  - Low confidence (§10.3) shows the multiplier RANGE (lowerBound–upperBound),
 *    never a falsely precise point value.
 *  - All numbers route through the frozen formatters — no ad-hoc toFixed (#17).
 */

import {
  formatMultiplier, formatMultiplierRange, formatSignedPercent,
  formatTokens, formatUsd, formatPercent,
} from './receipt-metrics.mjs';

/** A value the formatters treat as "present" (not null/undefined). */
const has = (value) => value !== null && value !== undefined;

/**
 * Picks the multiplier string honoring confidence (spec §10.3): a low/insufficient
 * confidence band shows the RANGE; medium/high shows the central point value.
 * @param {object} autonomy {multiplier, lowerBound, upperBound}
 * @param {string} confidenceLevel one of CONFIDENCE_LEVELS
 * @returns {string}
 */
function multiplierDisplay(autonomy, confidenceLevel) {
  const wantRange = confidenceLevel === 'low' || confidenceLevel === 'insufficient';
  if (wantRange && has(autonomy?.lowerBound) && has(autonomy?.upperBound)) {
    return formatMultiplierRange(autonomy.lowerBound, autonomy.upperBound);
  }
  return formatMultiplier(autonomy?.multiplier);
}

/**
 * Renders the financial line(s) for the terminal, mode-aware (spec §24–27).
 * Returns an array of lines so the caller controls spacing.
 * @returns {string[]}
 */
function financialLines(receipt) {
  const mode = receipt?.consumption?.mode;
  if (mode === 'subscription') {
    return ['Financial savings: unavailable', '  Reason: subscription allowance'];
  }
  const fin = receipt?.financial ?? {};
  if (!has(fin.estimatedSavings) && !has(fin.observedCost)) {
    return ['Financial savings: unavailable', '  Reason: no cost telemetry'];
  }
  const lines = [];
  if (has(fin.observedCost)) lines.push(`Observed cost: ${formatUsd(fin.observedCost)}`);
  if (has(fin.estimatedBaselineCost)) {
    lines.push(`Estimated baseline cost: ${formatUsd(fin.estimatedBaselineCost)}`);
  }
  if (has(fin.estimatedSavings)) {
    const pct = has(fin.estimatedSavingsPercent)
      ? ` (${formatSignedPercent(fin.estimatedSavingsPercent)})` : '';
    lines.push(`Estimated financial savings: ${formatUsd(fin.estimatedSavings)}${pct}`);
  }
  if (mode === 'hybrid') lines.push('  Note: financial comparison covers API usage only');
  return lines;
}

/**
 * Renders the autonomy line(s) for the terminal. Insufficient-evidence (§27)
 * suppresses the multiplier entirely and states why.
 * @returns {string[]}
 */
function autonomyLines(receipt) {
  const claim = receipt?.claimType;
  if (claim === 'insufficient-evidence') {
    const reason = reasonText(receipt) ?? 'insufficient calibrated evidence';
    return ['Autonomy estimate: unavailable', `  Reason: ${reason}`];
  }
  const confidence = receipt?.confidence?.level ?? null;
  const qualifier = claim === 'measured' ? ' (measured)' : ' (estimated)';
  const lines = [`Autonomy Multiplier: ${multiplierDisplay(receipt?.autonomy, confidence)}${qualifier}`];
  if (has(receipt?.autonomy?.gainPercent)) {
    lines.push(`Additional autonomous capacity: ${formatSignedPercent(receipt.autonomy.gainPercent)}`);
  }
  if (claim === 'estimated' && receipt?.estimator?.calibrationId) {
    lines.push(`  Basis: ${receipt.estimator.calibrationId} pilot calibration — estimated, not a proven claim`);
  }
  return lines;
}

/** First human-readable reason from confidence.reasons, if any. */
function reasonText(receipt) {
  const reasons = receipt?.confidence?.reasons;
  if (Array.isArray(reasons) && reasons.length > 0) return String(reasons[0]);
  return null;
}

/**
 * Renders the usage block lines (shared across all modes).
 * @returns {string[]}
 */
function usageLines(receipt) {
  const usage = receipt?.usage ?? {};
  const lines = [`Observed tokens: ${formatTokens(usage.observedTokens)}`];
  if (has(usage.estimatedBaselineTokens)) {
    lines.push(`Estimated baseline: ${formatTokens(usage.estimatedBaselineTokens)}`);
  }
  if (has(usage.tokenSavingsPercent)) {
    lines.push(`Estimated token reduction: ${formatPercent(usage.tokenSavingsPercent)}`);
  }
  return lines;
}

/**
 * Renders the receipt for a terminal. Mode + confidence aware (spec §24–27).
 * @param {object} receipt assembled receipt object
 * @param {{compact?: boolean}} [opts]
 * @returns {string}
 */
export function renderTerminal(receipt, opts = {}) {
  if (!receipt || typeof receipt !== 'object') return 'Session autonomy: receipt unavailable';
  const mode = receipt.consumption?.mode ?? 'unknown';
  const claim = receipt.claimType ?? 'estimated';
  const header = `Session autonomy receipt — ${mode} / ${claim}`;

  if (opts.compact) {
    const parts = [];
    if (claim === 'insufficient-evidence') {
      parts.push('autonomy: unavailable');
    } else {
      parts.push(`autonomy: ${multiplierDisplay(receipt.autonomy, receipt.confidence?.level ?? null)} (${claim})`);
    }
    if (mode === 'subscription') parts.push('savings: n/a (subscription)');
    else if (has(receipt.financial?.estimatedSavings)) {
      parts.push(`savings: ${formatUsd(receipt.financial.estimatedSavings)}`);
    }
    parts.push(`confidence: ${receipt.confidence?.level ?? 'unknown'}`);
    return `${header} — ${parts.join(' · ')}`;
  }

  const body = [
    header,
    ...usageLines(receipt),
    ...autonomyLines(receipt),
    ...financialLines(receipt),
    `Confidence: ${receipt.confidence?.level ?? 'unknown'}`,
    `Integrity: ${receipt.integrity?.status ?? 'unsigned'}`,
  ];
  return body.join('\n');
}

/**
 * Renders the `## Session autonomy` markdown section (spec §23). Idempotent for a
 * fixed receipt (the only varying field, generatedAt, is supplied by the caller).
 * @param {object} receipt assembled receipt object
 * @returns {string}
 */
export function renderMarkdown(receipt) {
  if (!receipt || typeof receipt !== 'object') {
    return '## Session autonomy\n\n- Receipt: unavailable\n';
  }
  const mode = receipt.consumption?.mode ?? 'unknown';
  const usage = receipt.usage ?? {};
  const autonomy = receipt.autonomy ?? {};
  const insufficient = receipt.claimType === 'insufficient-evidence';
  const confidence = receipt.confidence?.level ?? null;

  const claimQual = receipt.claimType === 'measured' ? ' (measured)' : ' (estimated)';
  const multiplierLine = insufficient
    ? '- Autonomy Multiplier: unavailable'
    : `- Autonomy Multiplier: ${multiplierDisplay(autonomy, confidence)}${claimQual}`;
  const gainLine = insufficient || !has(autonomy.gainPercent)
    ? '- Additional autonomous capacity: unavailable'
    : `- Additional autonomous capacity: ${formatSignedPercent(autonomy.gainPercent)}`;

  let savingsLine;
  if (mode === 'subscription') {
    savingsLine = '- Financial savings: unavailable (subscription allowance)';
  } else if (has(receipt.financial?.estimatedSavings)) {
    const note = mode === 'hybrid' ? ' (API usage only)' : '';
    savingsLine = `- Financial savings: ${formatUsd(receipt.financial.estimatedSavings)}${note}`;
  } else {
    savingsLine = '- Financial savings: unavailable';
  }

  const receiptPath = receipt.integrity?.receiptPath ?? receipt.reportId ?? 'n/a';
  const lines = [
    '## Session autonomy',
    '',
    `- Consumption mode: ${mode}`,
    `- Claim type: ${receipt.claimType ?? 'estimated'}`,
    `- Observed tokens: ${formatTokens(usage.observedTokens)}`,
    `- Estimated baseline: ${formatTokens(usage.estimatedBaselineTokens)}`,
    `- Estimated token reduction: ${formatPercent(usage.tokenSavingsPercent)}`,
    multiplierLine,
    gainLine,
    savingsLine,
    `- Calibration: ${receipt.estimator?.calibrationId ?? 'none'}${receipt.claimType === 'estimated' ? ' (estimated, not a proven claim)' : ''}`,
    `- Confidence: ${receipt.confidence?.level ?? 'unknown'}`,
    `- Integrity: ${receipt.integrity?.status ?? 'unsigned'}`,
    `- Receipt path: ${receiptPath}`,
    '',
  ];
  return lines.join('\n');
}
