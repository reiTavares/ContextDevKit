/**
 * directive.mjs — the UserPromptSubmit `‹CONTEXTKIT-IMPLEMENTATION›` directive
 * (ADR-0128 §15, WF-0065). This is the §15 EXTENSION of the Execution Contract:
 * it READS the shadow implementation block the Request Intent Envelope already
 * carries (`envelope.implementation`, built by WF-0063's `envelope-block.mjs`)
 * and shapes the mandatory directive the agent must honor before code — never a
 * visual hint. It does NOT recompute CMIS/DAS/profile (WF-0063 owns that) and it
 * does NOT dispatch or author agents (WF-0064 owns that).
 *
 * Pure render — no I/O, zero runtime dependencies. Fail-open: a degraded or
 * missing block yields '' (advisory silence) or a short degraded note, never a
 * false obligation (constitution §8).
 *
 * @module domain-engineering/directive
 */

/** Directive block schema version — bump on any breaking shape change (§15). */
export const DIRECTIVE_VERSION = '1.0.0';

/**
 * Extends the Execution Contract with the §15 implementation directive derived
 * from an envelope. Returns '' when there is no code obligation to surface
 * (no-code profile, degraded block, or a missing envelope) so trivial and
 * non-code prompts stay noise-free.
 *
 * @param {object} envelope a Request Intent Envelope (request-envelope §5) — its
 *   `implementation` field is the §15 block; `context`/`requestId` label it.
 * @param {object} [opts]
 * @param {string} [opts.owner] governing business/operation/workflow id override.
 * @returns {string} the directive block (newline-terminated), or ''.
 */
export function extendExecutionContract(envelope, opts = {}) {
  const e = envelope && typeof envelope === 'object' ? envelope : {};
  const block = e.implementation && typeof e.implementation === 'object' ? e.implementation : null;
  if (!block) return '';

  // Degraded block: surface a short honest note (advisory), never an obligation.
  if (block.degraded === true) {
    return [
      `‹CONTEXTKIT-IMPLEMENTATION requestId=${e.requestId ?? '?'} status=degraded›`,
      '  classification degraded — no implementation obligations derived (advisory).',
      '‹/CONTEXTKIT-IMPLEMENTATION›',
    ].join('\n') + '\n';
  }

  // No code intent ⇒ no directive (a no-code task carries no squad/artifact duty).
  const profile = typeof block.profile === 'string' ? block.profile : 'no-code';
  if (profile === 'no-code' || block.squadRequired !== true) return '';

  const owner = resolveOwner(e, opts);
  const agents = stringList(block.requiredAgents);
  const skills = stringList(block.requiredSkills);
  const artifacts = stringList(block.requiredArtifacts);

  const lines = [`‹CONTEXTKIT-IMPLEMENTATION requestId=${e.requestId ?? '?'} profile=${profile} owner=${owner}›`];
  lines.push(`  required agents: ${agents.length ? agents.join(', ') : '(none resolved)'}`);
  lines.push(`  required skills: ${skills.length ? skills.join(', ') : '(none resolved)'}`);
  lines.push(`  required-before-code artifacts: ${artifacts.length ? artifacts.join(', ') : '(none)'}`);
  if (block.simulateImpactRequired === true) lines.push('  simulate-impact: required before high-risk writes.');
  lines.push('  action: activate the squad and produce the required artifacts BEFORE writing code.');
  lines.push('  note: an agent named in a prompt does NOT count — only a real spawn + completion satisfies this (§17).');
  lines.push('‹/CONTEXTKIT-IMPLEMENTATION›');
  return lines.join('\n') + '\n';
}

/** Resolves the governing owner id from the envelope context (business/op/workflow). */
function resolveOwner(envelope, opts) {
  if (typeof opts.owner === 'string' && opts.owner) return opts.owner;
  const ctx = envelope.context && typeof envelope.context === 'object' ? envelope.context : {};
  return ctx.businessId || ctx.operationId || ctx.workflowId || 'unknown';
}

/** Filters to a plain string[], dropping non-string entries. */
function stringList(value) {
  return Array.isArray(value) ? value.filter((x) => typeof x === 'string' && x.length > 0) : [];
}
