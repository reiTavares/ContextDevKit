#!/usr/bin/env node
/**
 * Arch-debt pre-coding law delivery (OP-0012, ADR-0122 §9 / ADR-0143).
 *
 * WHY THIS EXISTS. The architecture-debt gate runs AFTER the diff exists. A
 * verifier alone makes the loop slow and adversarial: the agent writes, CI
 * refuses, the agent reworks. The standard is far cheaper to meet in the diff
 * being written than in a rework after refusal — so this hook states the twelve
 * dimensions as LAW at the moment of the FIRST source write of the session.
 *
 * ADVISORY BY DESIGN — it never blocks. That is deliberate and is NOT a weakening
 * of the gate: blocking here would be blocking on *not having been told yet*,
 * which punishes the agent for the platform's own omission. Enforcement belongs
 * to the gate, which evaluates real evidence (`architecture-debt-gate.mjs --ci`).
 * This hook's job is that the standard is never a surprise.
 *
 * ONCE PER SESSION. The brief is delivered on the first source write and then
 * debounced via a per-session marker, so it informs without becoming noise that
 * gets ignored (the failure mode of a nag that fires on every edit).
 *
 * SOURCE WRITES ONLY. A docs/memory edit carries no architectural weight, so
 * `isSourceWrite` (reused from the no-code prior, not reimplemented) decides. An
 * unknown path counts as source — the safe direction is to inform, not to skip.
 *
 * Hot-path safe: `runtime/execution/arch-debt-law.mjs` and `no-code-prior.mjs`
 * are pure, zero-dep, `node:*`-free data/predicate modules.
 *
 * Exits 0 on every path (immutable rule 2).
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { getLevel, loadConfigSync } from '../config/load.mjs';
import { PLATFORM_DIR } from '../config/paths.mjs';
import { renderPrecodeLaw } from '../execution/arch-debt-law.mjs';
import { isSourceWrite } from '../execution/no-code-prior.mjs';
import {
  AGY_WRITE_TOOLS, emitAdvisory, hookHost, normalizeToolPayload, resolveHookSessionId,
} from './host-adapter.mjs';
import { sanitizeSid, SESSIONS_DIR } from './ledger.mjs';

const ROOT = process.cwd();
const HOST = hookHost();

/** The gate itself is an L>=4 capability; below that the law is not delivered. */
const MIN_LEVEL = 4;

/**
 * Every host's write tools. Claude/Codex normalize onto `Edit`/`Write`/`MultiEdit`
 * (Codex `apply_patch` included, via `normalizeToolPayload`), while Antigravity
 * keeps its OWN tool names — so hardcoding only the Claude triple would register
 * the hook on all three hosts and silently deliver the law on just two. The law
 * must be identical on every host, so the agy names are part of the set rather
 * than a separate branch.
 */
const WRITE_TOOLS = Object.freeze(['Edit', 'Write', 'MultiEdit', ...AGY_WRITE_TOOLS]);

/** Per-session delivery marker — sanitized so a session id cannot escape the dir. */
function markerPath(sessionId) {
  return resolve(SESSIONS_DIR, `${sanitizeSid(sessionId)}.arch-debt-law`);
}

/**
 * Records that the law was delivered for this session. A failed marker write only
 * means the brief may repeat — harmless, so it is swallowed rather than risking a
 * broken write.
 *
 * @param {string} sessionId active session id
 */
function recordDelivery(sessionId) {
  try {
    mkdirSync(SESSIONS_DIR, { recursive: true });
    writeFileSync(markerPath(sessionId), JSON.stringify({ at: Date.now() }), 'utf-8');
  } catch {
    /* re-delivery is noise, never a correctness problem */
  }
}

/**
 * PURE decision core — should the law be delivered for this call? Kept separate
 * from all I/O so every branch is unit-testable without a project tree.
 *
 * @param {object} input
 * @param {number} input.level resolved capability level
 * @param {boolean} input.alreadyDelivered marker present for this session
 * @param {string} input.toolName the tool being invoked
 * @param {string[]} input.filePaths the tool's target paths
 * @returns {{deliver:boolean, reason:string}}
 */
export function decideDelivery({ level, alreadyDelivered, toolName, filePaths }) {
  if (typeof level !== 'number' || level < MIN_LEVEL) {
    return { deliver: false, reason: `level < ${MIN_LEVEL}` };
  }
  if (!WRITE_TOOLS.includes(toolName)) {
    return { deliver: false, reason: 'not a write tool' };
  }
  if (alreadyDelivered) return { deliver: false, reason: 'already delivered this session' };
  const paths = Array.isArray(filePaths) ? filePaths : [];
  if (paths.length === 0) return { deliver: false, reason: 'no target path' };
  if (!paths.some((path) => isSourceWrite(path))) {
    return { deliver: false, reason: 'non-source write (docs/memory)' };
  }
  return { deliver: true, reason: 'first source write of the session' };
}

/**
 * Resolve the posture the gate will ACTUALLY apply, so the brief never overstates
 * nor understates what is enforced. Falls back to the shipped default.
 *
 * @param {string} root project root
 * @returns {string} the resolved posture
 */
function resolvePosture(root) {
  try {
    const gate = loadConfigSync(root)?.architectureDebtGate;
    if (gate && gate.enabled === false) return 'advisory';
    if (gate && typeof gate.enforcement === 'string') return gate.enforcement;
  } catch {
    /* keep the guarded default — the shipped default posture */
  }
  return 'guarded';
}

async function readStdin() {
  return new Promise((res) => {
    let buf = '';
    process.stdin.setEncoding('utf-8');
    process.stdin.on('data', (chunk) => (buf += chunk));
    process.stdin.on('end', () => res(buf));
    setTimeout(() => res(buf), 500).unref?.();
  });
}

async function main() {
  const raw = await readStdin();
  if (!raw) return;
  let payload;
  try {
    payload = JSON.parse(raw);
  } catch {
    return;
  }

  const { toolName, filePaths } = normalizeToolPayload(payload);
  const sessionId = resolveHookSessionId(payload, HOST, ROOT);
  const decision = decideDelivery({
    level: getLevel(ROOT),
    alreadyDelivered: existsSync(markerPath(sessionId)),
    toolName,
    filePaths,
  });
  if (!decision.deliver) return;

  emitAdvisory(
    renderPrecodeLaw({ posture: resolvePosture(ROOT), platformDir: PLATFORM_DIR }),
    HOST,
    'PreToolUse',
  );
  recordDelivery(sessionId);
}

// Run ONLY as a hook process, never on import (the pure core is imported by the
// selftest; an unguarded main() would read stdin from a test).
if (process.argv[1] && process.argv[1].split(/[\\/]/).pop() === 'arch-debt-law-gate.mjs') {
  main().catch((err) => {
    process.stderr.write(`[arch-debt-law-gate] ${err?.message ?? err}\n`);
    process.exit(0);
  });
}
