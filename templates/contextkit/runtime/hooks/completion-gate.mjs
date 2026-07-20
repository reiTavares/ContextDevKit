#!/usr/bin/env node
/**
 * completion-gate.mjs - Stop hook: completion evidence gate (CDK-040, ADR-0072).
 *
 * Fires once per session when Claude declares a task done (the Stop event).
 * Checks whether all required completion capabilities have valid receipts on
 * disk before the session ends. Advisory-first design: in advisory mode (the
 * v1 default) this hook NEVER blocks - it emits a stdout nudge.
 *
 * Key invariants:
 *   Inert below Level 5: exits 0 immediately.
 *   Silent for unregistered tasks (no activeTask in ledger): exits 0.
 *   Silent when no contract exists on disk: exits 0.
 *   Debounce: fires at most ONCE per session (completionWarnedAt stamp guards re-entry).
 *   Fail-open: any unhandled error exits 0 silently (immutable rule 2).
 *   Anti-loop: stop_hook_active === true -> exits 0 immediately.
 *
 * Advisory mode: emits advisory text to stdout, never blocks.
 * Guarded / strict: emits block decision when result.decision === 'deny'.
 *
 * Zero runtime deps - node:* + sibling runtime modules only.
 */
import { appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { getLevel, loadConfig } from '../config/load.mjs';
import { loadContract } from '../execution/execution-contract.mjs';
import { loadEnvelope } from '../execution/request-envelope.mjs';
import { readDispatchedAgents, comparePlannedActual } from '../execution/request-directive.mjs';
import { resolveEnforcementMode } from '../execution/enforcement-modes.mjs';
import { evaluateCompletion } from '../execution/evaluate-completion.mjs';
import { readLedger, writeLedger } from './ledger.mjs';
import { emitAdvisory, emitBlockDecision, hookHost, resolveHookSessionId } from './host-adapter.mjs';
import { currentBranch } from '../../tools/scripts/workflow-pack.mjs';
import { resolveConfig } from '../domain-engineering/config.mjs';
import { resolveDomainMode } from '../domain-engineering/code-gate.mjs';
import { summarizeSpawnEvidence } from '../domain-engineering/spawn-record.mjs';
import { sessionHasSourceWrite } from '../execution/no-code-prior.mjs';

const ROOT = process.cwd();
const HOST = hookHost();

// ---------------------------------------------------------------------------
// stdin helper
// ---------------------------------------------------------------------------

async function readStdin() {
  return new Promise((res) => {
    let buf = '';
    process.stdin.setEncoding('utf-8');
    process.stdin.on('data', (chunk) => (buf += chunk));
    process.stdin.on('end', () => res(buf));
    setTimeout(() => res(buf), 500).unref?.();
  });
}

// ---------------------------------------------------------------------------
// Message builders
// ---------------------------------------------------------------------------

/**
 * Formats a human-readable advisory nudge from evaluateCompletion output.
 *
 * @param {{ reasonCodes: string[], remediation: string[], detail: object }} result
 * @param {string} taskId
 * @returns {string}
 */
function buildAdvisoryText(result, taskId) {
  const shortId = taskId.length > 16 ? taskId.slice(0, 16) + '...' : taskId;
  const lines = [
    '[completion-gate] Advisory: task ' + shortId + ' declared done without complete evidence (no blocking in advisory mode).',
    'Reason codes: ' + result.reasonCodes.join(', '),
  ];
  if (result.detail.missing.length > 0) {
    lines.push('Missing completion evidence: ' + result.detail.missing.join(', '));
  }
  if (result.detail.bypassed.length > 0) {
    lines.push('Bypassed (waived, not proved): ' + result.detail.bypassed.join(', '));
  }
  if (result.remediation.length > 0) {
    lines.push('Remediation:');
    for (const step of result.remediation) lines.push('  - ' + step);
  }
  return lines.join('\n') + '\n';
}

/**
 * Formats a deny-mode block reason for the completion gate.
 *
 * @param {{ reasonCodes: string[], remediation: string[], detail: object }} result
 * @param {string} taskId
 * @returns {string}
 */
function buildCompletionBlockText(result, taskId) {
  const lines = [
    'Completion gate denied: task ' + taskId + ' lacks required completion evidence.',
    'Reason codes: ' + result.reasonCodes.join(', '),
  ];
  if (result.detail.missing.length > 0) {
    lines.push('Missing: ' + result.detail.missing.join(', '));
  }
  if (result.remediation.length > 0) {
    lines.push('Required remediation:');
    for (const step of result.remediation) lines.push('  - ' + step);
  }
  return lines.join('\n');
}

/**
 * Augments a completion result with the orchestration planned-vs-actual check
 * (ADR-0107 §13/§21). Adds reason codes + remediation when a required deliberation
 * or required specialist was not executed; escalates `decision` to 'deny' ONLY for
 * a material decision (the guarded/strict caller then blocks; advisory still only
 * nudges). Trivial requests are never escalated. Fail-open — never throws.
 *
 * @param {object} result evaluateCompletion result (mutated in place)
 * @param {string} root project root
 * @param {string} taskId task id
 * @param {string} mode resolved enforcement mode (advisory|guarded|strict)
 * @returns {void}
 */
function augmentWithOrchestration(result, root, taskId, mode) {
  try {
    const envelope = loadEnvelope(root, taskId);
    if (!envelope) return;
    const wantsDebate = envelope.deliberation?.required;
    const plannedSpecialists = [envelope.agents?.lead, ...(envelope.agents?.reviewers ?? [])].filter(Boolean);
    if (!wantsDebate && plannedSpecialists.length === 0) return;

    const cmp = comparePlannedActual(envelope, readDispatchedAgents(root, taskId));
    if (cmp.ok) return;

    for (const reason of cmp.reasons) {
      result.reasonCodes.push(`orchestration: ${reason}`);
      if (Array.isArray(result.detail?.missing)) result.detail.missing.push(reason);
    }
    if (Array.isArray(result.remediation)) {
      if (cmp.requiredDebateMissing) result.remediation.push(`Convene the council [${(envelope.agents?.council ?? []).join(', ')}] before completing (ADR-0107 §21).`);
      if (cmp.missingSpecialists.length) result.remediation.push(`Dispatch the required specialist(s): ${cmp.missingSpecialists.join(', ')}.`);
    }
    // Block material decisions ONLY in guarded/strict — advisory must never flip a
    // warn into a deny (ADR-0107 §2: advisory toward permission). Trivial never blocks.
    if (cmp.requiredDebateMissing && mode !== 'advisory'
      && envelope.classification?.intent === 'material-decision') {
      result.decision = 'deny';
    }
  } catch { /* fail-open — orchestration completion check never breaks the gate */ }
}

/**
 * Augments a completion result with the ADR-0128 §20 Domain Engineering
 * completion obligation (WF-0067). Config-gated default-OFF: does nothing unless
 * `domainEngineering.enabled`. When enabled + the resolved profile actually
 * declares required agents, it checks the WF-0065 spawn evidence
 * (planned-vs-completed — a name in a prompt never counts) and, on a shortfall,
 * adds a reason code + remediation. Escalates `decision` to 'deny' ONLY in a
 * guarded/strict DOMAIN mode (the outer emit still respects the capability mode,
 * so advisory never blocks). Mirrors `augmentWithOrchestration`. Fail-open —
 * never throws.
 *
 * @param {object} result evaluateCompletion result (mutated in place)
 * @param {string} root project root
 * @param {string} taskId task id
 * @param {object} config the full loaded config (carries `domainEngineering`)
 * @returns {void}
 */
function augmentWithDomainCompletion(result, root, taskId, config) {
  try {
    const deConfig = resolveConfig(config?.domainEngineering);
    if (deConfig.enabled !== true) return; // default-OFF: inert.
    const domainMode = resolveDomainMode(getLevel(root), deConfig);
    if (domainMode === 'shadow') return;

    const envelope = loadEnvelope(root, taskId);
    const block = envelope?.implementation;
    if (!block || block.profile === 'no-code') return; // no-code ⇒ zero obligations.
    if (block.squadRequired !== true || !Array.isArray(block.requiredAgents) || block.requiredAgents.length === 0) return;

    const evidence = summarizeSpawnEvidence(root, taskId, block.requiredAgents);
    if (evidence.satisfied === true) return; // every planned agent recorded completion.

    result.reasonCodes.push('domain-completion: required-agents-incomplete');
    if (Array.isArray(result.detail?.missing)) result.detail.missing.push('required-agents');
    if (Array.isArray(result.remediation)) {
      const outstanding = [...(evidence.plannedNotDispatched || []), ...(evidence.dispatchedNotCompleted || [])];
      result.remediation.push(
        `Dispatch + complete the profile-required agent(s): ${(outstanding.length ? outstanding : block.requiredAgents).join(', ')} (a name in a prompt does not count — ADR-0128 evidence ruling).`,
      );
    }
    // Block only in a guarded/strict DOMAIN mode; the outer emit still gates on the
    // capability enforcement mode, so an advisory install never blocks completion.
    if (domainMode === 'guarded' || domainMode === 'strict') result.decision = 'deny';
  } catch { /* fail-open — domain completion check never breaks the gate */ }
}

/**
 * WF-0069 / ADR-0131 §Binding + ADR-0133 knob 2 — language-aware no-code escape
 * with an ALWAYS-ON write authority (F-A), decoupled from any domain gate mode.
 *
 * A no-code classification is a PRIOR, not a verdict. When the contract carries a
 * no-code intent (question / read-only, no mutation verb) AND no real write occurred
 * for THIS task, the completion gate honors the "no-code ⇒ zero obligations" escape
 * — a plain question must not demand test-plan/tests/qa-signoff. But a real
 * Edit/Write/MultiEdit for the task is EVIDENCE that revokes the prior (F-A): the
 * obligations stand. The write receipt is read from `ledger.modifications`, each
 * stamped with its `taskId` by track-edits (F-B) so the gate consults the SAME
 * task's writes as the contract (one binding across the turn).
 *
 * Guards (ADR-0131): the invert is on the tier/ceremony axis ONLY — a regulated
 * domain (lgpd/fintech/healthcare) keeps its obligations (never inverted on the
 * domain axis). Fail-open — any error leaves the result untouched (rule 2).
 *
 * @param {object} result evaluateCompletion result (mutated in place)
 * @param {object} contract loaded execution contract
 * @param {object} ledger session ledger (carries modifications[] with taskId)
 * @param {string} taskId active task id
 * @returns {{ applied: boolean, wrote: boolean }} telemetry outcome
 */
export function augmentWithLangAwareNoCode(result, contract, ledger, taskId) {
  const intent = contract?.signals?.intent;
  try {
    if (!intent || intent.intent !== 'no-code' || intent.mutationVerb === true) {
      return { applied: false, wrote: false };
    }
    // Never invert on the domain axis — a regulated domain keeps full ceremony.
    const domain = contract?.signals?.domain;
    if (domain && domain !== 'general') return { applied: false, wrote: false };

    // F-A (WF-0081): a real SOURCE write for THIS task (F-B taskId binding) revokes the
    // no-code prior. A write to a NON-source path (governance memory, docs, per-workflow
    // reports, scratch) does NOT revoke — an investigation/maintenance session that only
    // touched such paths stays exempt. `sessionHasSourceWrite` is the single-sourced
    // predicate (no-code-prior.mjs); default-to-source keeps the guard against an
    // over-permissive exemption (risk R1/R2).
    const mods = Array.isArray(ledger?.modifications) ? ledger.modifications : [];
    if (sessionHasSourceWrite(mods, taskId)) {
      // Evidence beats prior — obligations stand (the source write must be governed).
      return { applied: false, wrote: true };
    }

    // No write → honor the no-code escape: zero completion obligations, silence.
    result.reasonCodes.length = 0;
    result.remediation.length = 0;
    if (result.detail) result.detail.missing = [];
    result.decision = 'allow';
    return { applied: true, wrote: false };
  } catch {
    return { applied: false, wrote: false }; // fail-open — never break the gate
  }
}

/**
 * WF-0069 / ADR-0133 knob 1 — advisory/shadow telemetry. Records the language-aware
 * classifier verdict against whether a write later occurred, so the no-code inversion
 * can be observed before any tightening (ADR-0131: "ship advisory-first with
 * telemetry"). Never blocks, never throws — a best-effort JSONL append.
 *
 * @param {string} root project root
 * @param {string} taskId active task id
 * @param {object|null} intent contract.signals.intent
 * @param {{ applied: boolean, wrote: boolean }} outcome from augmentWithLangAwareNoCode
 * @returns {void}
 */
function recordLangTelemetry(root, taskId, intent, outcome) {
  try {
    if (!intent) return;
    const line = JSON.stringify({
      ts: Date.now(),
      taskId,
      lang: intent.language?.lang ?? null,
      confidence: intent.confidence ?? null,
      verdict: intent.intent ?? null,
      mutationVerb: intent.mutationVerb === true,
      routeToAI: intent.routeToAI === true,
      wroteForTask: outcome.wrote === true,
      noCodeEscapeApplied: outcome.applied === true,
    });
    appendFileSync(join(root, 'contextkit', 'memory', 'lang-classifier-telemetry.jsonl'), line + '\n');
  } catch { /* telemetry is advisory — never break the gate */ }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  // Inert below Level 5.
  if (getLevel(ROOT) < 5) return;

  const raw = await readStdin();
  let payload = {};
  try {
    payload = raw ? JSON.parse(raw.replace(/^﻿/, '')) : {};
  } catch {
    return; // malformed stdin - fail-open
  }

  // Anti-loop guard (Stop hooks can re-trigger each other).
  if (payload.stop_hook_active === true) return;

  const sessionId = resolveHookSessionId(payload, HOST);
  const ledger = await readLedger(sessionId);

  // Only gate tasks that have been registered by the contract hook.
  const taskId = ledger.activeTask;
  if (typeof taskId !== 'string' || taskId.length === 0) return;

  const contract = loadContract(ROOT, taskId);
  if (!contract) return; // no contract on disk - silent

  // Debounce: warn at most once per session to avoid Stop-loop noise.
  if (typeof ledger.completionWarnedAt === 'number') return;

  const branch = currentBranch(ROOT) ?? 'unknown';
  const scope = {
    branch,
    taskId,
    paths: contract.signals?.paths ?? [],
  };

  const config = await loadConfig(ROOT);
  const mode = resolveEnforcementMode(config);

  const result = evaluateCompletion({ contract, scope, mode, root: ROOT });

  // WF0038 / ADR-0107 §13/§21 — planned-vs-actual orchestration check. A material
  // request may not complete with a required-but-unexecuted debate / specialist.
  augmentWithOrchestration(result, ROOT, taskId, mode);

  // ADR-0128 §20 (WF-0067) — Domain Engineering completion obligation. Config-gated
  // default-OFF; checks the profile-required agent spawn evidence (WF-0065). Isolated
  // fail-open so it can never break the live completion gate (immutable rule 2).
  augmentWithDomainCompletion(result, ROOT, taskId, config);

  // WF-0069 / ADR-0131 F-A + ADR-0133 knob 2 — language-aware no-code escape with an
  // always-on write authority. Runs LAST so it can clear the obligations the prior
  // augmentations added WHEN the task is genuinely no-code AND no write occurred for
  // the task; a real Edit/Write for the task (F-B taskId binding) revokes the prior,
  // so obligations stand. Never inverts on the domain axis. Fail-open.
  const langOutcome = augmentWithLangAwareNoCode(result, contract, ledger, taskId);
  // ADR-0133 knob 1 — advisory/shadow telemetry: classifier verdict vs whether a
  // write later occurred (the signal ADR-0131 requires before any tightening).
  recordLangTelemetry(ROOT, taskId, contract?.signals?.intent, langOutcome);

  // Silence rule: nothing to say - return immediately.
  if (result.reasonCodes.length === 0) return;

  // Mark BEFORE emitting to avoid re-entry if Claude stops again.
  ledger.completionWarnedAt = Date.now();
  await writeLedger(sessionId, ledger);

  if (mode === 'advisory' || result.decision !== 'deny') {
    emitAdvisory(buildAdvisoryText(result, taskId), HOST, 'Stop');
    return;
  }

  // Guarded / strict + deny -> block.
  emitBlockDecision(buildCompletionBlockText(result, taskId), HOST);
}

main().catch(() => process.exit(0));
