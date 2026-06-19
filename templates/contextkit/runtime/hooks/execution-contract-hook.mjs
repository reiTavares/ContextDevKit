#!/usr/bin/env node
/**
 * UserPromptSubmit hook (Level >= 3) — generates an Execution Contract
 * for each incoming task prompt (CDK-031, ADR-0072).
 *
 * Advisory + dormant: this hook is UNREGISTERED by default (not wired into
 * settings-compose). Activation is a separate deliberate step. When active it
 * never blocks: any error exits 0 silently (immutable rule 2).
 *
 * Inert conditions (silent exit 0):
 *   - Level < 3.
 *   - Admin command: prompt starts with '/'.
 *   - Pure-conversation: very short or is a standalone question.
 *   - Payload has no extractable prompt text.
 *   - Any uncaught error (fail-open guarantee).
 *
 * On each genuine task prompt:
 *   1. Resolve session id + determine task id (new vs follow-up).
 *   2. Run intake() to get signals.
 *   3. buildContract(signals) then saveContract().
 *   4. Persist activeTask id back to the session ledger.
 *   5. Print a SHORT checklist to stdout (advisory context surface only).
 *
 * v1 contract strategy: a fresh contract is built and saved on every new
 * prompt (not reclassify()). Follow-ups share the same taskId so the gate
 * can load the contract but a fresh classify keeps the contract current.
 * This is intentionally simple -- reclassify() is the right tool once we
 * track receipt deltas (future card). Documented here so the next engineer
 * knows the choice was deliberate.
 */
import { join } from 'node:path';
import { getLevel, loadConfigSync } from '../config/load.mjs';
import { readLedger, writeLedger, sanitizeSid } from './ledger.mjs';
import { hookHost, resolveHookSessionId } from './host-adapter.mjs';
import { intake } from '../execution/task-intake.mjs';
import { buildContract, saveContract } from '../execution/execution-contract.mjs';
import { routePrompt } from '../execution/routing-runtime.mjs';
import { getBranch } from './boot-signals.mjs';
import { runMethodology } from '../execution/intake-methodology.mjs';

const ROOT = process.cwd();
const HOST = hookHost();
/** Canonical telemetry ledger consumed by `/token-report` (ADR-0094 §7). */
const ROUTING_LOG = join(ROOT, 'contextkit', 'memory', 'routing-decisions.jsonl');

// ---------------------------------------------------------------------------
// stdin reader (mirrors simulate-gate.mjs pattern)
// ---------------------------------------------------------------------------

/**
 * Reads stdin to exhaustion with a short timeout guard. Returns the raw string.
 * @returns {Promise<string>}
 */
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
// Prompt classification helpers (exported for selfcheck unit testing)
// ---------------------------------------------------------------------------

/**
 * Returns true when the prompt is an admin slash command (starts with '/').
 * Admin commands skip contract generation entirely.
 *
 * @param {string} prompt raw prompt text (already trimmed)
 * @returns {boolean}
 */
export function isAdminCommand(prompt) {
  return prompt.startsWith('/');
}

/**
 * Returns true when the prompt looks like pure conversation rather than a task.
 * Heuristic: very short prompts (<=20 chars) OR prompts that end with '?' and
 * are short (<=60 chars). These never need a contract.
 *
 * @param {string} prompt raw prompt text (already trimmed)
 * @returns {boolean}
 */
export function isPureConversation(prompt) {
  if (prompt.length <= 20) return true;
  if (prompt.endsWith('?') && prompt.length <= 60) return true;
  return false;
}

/**
 * NEW_TASK_VERBS -- imperative patterns that reliably indicate a new task
 * even within an ongoing session. Kept small and explicit (rule 3).
 */
const NEW_TASK_VERBS = [
  'implement', 'build', 'create', 'add ', 'refactor', 'migrate',
  'fix ', 'update ', 'write ', 'delete ', 'remove ', 'deploy',
  'now ', 'next ', "let's ", 'please ', 'can you ', 'could you ',
];

