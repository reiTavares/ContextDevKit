/**
 * resolveAutonomy — THE single read path for the autonomy dial (ADR-0042).
 *
 * The dial (`autonomy.grade`, ADR-0041) is a CONSENT axis: it decides what the
 * AI may do without asking, per `area`. Commands and /ship checkpoints consult
 * this resolver; hooks are grade-blind (they may call it for DISPLAY only,
 * never to weaken enforcement — selfcheck-gates pins both invariants).
 *
 * Contract (locked by ADR-0042 — extending `AREAS` requires an ADR):
 *   - Precedence, specific beats general: per-run flag (`context.flagGrade`) →
 *     session override → `config.autonomy.grade` → default 3 (ADR-0058).
 *   - The FLOOR clamps last and cannot be out-precedenced: secret-bearing paths
 *     (matchSecret), gate/hook self-edits, force-push, `adr` and `grade-change`
 *     resolve to `manual` at EVERY grade. Config may extend the floor
 *     (`autonomy.extraSecretPaths`), never remove from it.
 *   - Degenerate input fails safe: unparseable grade → 1; contradictions throw
 *     (constitution §8 — a validator, not a warner).
 *
 * `resolveAutonomy` is pure — callers load config and pass it in. The one I/O
 * companion lives here too (`readAutonomyOverride`) so the override file's
 * location + TTL semantics have exactly one owner (rule 4).
 */
import { join } from 'node:path';
import { matchSecret } from '../hooks/path-classification.mjs';
import { readJsonSafe } from '../hooks/safe-io.mjs';

/** Closed area enum (ADR-0042 §1; `swarm-dispatch` added by ADR-0051 §4). */
export const AREAS = Object.freeze([
  'edit', 'commit', 'push', 'pipeline-move', 'adr', 'session-log', 'ship-checkpoint', 'grade-change', 'swarm-dispatch',
]);

/** mode per area × grade 1..4 (floor applies AFTER this table). */
const MODE_TABLE = Object.freeze({
  edit: ['manual', 'suggest', 'auto', 'auto'],
  commit: ['manual', 'suggest', 'auto', 'auto'],
  push: ['manual', 'manual', 'manual', 'auto'], // grade-4 auto is branch-only, see below
  'pipeline-move': ['manual', 'suggest', 'auto', 'auto'],
  adr: ['manual', 'manual', 'manual', 'manual'],
  'session-log': ['manual', 'auto', 'auto', 'auto'],
  'ship-checkpoint': ['manual', 'manual', 'debate', 'debate'],
  'grade-change': ['manual', 'manual', 'manual', 'manual'],
  // ADR-0051: launching N parallel auto workstreams is a larger consent grant
  // than one pipeline-move — suggest at grade 3, auto only at grade 4.
  'swarm-dispatch': ['manual', 'manual', 'suggest', 'auto'],
});

/** First-person consequence text — single-sourced for /autonomy (both hosts) + onboarding (ADR-0042 §5). */
export const CONSEQUENCE_TEXT = Object.freeze({
  1: 'Grade 1 — Manual: I only act when you command. Every change is yours to initiate.',
  2: 'Grade 2 — Suggest: I propose edits and plans; you approve before anything lands.',
  3: 'Grade 3 — Auto except decisions (default): I edit, test, move pipeline cards and run /ship checkpoints through deliberation quorums without asking; ADRs, pushes and high-risk paths still come to you.',
  4: 'Grade 4 — Full-auto (EXPERIMENTAL): I push to feature branches autonomously; ADRs, secrets, force-push and merges to the default branch remain yours. Budget- and telemetry-gated (ADR-0045).',
});

/**
 * Reads the live session override (written by `/autonomy N --session`), or null
 * when absent/expired. The single owner of the file location + TTL semantics —
 * the setter writes it, every display/consumer surface reads it through here.
 *
 * @param {string} root project root
 * @returns {number|null}
 */
export function readAutonomyOverride(root) {
  const override = readJsonSafe(join(root, '.claude', '.workspace', 'autonomy-session.json'), null);
  if (!override || !Number.isInteger(override.grade)) return null;
  return Date.now() < Number(override.expiresAt || 0) ? override.grade : null;
}

