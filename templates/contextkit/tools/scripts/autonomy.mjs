#!/usr/bin/env node
/**
 * `/autonomy` — show or change the autonomy dial (ADR-0041/0042, task 107).
 *
 * The dial is CONSENT (what the AI may do without asking), orthogonal to the
 * L1–L7 capability level. Reading goes through `resolveAutonomy`'s inputs;
 * this script is the only WRITER of `autonomy.grade` and the session override.
 *
 * Usage:
 *   autonomy.mjs                 show effective grade + consequence text
 *   autonomy.mjs <1-4>           persist the grade into contextkit/config.json
 *   autonomy.mjs <1-4> --session session-scoped override (expires in 8h / --clear)
 *   autonomy.mjs --clear         drop the session override
 *
 * Every change appends an audit line (ADR-0042 §4) to
 * contextkit/memory/autonomy-audit.jsonl — grade escalation is always a human
 * act; there is no code path here an agent can call without the human seeing
 * the consequence text echoed back.
 */
import { appendFileSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { loadConfigSync } from '../../runtime/config/load.mjs';
import { pathsFor } from '../../runtime/config/paths.mjs';
import { CONSEQUENCE_TEXT } from '../../runtime/config/resolve-autonomy.mjs';
import { writeFileAtomicSync, readJsonSafe } from '../../runtime/hooks/safe-io.mjs';

const ROOT = process.cwd();
const PATHS = pathsFor(ROOT);
const OVERRIDE_FILE = join(ROOT, '.claude', '.workspace', 'autonomy-session.json');
const AUDIT_FILE = join(PATHS.memory, 'autonomy-audit.jsonl');
const OVERRIDE_TTL_MS = 8 * 60 * 60 * 1000;

/** Returns the live session override grade, or null when absent/expired. */
export function readSessionOverride(root = ROOT) {
  const override = readJsonSafe(join(root, '.claude', '.workspace', 'autonomy-session.json'), null);
  if (!override || !Number.isInteger(override.grade)) return null;
  return Date.now() < Number(override.expiresAt || 0) ? override.grade : null;
}

function audit(from, to, scope) {
  const line = JSON.stringify({ ts: new Date().toISOString(), actor: 'human', from, to, scope });
  mkdirSync(dirname(AUDIT_FILE), { recursive: true });
  appendFileSync(AUDIT_FILE, line + '\n', 'utf-8');
}

function show(configGrade, overrideGrade) {
  const effective = overrideGrade ?? configGrade;
  console.log(`Autonomy grade: ${effective}${overrideGrade ? ` (session override; persisted: ${configGrade})` : ''}\n`);
  for (const grade of [1, 2, 3, 4]) {
    console.log(`${grade === effective ? '✓' : ' '} ${CONSEQUENCE_TEXT[grade]}`);
  }
  console.log('\nChange with: /autonomy <1-4> [--session]   ·   clear override: /autonomy --clear');
}

function main() {
  const argv = process.argv.slice(2);
  const config = loadConfigSync(ROOT);
  const configGrade = Number.isInteger(config?.autonomy?.grade) ? config.autonomy.grade : 2;
  const overrideGrade = readSessionOverride();

  if (argv.includes('--clear')) {
    if (overrideGrade !== null) {
      writeFileAtomicSync(OVERRIDE_FILE, JSON.stringify({ cleared: new Date().toISOString() }) + '\n');
      audit(overrideGrade, configGrade, 'session-clear');
      console.log(`✅ Session override cleared — back to persisted grade ${configGrade}.`);
    } else console.log('No active session override.');
    return;
  }

  const gradeArg = argv.find((a) => !a.startsWith('--'));
  if (gradeArg === undefined) {
    show(configGrade, overrideGrade);
    return;
  }
  const grade = Number(gradeArg);
  if (![1, 2, 3, 4].includes(grade)) {
    console.error('Autonomy grade must be 1, 2, 3 or 4. (Refused — constitution §8.)');
    process.exit(1);
  }

  if (argv.includes('--session')) {
    mkdirSync(dirname(OVERRIDE_FILE), { recursive: true });
    writeFileAtomicSync(OVERRIDE_FILE, JSON.stringify({ grade, setAt: new Date().toISOString(), expiresAt: Date.now() + OVERRIDE_TTL_MS }, null, 2) + '\n');
    audit(overrideGrade ?? configGrade, grade, 'session');
    console.log(`✅ Session override → grade ${grade} (auto-expires in 8h; /autonomy --clear to drop).\n\n${CONSEQUENCE_TEXT[grade]}`);
    return;
  }

  let raw = {};
  try {
    raw = JSON.parse(readFileSync(PATHS.config, 'utf-8').replace(/^﻿/, ''));
  } catch {
    /* fresh config */
  }
  raw.autonomy = { ...(raw.autonomy || {}), grade };
  delete raw.autonomy.level; // legacy key from the pre-ADR-0041 draft
  mkdirSync(dirname(PATHS.config), { recursive: true });
  writeFileAtomicSync(PATHS.config, JSON.stringify(raw, null, 2) + '\n');
  audit(configGrade, grade, 'persistent');
  console.log(`✅ Autonomy grade ${configGrade} → ${grade} (persisted).\n\n${CONSEQUENCE_TEXT[grade]}`);
  if (grade === 4) console.log('\n⚠️  Grade 4 is EXPERIMENTAL and telemetry/budget-gated (ADR-0045) — selectable, but /ship refuses full-auto until the eligibility bar holds.');
}

main();
