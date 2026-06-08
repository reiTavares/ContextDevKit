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
import { resolveSessionId, sanitizeSid, SESSIONS_DIR, toRepoRelative } from './ledger.mjs';

const ROOT = process.cwd();

async function readStdin() {
  return new Promise((res) => {
    let buf = '';
    process.stdin.setEncoding('utf-8');
    process.stdin.on('data', (c) => (buf += c));
    process.stdin.on('end', () => res(buf));
    setTimeout(() => res(buf), 500).unref?.();
  });
}

function extractFilePath(payload) {
  const tool = payload?.tool_name;
  const input = payload?.tool_input ?? {};
  if ((tool === 'Edit' || tool === 'Write' || tool === 'MultiEdit') && typeof input.file_path === 'string') {
    return input.file_path;
  }
  return null;
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

async function main() {
  const config = await loadConfig(ROOT);
  const delib = config?.deliberations ?? {};
  if (delib.active === false || delib.nudgeOnHighRisk === false) return;
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

  const filePath = extractFilePath(payload);
  if (!filePath) return;
  const targetPath = toRepoRelative(filePath);
  if (!targetPath) return;

  const matched = matchHighRisk(targetPath, config?.l5?.highRiskPaths ?? []);
  if (!matched) return;

  // Debounce: nudge at most once per session (a burst of edits stays quiet).
  const marker = nudgeMarkerPath(resolveSessionId(payload));
  if (existsSync(marker)) return;

  process.stdout.write(buildNudge(targetPath, matched));
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
