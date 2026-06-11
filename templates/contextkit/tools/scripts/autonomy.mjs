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
 *   autonomy.mjs <1-3>           persist the grade into contextkit/config.json
 *   autonomy.mjs <1-3> --session session-scoped override (expires in 8h / --clear)
 *   autonomy.mjs 4               grade 4 is SESSION-scoped by default (ADR-0045 §3)
 *   autonomy.mjs 4 --persist --confirm   persist grade 4 (after seeing the consequence)
 *   autonomy.mjs --clear         drop the session override
 *
 * Grade 4 (ADR-0045) is gated: the deterministic eligibility bar must hold or the
 * command REFUSES naming the failing criterion (rule 8). Every change appends an
 * audit line (ADR-0042 §4) to contextkit/memory/autonomy-audit.jsonl — grade
 * escalation is always a human act; no code path here an agent can call without
 * the human seeing the consequence text echoed back.
 */
import { appendFileSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { loadConfigSync } from '../../runtime/config/load.mjs';
import { pathsFor } from '../../runtime/config/paths.mjs';
import { CONSEQUENCE_TEXT, readAutonomyOverride } from '../../runtime/config/resolve-autonomy.mjs';
import { checkEligibility } from '../../runtime/config/autonomy-eligibility.mjs';
import { writeFileAtomicSync } from '../../runtime/hooks/safe-io.mjs';

const ROOT = process.cwd();
const PATHS = pathsFor(ROOT);
const OVERRIDE_FILE = join(ROOT, '.claude', '.workspace', 'autonomy-session.json');
const AUDIT_FILE = join(PATHS.memory, 'autonomy-audit.jsonl');
const OVERRIDE_TTL_MS = 8 * 60 * 60 * 1000;

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
  console.log('\nChange with: /autonomy <1-3> [--session]  ·  grade 4: /autonomy 4 (session) | --persist --confirm  ·  clear: /autonomy --clear');
}

/** Writes the session-scoped override (8h TTL) and audits it. */
function setSessionOverride(grade, from) {
  mkdirSync(dirname(OVERRIDE_FILE), { recursive: true });
  writeFileAtomicSync(OVERRIDE_FILE, JSON.stringify({ grade, setAt: new Date().toISOString(), expiresAt: Date.now() + OVERRIDE_TTL_MS }, null, 2) + '\n');
  audit(from, grade, 'session');
}

/** Persists the grade into config.json (drops the legacy `level` key) and audits it. */
function persistGrade(grade, from) {
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
  audit(from, grade, 'persistent');
}

/**
 * Grade-4 path (ADR-0045): refuse unless the eligibility bar holds; default to a
 * SESSION override; persisting needs `--persist --confirm` after the consequence
 * is shown. Returns the process exit code.
 */
function setGradeFour(argv, from) {
  const { eligible, failing } = checkEligibility(ROOT);
  if (!eligible) {
    console.error('⛔ Grade 4 refused — eligibility bar not met (ADR-0045 §1):');
    for (const f of failing) console.error(`   ✗ ${f}`);
    console.error('\nAccrue more evented work and run /autonomy-readiness, then retry. (Refused — rule 8.)');
    return 1;
  }
  if (!argv.includes('--persist')) {
    setSessionOverride(4, from);
    console.log(`✅ Grade 4 (EXPERIMENTAL) set for THIS session only — auto-expires in 8h, /autonomy --clear to drop now.\n\n${CONSEQUENCE_TEXT[4]}`);
    return 0;
  }
  if (!argv.includes('--confirm')) {
    console.log(`${CONSEQUENCE_TEXT[4]}\n`);
    console.log('⚠️  --persist makes grade 4 the standing default across sessions. Re-run with `--persist --confirm` to apply, or omit --persist for a session-only grade 4.');
    return 1; // refuse-by-default until the human confirms
  }
  persistGrade(4, from);
  console.log(`✅ Autonomy grade ${from} → 4 (persisted, EXPERIMENTAL).\n\n${CONSEQUENCE_TEXT[4]}`);
  return 0;
}

function main() {
  const argv = process.argv.slice(2);
  const config = loadConfigSync(ROOT);
  const configGrade = Number.isInteger(config?.autonomy?.grade) ? config.autonomy.grade : 2;
  const overrideGrade = readAutonomyOverride(ROOT);

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

  // Grade 4 has its own gated, session-default path (ADR-0045 §1/§3).
  if (grade === 4) {
    process.exit(setGradeFour(argv, overrideGrade ?? configGrade));
  }

  if (argv.includes('--session')) {
    setSessionOverride(grade, overrideGrade ?? configGrade);
    console.log(`✅ Session override → grade ${grade} (auto-expires in 8h; /autonomy --clear to drop).\n\n${CONSEQUENCE_TEXT[grade]}`);
    return;
  }

  persistGrade(grade, configGrade);
  console.log(`✅ Autonomy grade ${configGrade} → ${grade} (persisted).\n\n${CONSEQUENCE_TEXT[grade]}`);
}

main();
