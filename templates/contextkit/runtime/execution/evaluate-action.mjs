/**
 * evaluate-action.mjs — Pure unified execution gate function (CDK-032, ADR-0072).
 *
 * `evaluateAction` is the single decision point that wraps the receipt-based
 * `decide()` substrate and adds two higher-level rules:
 *
 *   CDK-033 (workflow-before-write): feature/architectural writes require an
 *     active workflow before modifying source. The caller (wrapper hook) computes
 *     `projectState.activeWorkflow`; this function only reads it.
 *
 *   CDK-035 (exploration-budget): broad searches without a fresh project map and
 *     after the budget threshold are flagged to encourage `/project-map` first.
 *
 * Tool → Moment mapping (documented here as the naming authority):
 *   Read, Grep, Glob                       → beforeExploration
 *   Bash whose command is a broad tree search
 *     (grep -r / rg / find patterns)       → beforeExploration
 *   Edit, Write, MultiEdit                 → beforeWrite
 *   Bash that writes files (>, >>, tee,
 *     touch, cp, mv, rm patterns)          → beforeWrite
 *   Everything else                        → null (no gate)
 *
 * Advisory rule: in advisory mode, decision is NEVER 'deny'. The function
 * resolves 'warn' when reasonCodes are present, 'allow' when none.
 *
 * PURE FUNCTION — zero I/O, no Date.now(), no side effects. Callers supply all
 * state via parameters. Tests can drive every branch without touching the disk.
 *
 * Zero runtime deps — imports only the substrate modules from ./enforcement-modes.mjs.
 */
import { decide } from './enforcement-modes.mjs';

// ---------------------------------------------------------------------------
// Tool → Moment mapping
// ---------------------------------------------------------------------------

/**
 * Broad-search bash patterns: these signal "read the whole tree" and consume
 * the exploration budget. A narrow `grep src/foo.ts` does not qualify.
 */
const BROAD_BASH_READ_RE = /\b(grep\s+(-[A-Za-z]*\s+)*-[rR]|rg\b|find\s+\.?\s|find\s+\/)/;

/**
 * File-write bash patterns: these signal that Bash is mutating the filesystem.
 * Covers shell redirects, tee, cp, mv, rm, touch, node writes.
 */
const BASH_WRITE_RE = /[>]|tee\s|cp\s|mv\s|\brm\s|\btouch\s/;

/**
 * Maps a Claude Code tool name + its input to the lifecycle moment that the
 * gate checks, or null when the tool is not gated.
 *
 * @param {string|null} tool tool_name from the hook payload
 * @param {Record<string, any>} input tool_input from the hook payload
 * @returns {'beforeExploration'|'beforeWrite'|null}
 */
