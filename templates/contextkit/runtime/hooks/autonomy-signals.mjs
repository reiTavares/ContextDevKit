/**
 * Autonomy display signals (ADR-0042 §6 / ADR-0043, task 112) — the dial's
 * DISPLAY-ONLY helpers consumed by the Stop hook (digest + nudges) and the
 * SessionStart hook (next-boot replay). Everything here derives from the
 * resolver and the event/audit substrate; nothing ever blocks, and no hook
 * branches its enforcement on the grade (grade-blind invariant — this module
 * renders, it never gates).
 *
 * Trust mechanics (UX voice, deliberation 06-H):
 *   - the Stop digest is the consent receipt (files + undo pointers) and is
 *     persisted so an unseen receipt REPLAYS at the next boot;
 *   - graduation is SUGGESTED, never auto-applied (≥ GRADUATE_MIN_TRANSITIONS
 *     evented transitions and zero recent QA bounces while at grade 2);
 *   - the step-down nudge fires after ≥ STEPDOWN_BOUNCES recent QA bounces at
 *     grade ≥3 — silent escalation OR silent struggling are both dark patterns.
 */
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { readAutonomyOverride, resolveAutonomy } from '../config/resolve-autonomy.mjs';
import { loadConfigSync } from '../config/load.mjs';
import { listStates } from '../state/state-io.mjs';
import { pathsFor } from '../config/paths.mjs';
import { pendingImportantPaths } from './ledger.mjs';

export const GRADUATE_MIN_TRANSITIONS = 10;
export const STEPDOWN_BOUNCES = 2;
const BOUNCE_WINDOW_MS = 14 * 24 * 60 * 60 * 1000;
const STEPDOWN_WINDOW_MS = 24 * 60 * 60 * 1000;
const GRADUATE_DEBOUNCE_MS = 7 * 24 * 60 * 60 * 1000;
const STEPDOWN_DEBOUNCE_MS = 24 * 60 * 60 * 1000;

const pendingFile = (root) => join(root, '.claude', '.workspace', 'autonomy-digest-pending.json');

function effectiveDial(root) {
  return resolveAutonomy('edit', loadConfigSync(root), readAutonomyOverride(root));
}

/** Debounce helper shared by the two nudges — returns true when allowed to fire (and stamps). */
function debounced(root, name, windowMs) {
  const stamp = join(root, '.claude', '.sessions', name);
  try {
    const last = Number.parseInt(readFileSync(stamp, 'utf-8').trim(), 10) || 0;
    if (Date.now() - last < windowMs) return false;
  } catch { /* no prior stamp */ }
  try {
    mkdirSync(dirname(stamp), { recursive: true });
    writeFileSync(stamp, String(Date.now()), 'utf-8');
    return true;
  } catch {
    return false;
  }
}

/**
 * Banner-header badge (task 108) — DISPLAY ONLY, derived from the resolver so
 * displayed grade ≡ enforced grade (ADR-0042 §6). Degrades to ''.
 */
export function autonomyBadge(root) {
  try {
    const dial = effectiveDial(root);
    return ` · Autonomy: \`A${dial.grade} ${dial.mode}\`${dial.source === 'session' ? ' (session)' : ''}`;
  } catch {
    return '';
  }
}

/**
 * The Stop-hook consent receipt (grade ≥3 only): files touched without
 * per-edit consent + undo pointers. Also persists the receipt so it replays at
 * the next boot if this emission goes unseen. Returns null when silent.
 */
export function autonomyDigest(root, ledger) {
  try {
    const dial = effectiveDial(root);
    if (dial.grade < 3) return null;
    const touched = pendingImportantPaths(ledger);
    if (touched.length === 0) return null;
    try {
      mkdirSync(dirname(pendingFile(root)), { recursive: true });
      writeFileSync(pendingFile(root), JSON.stringify({ ts: Date.now(), grade: dial.grade, files: touched.slice(0, 10) }, null, 2), 'utf-8');
    } catch { /* replay is best-effort */ }
    const list = touched.slice(0, 10).map((p) => `   - ${p}  (undo: git checkout -- "${p}")`).join('\n');
    const overflow = touched.length > 10 ? `\n   (… and ${touched.length - 10} more — see the session ledger)` : '';
    return [
      `🎚️ Autonomy digest (A${dial.grade}) — ${touched.length} file(s) changed without per-edit consent this session:`,
      list + overflow,
      '   Review or undo any line above. Grade: /autonomy · audit trail: contextkit/memory/autonomy-audit.jsonl',
    ].join('\n');
  } catch {
    return null;
  }
}

/**
 * SessionStart replay — shows (once) a consent receipt the user may not have
 * seen, then deletes it. Returns null when there is nothing pending.
 */
export function consumePendingDigest(root) {
  try {
    const file = pendingFile(root);
    if (!existsSync(file)) return null;
    const pending = JSON.parse(readFileSync(file, 'utf-8').replace(/^﻿/, ''));
    unlinkSync(file);
    if (!Array.isArray(pending.files) || pending.files.length === 0) return null;
    return [
      `## 🎚️ Unacknowledged autonomy receipt (A${pending.grade}, ${new Date(pending.ts).toISOString().slice(0, 16)})`,
      '',
      `The last grade-≥3 session changed ${pending.files.length} file(s) without per-edit consent:`,
      ...pending.files.map((p) => `  - ${p}`),
      '',
      '_Review with `git log`/`git diff`; undo any with `git checkout -- <path>`. Dial: `/autonomy`._',
    ].join('\n');
  } catch {
    return null;
  }
}

/**
 * Graduation / step-down nudges (suggest-only, debounced, never auto-applied).
 * Signals derive from the ADR-0043 event log: evented transitions and QA
 * bounces — the honest proxies available until richer approval capture exists.
 * Returns an array of 0–1 suggestion strings.
 */
export function autonomyNudges(root) {
  try {
    const dial = effectiveDial(root);
    const events = listStates(pathsFor(root).pipeline).flatMap((s) => s.events || []);
    if (events.length === 0) return [];
    const now = Date.now();
    const recentBounces = (windowMs) => events.filter((e) => e.actor === 'qa' && now - e.ts < windowMs).length;
    if (dial.grade >= 3 && recentBounces(STEPDOWN_WINDOW_MS) >= STEPDOWN_BOUNCES && debounced(root, '.autonomy-stepdown-nudge', STEPDOWN_DEBOUNCE_MS)) {
      return [`🎚️ ${recentBounces(STEPDOWN_WINDOW_MS)} QA bounces in 24h at grade ${dial.grade} — consider stepping the dial down (/autonomy 2) until the suite stabilizes. Suggestion only.`];
    }
    if (dial.grade === 2 && events.length >= GRADUATE_MIN_TRANSITIONS && recentBounces(BOUNCE_WINDOW_MS) === 0 && debounced(root, '.autonomy-graduate-nudge', GRADUATE_DEBOUNCE_MS)) {
      return [`🎚️ ${events.length} evented transitions with zero QA bounces in 14d at grade 2 — if the supervision feels redundant, grade 3 automates edits/tests while decisions still come to you (/autonomy 3, or try /autonomy 3 --session). Suggestion only — never auto-applied.`];
    }
    return [];
  } catch {
    return [];
  }
}
