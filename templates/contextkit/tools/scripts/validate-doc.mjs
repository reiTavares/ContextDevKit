#!/usr/bin/env node
/**
 * `/validate-doc` — quality gate for OUR OWN planning artifacts (ADR-0030).
 *
 * Adapts EVO-METHOD/BMAD's `steps-v` document-validation chain (MIT) to
 * ContextDevKit's artifacts: an ADR must pose its problem, decide plainly, and own
 * its trade-offs; a roadmap must be measurable, not aspirational. The kit already
 * validates *code wiring* (selfcheck) — this validates the *prose* of the decisions
 * those tests are built on.
 *
 * Report-only by design (constitution §8 — never a false "pass", but also never a
 * push-blocker): it prints findings and exits non-zero only so CI *could* gate on
 * it; the slash command is advisory. Zero runtime deps (rule 1).
 *
 * Usage:
 *   node contextkit/tools/scripts/validate-doc.mjs <file.md>
 *   node contextkit/tools/scripts/validate-doc.mjs <file.md> --json
 *   node contextkit/tools/scripts/validate-doc.mjs --adr <file.md>      # force ADR rubric
 *   node contextkit/tools/scripts/validate-doc.mjs --roadmap <file.md>  # force roadmap rubric
 */
import { existsSync, readFileSync } from 'node:fs';
import { basename } from 'node:path';

/** Leftover template tokens that mean the artifact was never filled in. */
const PLACEHOLDERS = [/<short decision title>/i, /\bNNNN\b/, /YYYY-MM-DD/, /<who>/i, /<what we will do/i, /ADR-XXXX/];
/** Words that signal a real trade-off was considered (Consequences quality). */
const TRADEOFF_HINTS = /(trade-?off|negative|risk|harder|downside|we give up|cost)/i;
/** Tokens that make a roadmap line measurable rather than aspirational. */
const MEASURABLE_HINTS = /(\d|%|by\s+\w+|target|metric|KPI|reduce|increase|within|ship|release)/i;

/** Splits a markdown doc into `## Heading` → body. Zero-dep, defensive. */
function sections(text) {
  const out = {};
  const re = /^#{2,3}\s+(.+?)\s*$/gm;
  const heads = [];
  let m;
  while ((m = re.exec(text))) heads.push({ title: m[1].trim(), start: m.index + m[0].length });
  heads.forEach((h, i) => {
    const end = i + 1 < heads.length ? heads[i + 1].start : text.length;
    out[h.title.toLowerCase()] = text.slice(h.start, end).trim();
  });
  return out;
}

/** Detects the rubric to apply from the path + content. */
function detectType(file, text) {
  const name = basename(file).toLowerCase();
  if (/\/decisions\//.test(file.replace(/\\/g, '/')) || /^\d{4}-/.test(name) || /\*\*Status\*\*/i.test(text)) return 'adr';
  if (/roadmap/.test(name)) return 'roadmap';
  return 'generic';
}

function err(code, message) {
  return { level: 'error', code, message };
}
function warn(code, message) {
  return { level: 'warn', code, message };
}

/** ADR rubric — sections present, status valid, no placeholders, trade-offs owned. */
function validateAdr(text) {
  const findings = [];
  const sec = sections(text);
  const has = (name) => Object.keys(sec).some((k) => k === name || k.startsWith(name));
  for (const required of ['context', 'decision', 'consequences']) {
    if (!has(required)) findings.push(err('MISSING_SECTION', `ADR is missing a "## ${required[0].toUpperCase() + required.slice(1)}" section.`));
  }
  if (!/\*\*status\*\*\s*:/i.test(text)) findings.push(err('NO_STATUS', 'ADR has no "**Status**:" line.'));
  else if (!/\*\*status\*\*\s*:\s*(proposed|accepted|superseded)/i.test(text)) findings.push(warn('STATUS_VALUE', 'Status is not one of Proposed / Accepted / Superseded.'));
  for (const re of PLACEHOLDERS) {
    if (re.test(text)) findings.push(err('PLACEHOLDER', `Unfilled template placeholder still present: ${re}`));
  }
  const context = sec['context'] || '';
  if (context && context.length < 200) findings.push(warn('THIN_CONTEXT', `Context is thin (${context.length} chars) — it should state the forces WITHOUT already giving the answer.`));
  const consequences = Object.entries(sec).find(([k]) => k.startsWith('consequences'))?.[1] || '';
  if (consequences && !TRADEOFF_HINTS.test(consequences)) findings.push(warn('NO_TRADEOFFS', 'Consequences states no trade-off / negative / risk — a decision with only upsides is usually under-examined.'));
  if (!/follow-?up/i.test(text)) findings.push(warn('NO_FOLLOWUPS', 'No follow-ups noted — what does this decision obligate next?'));
  return findings;
}

/** Roadmap rubric — items exist and read as measurable, not aspirational. */
function validateRoadmap(text) {
  const findings = [];
  const items = text.split('\n').filter((l) => /^\s*[-*]\s+/.test(l) || /^\s*\d+\.\s+/.test(l));
  if (items.length === 0) findings.push(warn('NO_ITEMS', 'No list items detected — is the roadmap populated?'));
  const vague = items.filter((l) => l.replace(/^\s*[-*\d.]+\s*/, '').length > 12 && !MEASURABLE_HINTS.test(l));
  if (items.length && vague.length / items.length > 0.5) {
    findings.push(warn('NOT_MEASURABLE', `${vague.length}/${items.length} items read as aspirational (no number / date / target). Make outcomes measurable.`));
  }
  for (const re of PLACEHOLDERS) {
    if (re.test(text)) findings.push(warn('PLACEHOLDER', `Template placeholder still present: ${re}`));
  }
  return findings;
}

function validate(file, forced) {
  const text = readFileSync(file, 'utf-8').replace(/^﻿/, '');
  const type = forced || detectType(file, text);
  const findings = type === 'adr' ? validateAdr(text) : type === 'roadmap' ? validateRoadmap(text) : validateRoadmap(text);
  return { file, type, findings };
}

function main() {
  const argv = process.argv.slice(2);
  const wantJson = argv.includes('--json');
  let forced = null;
  if (argv.includes('--adr')) forced = 'adr';
  if (argv.includes('--roadmap')) forced = 'roadmap';
  const file = argv.find((a) => !a.startsWith('--'));
  if (!file) {
    console.error('Usage: validate-doc.mjs <file.md> [--adr|--roadmap] [--json]');
    process.exit(2);
  }
  if (!existsSync(file)) {
    console.error(`File not found: ${file}`);
    process.exit(2);
  }
  const report = validate(file, forced);
  const errors = report.findings.filter((f) => f.level === 'error');
  const warns = report.findings.filter((f) => f.level === 'warn');

  if (wantJson) {
    console.log(JSON.stringify({ ...report, errorCount: errors.length, warnCount: warns.length }, null, 2));
  } else {
    console.log(`\n📋 validate-doc — ${basename(file)} (${report.type} rubric)`);
    console.log('─'.repeat(56));
    if (report.findings.length === 0) console.log('  ✅ No issues — the artifact passes the rubric.');
    for (const f of errors) console.log(`  ❌ [${f.code}] ${f.message}`);
    for (const f of warns) console.log(`  ⚠️  [${f.code}] ${f.message}`);
    console.log(`\n  ${errors.length} error(s), ${warns.length} warning(s). (advisory — never blocks a push)`);
  }
  process.exit(errors.length > 0 ? 1 : 0);
}

main();