function parseGrade(value) {
  const grade = Number(value);
  return Number.isInteger(grade) && grade >= 1 && grade <= 4 ? grade : null;
}

/** Floor check — returns the floor reason label, or null. Config can only ADD entries. */
function floorReason(area, context, config) {
  if (area === 'adr' || area === 'grade-change') return `floor:${area}-is-always-human`;
  if (area === 'push' && context.force) return 'floor:force-push';
  const path = typeof context.path === 'string' ? context.path.replaceAll('\\', '/') : '';
  if (path) {
    const secret = matchSecret(path, config?.autonomy?.extraSecretPaths ?? []);
    if (secret) return `floor:secret-path(${secret})`;
    if (path.includes('runtime/hooks/') || path.endsWith('.claude/settings.json')) return 'floor:gate-self-edit';
    // ADR-0045: the grade-4 eligibility evidence (readiness marker, drift log) is
    // an integrity-trusted artifact — an agent editing it would forge its own bar.
    if (path.includes('memory/autonomy/')) return 'floor:autonomy-evidence-self-edit';
  }
  return null;
}

/**
 * Resolves the effective autonomy for one action.
 *
 * @param {string} area one of `AREAS`
 * @param {object} [config] loaded contextkit config (callers own the I/O)
 * @param {number|null} [sessionOverride] grade set by `/autonomy N --session`
 * @param {{ flagGrade?: number, path?: string, force?: boolean, targetRef?: string, defaultBranch?: string, budgetExhausted?: boolean }} [context]
 *   `budgetExhausted` (ADR-0044 D3): the caller sets it true when the session has
 *   crossed `tokens.budgetPerSession` — at grade 4 it downgrades, never blocks.
 * @returns {{ grade: number, mode: 'manual'|'suggest'|'auto'|'debate', source: string, reason: string }}
 * @throws {TypeError} on an unknown area (closed enum) or a config contradiction
 */
export function resolveAutonomy(area, config = {}, sessionOverride = null, context = {}) {
  if (!AREAS.includes(area)) throw new TypeError(`resolveAutonomy: unknown area "${area}" — closed enum (ADR-0042): ${AREAS.join(', ')}`);

  let grade = parseGrade(context.flagGrade);
  let source = 'flag';
  if (grade === null) ({ grade, source } = { grade: parseGrade(sessionOverride), source: 'session' });
  if (grade === null) ({ grade, source } = { grade: parseGrade(config?.autonomy?.grade), source: 'config' });
  if (grade === null) ({ grade, source } = { grade: config?.autonomy?.grade === undefined ? 3 : 1, source: config?.autonomy?.grade === undefined ? 'default' : 'config-unparseable' });

  const floor = floorReason(area, context, config);
  if (floor) return { grade, mode: 'manual', source, reason: floor };

  // ADR-0044 D3: at grade 4 an exhausted token budget is a resolver precondition —
  // it returns grade-2 behaviour (`suggest`) so the run keeps moving with consent,
  // and NEVER blocks an edit (rule 2). The floor above still wins; lower grades are
  // already budget-warn-only, so this only bites at grade 4.
  if (grade === 4 && context.budgetExhausted) return { grade, mode: MODE_TABLE[area][1], source, reason: 'budget-exhausted' };

  let mode = MODE_TABLE[area][grade - 1];

  // Fail-closed (ADR-0045): grade 4 or any debate mode demands deliberations be EXPLICITLY active —
  // an absent/unknown flag is not "assumed on" (rule 8). Callers pass a merged config.
  if ((grade === 4 || mode === 'debate') && config?.deliberations?.active !== true)
    throw new TypeError(`resolveAutonomy: grade ${grade} with mode "${mode}" requires deliberations.active === true — contradiction (ADR-0042 §3 / ADR-0045)`);
  // ADR-0045 mechanics: grade-4 push is auto ONLY toward a non-default branch.
  if (area === 'push' && mode === 'auto') {
    const towardDefault = !context.targetRef || !context.defaultBranch || context.targetRef === context.defaultBranch;
    if (towardDefault) return { grade, mode: 'manual', source, reason: 'floor:default-branch-push-is-human' };
  }
  return { grade, mode, source, reason: `grade-${grade}:${area}` };
}