/**
 * Returns true when the prompt signals a genuinely new task (vs a follow-up
 * clarification within the same task). Used to decide whether to reuse the
 * existing activeTask id or mint a fresh one.
 *
 * Heuristic: a prompt containing at least one new-task verb is treated as a
 * new task. Conservative bias: false negatives (treating a new task as a
 * follow-up) produce no contract gap because the gate loads the contract by
 * taskId; an old contract for a new subtask is far less harmful than minting
 * duplicate tasks for every follow-up exchange.
 *
 * @param {string} prompt prompt text (lowercased internally)
 * @returns {boolean}
 */
export function looksLikeNewTask(prompt) {
  const lower = prompt.toLowerCase();
  return NEW_TASK_VERBS.some((v) => lower.includes(v));
}

/**
 * Derives a short deterministic task-counter suffix from the session ledger.
 * Reads the existing taskCounter field (default 0) and returns counter + 1.
 * This keeps task ids stable: task-<sessionShort>-<n>.
 *
 * @param {object} ledger current session ledger
 * @param {string} sessionShort first 8 chars of the sanitized session id
 * @returns {{ taskId: string, counter: number }}
 */
export function mintTaskId(ledger, sessionShort) {
  const counter = (typeof ledger.taskCounter === 'number' ? ledger.taskCounter : 0) + 1;
  return { taskId: `task-${sessionShort}-${counter}`, counter };
}

/**
 * Decides the task id for this prompt, applying the new-vs-follow-up heuristic.
 *
 * Rules (in order):
 *   1. No existing activeTask -- always mint a new task id.
 *   2. Prompt looks like a new task -- mint a new task id.
 *   3. Otherwise -- reuse the existing activeTask (follow-up).
 *
 * Returns the resolved task id, a flag, and the updated counter.
 *
 * @param {string} prompt trimmed prompt text
 * @param {object} ledger current session ledger
 * @param {string} sessionShort first 8 chars of sanitized session id
 * @returns {{ taskId: string, isNew: boolean, counter: number }}
 */
export function resolveTaskId(prompt, ledger, sessionShort) {
  const existingTask = typeof ledger.activeTask === 'string' ? ledger.activeTask : null;

  if (!existingTask || looksLikeNewTask(prompt)) {
    const { taskId, counter } = mintTaskId(ledger, sessionShort);
    return { taskId, isNew: true, counter };
  }

  return {
    taskId: existingTask,
    isNew: false,
    counter: typeof ledger.taskCounter === 'number' ? ledger.taskCounter : 1,
  };
}

// ---------------------------------------------------------------------------
// Checklist renderer (exported for test assertions)
// ---------------------------------------------------------------------------

/**
 * Formats a SHORT actionable checklist for the UserPromptSubmit surface.
 * Advisory only -- guidance, not a block. Maximum 8 lines so it never
 * overwhelms the agent context surface.
 *
 * @param {object} contract execution contract from buildContract()
 * @param {string} taskId resolved task id
 * @param {boolean} isNew true when a new task id was minted
 * @returns {string}
 */
export function renderChecklist(contract, taskId, isNew, routing = null) {
  const tier = contract.signals?.tier ?? 'unknown';
  const write = contract.requiredBeforeWrite ?? [];
  const complete = contract.requiredBeforeCompletion ?? [];
  const lines = [
    `[execution-contract] ${isNew ? 'New task' : 'Follow-up'}: ${taskId}`,
    `  Tier: ${tier}`,
  ];
  if (write.length > 0) {
    lines.push(`  Required before write: ${write.join(', ')}`);
  }
  if (complete.length > 0) {
    lines.push(`  Required before completion: ${complete.join(', ')}`);
  }
  if (write.length === 0 && complete.length === 0) {
    lines.push('  No required capabilities for this tier.');
  }
  // ADR-0094 routing surface — short, deterministic, recommendation-only (spec §6.4).
  if (routing && routing.active) {
    lines.push(`  Routing: ${routing.mode} — recommend ${routing.recommendedTier} · applied: no (${routing.reason})`);
  }
  return lines.join('\n') + '\n';
}