export function toolMoment(tool, input) {
  if (!tool) return null;

  switch (tool) {
    case 'Read':
    case 'Grep':
    case 'Glob':
      return 'beforeExploration';

    case 'Edit':
    case 'Write':
    case 'MultiEdit':
      return 'beforeWrite';

    case 'Bash': {
      const cmd = typeof input?.command === 'string' ? input.command : '';
      if (BROAD_BASH_READ_RE.test(cmd)) return 'beforeExploration';
      if (BASH_WRITE_RE.test(cmd)) return 'beforeWrite';
      return null;
    }

    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Default exploration budget
// ---------------------------------------------------------------------------

/** Default number of broad searches allowed before flagging stale project-map. */
const DEFAULT_EXPLORE_BUDGET = 2;

// ---------------------------------------------------------------------------
// Tier set that requires an active workflow before writing
// ---------------------------------------------------------------------------

const WORKFLOW_REQUIRED_TIERS = new Set(['feature', 'architectural']);

// ---------------------------------------------------------------------------
// Main pure decision function
// ---------------------------------------------------------------------------

/**
 * Unified execution gate decision.
 *
 * Composes the receipt-based `decide()` substrate with the two higher-level
 * rules (CDK-033 workflow-before-write, CDK-035 exploration-budget) and
 * normalises the combined result according to the enforcement mode.
 *
 * @param {{
 *   tool: string|null,
 *   input: Record<string, any>,
 *   contract: object|null,
 *   projectState: {
 *     scope: { branch: string, taskId: string, paths?: string[] },
 *     root: string,
 *     requiresHumanApproval?: boolean,
 *     activeWorkflow?: boolean,
 *     projectMapFresh?: boolean,
 *     broadSearchCount?: number,
 *     exploreBudget?: number
 *   },
 *   mode: 'advisory'|'guarded'|'strict'
 * }} params
 * @returns {{
 *   decision: 'allow'|'warn'|'deny',
 *   remediation: string[],
 *   reasonCodes: string[],
 *   detail: {
 *     moment: string|null,
 *     missing: string[],
 *     bypassed: string[],
 *     satisfied: string[]
 *   }
 * }}
 */
export function evaluateAction({ tool, input, contract, projectState, mode }) {
  const moment = toolMoment(tool, input ?? {});

  const emptyDetail = { moment, missing: [], bypassed: [], satisfied: [] };

  // No moment (unmonitored tool) or no contract → always allow silently.
  // Advisory with no contract is the typical unregistered-task state.
  if (moment === null || contract === null || contract === undefined) {
    return { decision: 'allow', remediation: [], reasonCodes: [], detail: emptyDetail };
  }

  const {
    scope,
    root,
    requiresHumanApproval = false,
    activeWorkflow = true,          // default true = no false positives when unknown
    projectMapFresh = true,         // default true = no false positives when unknown
    broadSearchCount = 0,
    exploreBudget = DEFAULT_EXPLORE_BUDGET,
  } = projectState ?? {};

  // --- Receipt-based decision (the substrate) ---
  const receiptVerdict = decide({ mode, contract, moment, scope, root, requiresHumanApproval });
  const reasonCodes = [];
  const remediation = [];

  // Carry receipt-level missing/bypassed/satisfied into detail.
  const detail = {
    moment,
    missing: receiptVerdict.missing,
    bypassed: receiptVerdict.bypassed,
    satisfied: receiptVerdict.satisfied,
  };

  // Map the receipt verdict to reason codes so downstream logic is uniform.
  if (receiptVerdict.missing.length > 0) {
    reasonCodes.push('receipt-missing');
    for (const cap of receiptVerdict.missing) {
      remediation.push(`Run /${cap} to satisfy the required capability before this ${moment} action.`);
    }
  }

  // --- CDK-033: workflow-before-write ---
  // A feature-or-architectural write requires an active workflow.
  if (
    moment === 'beforeWrite' &&
    WORKFLOW_REQUIRED_TIERS.has(contract.signals?.tier) &&
    !activeWorkflow
  ) {
    reasonCodes.push('workflow-missing');
    const tier = contract.signals.tier;
    const kind = tier === 'architectural' ? 'architecture' : 'feature';
    remediation.push(
      `No active workflow found for tier="${tier}". Start one with: node contextkit/tools/scripts/workflow.mjs new <slug> --kind ${kind}`
    );
  }

  // --- CDK-035: exploration-budget ---
  // Broad reads without a fresh project-map after the budget is depleted are flagged.
  if (
    moment === 'beforeExploration' &&
    isBroadSearch(tool, input ?? {}) &&
    !projectMapFresh &&
    broadSearchCount >= exploreBudget
  ) {
    reasonCodes.push('explore-budget');
    remediation.push(
      `Exploration budget (${exploreBudget} broad searches) exceeded and project-map is stale. Run /project-map to refresh context before continuing.`
    );
  }

  // --- Combine into final decision ---
  const finalDecision = combinedDecision(mode, reasonCodes, receiptVerdict.decision, moment);

  return { decision: finalDecision, remediation, reasonCodes, detail };
}

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

/**
 * Returns true when the tool call qualifies as a broad search (for CDK-035).
 * Read/Grep/Glob are always broad; Bash is only broad when it matches the
 * broad-read pattern.
 *
 * @param {string|null} tool
 * @param {Record<string, any>} input
 * @returns {boolean}
 */
function isBroadSearch(tool, input) {
  if (tool === 'Read' || tool === 'Grep' || tool === 'Glob') return true;
  if (tool === 'Bash') {
    const cmd = typeof input?.command === 'string' ? input.command : '';
    return BROAD_BASH_READ_RE.test(cmd);
  }
  return false;
}

/**
 * Translates (mode, reasonCodes, receiptDecision, moment) into the final gate decision.
 *
 * Advisory mode invariant: NEVER 'deny'. Any reasons → 'warn'. No reasons → 'allow'.
 * Guarded mode: 'deny' at beforeWrite when reasonCodes include write-level violations
 *   (receipt-missing or workflow-missing). 'warn' for exploration-budget.
 * Strict mode: 'deny' on any reasonCode.
 *
 * @param {'advisory'|'guarded'|'strict'} mode
 * @param {string[]} reasonCodes
 * @param {'allow'|'warn'|'deny'} receiptDecision the substrate verdict
 * @param {string|null} moment
 * @returns {'allow'|'warn'|'deny'}
 */
function combinedDecision(mode, reasonCodes, receiptDecision, moment) {
  if (reasonCodes.length === 0) return 'allow';

  switch (mode) {
    case 'advisory':
      // Immutable: advisory NEVER denies.
      return 'warn';

    case 'guarded': {
      // Write-level violations (receipt or workflow) at beforeWrite → deny.
      // Exploration-budget at beforeExploration → only warn.
      const hasWriteViolation =
        reasonCodes.includes('receipt-missing') || reasonCodes.includes('workflow-missing');
      if (moment === 'beforeWrite' && hasWriteViolation) return 'deny';
      // If the receipt substrate already decided deny (e.g. beforeCompletion), honour it.
      if (receiptDecision === 'deny') return 'deny';
      return 'warn';
    }

    case 'strict':
      // Zero tolerance: any reason code → deny.
      return 'deny';

    default:
      // Unknown mode falls to advisory-safe warn.
      return 'warn';
  }
}
