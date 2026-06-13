#!/usr/bin/env node
/**
 * PreToolUse hook (Level >= 5) — deliberation nudge on high-risk paths (ADR-0035).
 *
 * Wired with matcher `Edit|Write|MultiEdit`. When the edited file matches the
 * `l5.highRiskPaths` allowlist AND deliberations are enabled, it emits a SOFT,
 * once-per-session suggestion to run `/debate` before committing to a design
 * choice with this much blast radius. This is the deterministic SECOND trigger
 * from ADR-0035 (the first is an explicit `/debate`).
 *
 * It NEVER blocks (no `decision: block`) — the edit always proceeds (immutable
 * rule 2). It only writes a banner that becomes context, exactly like the L3
 * concurrency-guard. The high-risk path set is single-sourced from
 * `l5.highRiskPaths` (same matcher as `simulate-gate`, so both triggers agree on
 * what "high-risk" means).
 *
 * Gated by: `deliberations.active` && `deliberations.nudgeOnHighRisk` &&
 * `getLevel >= deliberations.minLevel`. Debounced via a per-session marker so a
 * burst of edits nudges at most once. Defensive: any error exits 0 silently.
 */
import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { getLevel, loadConfig } from '../config/load.mjs';
import { writeFileAtomic } from './safe-io.mjs';
import { sanitizeSid, SESSIONS_DIR, toRepoRelative } from './ledger.mjs';
import { emitAdvisory, hookHost, normalizeToolPayload, resolveHookSessionId } from './host-adapter.mjs';

const ROOT = process.cwd();
const HOST = hookHost();

async function readStdin() {
  return new Promise((res) => {
    let buf = '';
    process.stdin.setEncoding('utf-8');
    process.stdin.on('data', (c) => (buf += c));
    process.stdin.on('end', () => res(buf));
    setTimeout(() => res(buf), 500).unref?.();
  });
}

/** Returns the matching high-risk entry (or null) — same semantics as simulate-gate. */
function matchHighRisk(targetPath, highRiskPaths) {
  if (!Array.isArray(highRiskPaths)) return null;
  for (const entry of highRiskPaths) {
    if (typeof entry !== 'string' || entry.length === 0) continue;
    if (entry.endsWith('/')) {
      if (targetPath.startsWith(entry)) return entry;
    } else if (targetPath === entry) {
      return entry;
    }
  }
  return null;
}

/** Per-session debounce marker — sanitized so a session id can't escape the dir. */
function nudgeMarkerPath(sessionId) {
  return resolve(SESSIONS_DIR, `${sanitizeSid(sessionId)}.deliberation-nudged`);
}

function buildNudge(targetPath, matchedEntry) {
  return [
    '<deliberation-nudge>',
    `🗣️  High-risk path \`${targetPath}\` (matches \`${matchedEntry}\`).`,
    '   Before committing to an approach with this much blast radius, consider a',
    '   quick `/debate "<the design question>"` — independent voices argue it, a',
    '   synthesizer converges, and the result can pre-fill an ADR. Suggestion only;',
    '   this never blocks. Mute via `deliberations.nudgeOnHighRisk: false`.',
    '</deliberation-nudge>',
  ].join('\n');
}

/** A new/edited ADR under memory/decisions/ — the decision-deliberation context (ADR-0070). */
function isNewDecision(targetPath) {
  return targetPath.includes('memory/decisions/') && targetPath.endsWith('.md') && !targetPath.includes('_TEMPLATE');
}

function buildDecisionNudge(targetPath) {
  return [
    '<deliberation-nudge>',
    `🗣️  New decision record \`${targetPath}\`.`,
    '   A strategic decision should be argued before it hardens — consider running',
    '   `/debate "<the decision question>"` FIRST: a specialist council debates it,',
    '   cheap scouts gather the evidence, and the synthesis pre-fills this ADR',
    '   (ADR-0070). Suggestion only; never blocks. Mute via `deliberations.autoInvoke.decision: false`.',
    '</deliberation-nudge>',
  ].join('\n');
}

async function main() {
  const config = await loadConfig(ROOT);
  const delib = config?.deliberations ?? {};
  if (delib.active === false) return;
  const minLevel = typeof delib.minLevel === 'number' ? delib.minLevel : 5;
  if (getLevel(ROOT) < minLevel) return;

  const raw = await readStdin();
  if (!raw) return;
  let payload;
  try {
    payload = JSON.parse(raw);
  } catch {
    return;
  }

  const filePath = normalizeToolPayload(payload).filePaths[0];
  if (!filePath) return;
  const targetPath = toRepoRelative(filePath);
  if (!targetPath) return;

  // Two deterministic contexts (ADR-0035 high-risk path + ADR-0070 new decision).
  const highRisk = delib.nudgeOnHighRisk === false ? null : matchHighRisk(targetPath, config?.l5?.highRiskPaths ?? []);
  const decision = delib.autoInvoke?.decision !== false && isNewDecision(targetPath);
  if (!highRisk && !decision) return;

  // Debounce: nudge at most once per session (a burst of edits stays quiet).
  const marker = nudgeMarkerPath(resolveHookSessionId(payload, HOST));
  if (existsSync(marker)) return;

  emitAdvisory(highRisk ? buildNudge(targetPath, highRisk) : buildDecisionNudge(targetPath), HOST);
  try {
    await mkdir(SESSIONS_DIR, { recursive: true });
    await writeFileAtomic(marker, String(Date.now()));
  } catch {
    /* a failed marker only means we might nudge once more — never fatal */
  }
}

main().catch((err) => {
  process.stderr.write(`[deliberation-nudge] ${err?.message ?? err}\n`);
  process.exit(0);
});