/**
 * Runs the ADR-0094 routing pass for a real prompt — classify, decide, record.
 * Best-effort and fail-open (immutable rule 2): any failure returns null and the
 * contract proceeds unchanged. Telemetry failure never blocks the user (spec §6.5).
 *
 * @param {string} promptText trimmed prompt
 * @param {string} sessionId resolved session id
 * @param {string} taskId resolved task id
 * @returns {object|null} routing summary ({ active, mode, recommendedTier, reason, summary }) or null
 */
function runRouting(promptText, signals, sessionId, taskId) {
  try {
    return routePrompt({
      promptText,
      intakeSignals: signals,
      sessionId,
      taskId,
      host: HOST,
      level: getLevel(ROOT),
      projectRouting: loadConfigSync(ROOT)?.routing,
      logFile: ROUTING_LOG,
      at: new Date().toISOString(),
    });
  } catch {
    return null; // routing is advisory; never break the prompt
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  // Inert below Level 3 (contracts are an L3+ concept).
  if (getLevel(ROOT) < 3) return;

  const raw = await readStdin();
  if (!raw) return;

  let payload;
  try {
    payload = JSON.parse(raw);
  } catch {
    return; // malformed stdin -- silent, fail-open
  }

  // Extract prompt text defensively from known UserPromptSubmit payload shapes.
  const promptText = (
    typeof payload?.prompt === 'string' ? payload.prompt :
    typeof payload?.user_prompt === 'string' ? payload.user_prompt :
    typeof payload?.input === 'string' ? payload.input :
    ''
  ).trim();

  if (!promptText) return; // no extractable prompt -- silent

  // Admin commands and pure-conversation prompts never need a contract.
  if (isAdminCommand(promptText)) return;
  if (isPureConversation(promptText)) return;

  // Resolve session id via the standard host-adapter chain.
  const sessionId = resolveHookSessionId(payload, HOST, ROOT);
  const sessionShort = sanitizeSid(sessionId).slice(0, 8);

  // Load the session ledger (never throws; returns freshLedger on failure).
  const ledger = await readLedger(sessionId);

  // Determine task id: new vs follow-up.
  const { taskId, isNew, counter } = resolveTaskId(promptText, ledger, sessionShort);

  // Resolve current git branch (best-effort; null is safe downstream).
  let branch = null;
  try { branch = getBranch(ROOT); } catch { /* silent */ }

  // Build signals via deterministic intake (no LLM).
  // Tests must use a tmp dir with no rubric file to stay hermetic.
  const { signals } = intake(
    { objective: promptText, taskId, sessionId, branch, level: getLevel(ROOT) },
    { root: ROOT },
  );

  // Build the execution contract, then run routing and attach its recommendation.
  const contract = buildContract(signals);
  const routing = runRouting(promptText, signals, sessionId, taskId);
  if (routing && routing.active) contract.routing = routing.summary;
  saveContract(ROOT, taskId, contract);

  // Persist the active task id and counter back to the session ledger.
  ledger.activeTask = taskId;
  ledger.taskCounter = counter;
  await writeLedger(sessionId, ledger);

  // Print the short advisory checklist to stdout (legacy output — unchanged).
  process.stdout.write(renderChecklist(contract, taskId, isNew, routing));

  // A2 (BIZ-0001/WF-0036, ADR-0102) — ADDITIVE, fail-open methodology surface.
  // Reads `signals.work` (A2-T1, never reclassifies), matches a Business for
  // operation-nature, persists a temporary intake proposal, and appends ONE
  // advisory line. Mirrors `runRouting`: null on any failure, legacy path above
  // already complete + byte-identical (rule 2); nothing surfaced if work absent.
  const methodology = runMethodology({ root: ROOT, taskId, objective: promptText, work: signals.work });
  if (methodology && methodology.line) process.stdout.write(`${methodology.line}\n`);
}

main().catch(() => process.exit(0));