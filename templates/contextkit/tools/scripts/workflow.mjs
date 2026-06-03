#!/usr/bin/env node
/**
 * `/workflow` — thin macro that chains `/roadmap` → `/new-adr` → `/pipeline`
 * → `/ship` into a single explicit narrative (ticket 041, Compozy follow-
 * through). The script does NOT invoke the other commands — Claude does that
 * by reading the slash-command briefing. This script owns the **breadcrumb
 * file** so the user can `/workflow status` or `/workflow resume <slug>`
 * across sessions / machines.
 *
 * Subcommands:
 *   workflow.mjs new <slug>          — create breadcrumb, set first phase pending
 *   workflow.mjs advance <slug> [ref] — mark current phase done, advance pointer
 *   workflow.mjs status              — list every workflow + its current phase
 *   workflow.mjs status <slug>       — show one workflow's breadcrumb
 *   workflow.mjs status --json       — machine-readable
 *
 * Breadcrumb path: `contextkit/memory/workflows/<slug>.md`. One file per slug;
 * the YAML-ish frontmatter is parsed by hand (no yaml dep). The body carries
 * one bullet per phase transition for human inspection.
 *
 * Zero-dep, pure ESM. Slug is kebab-case `[a-z0-9-]`.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathsFor } from '../../runtime/config/paths.mjs';

const ROOT = process.cwd();
const WF_DIR = resolve(pathsFor(ROOT).memory, 'workflows');
const PHASES = ['roadmap', 'adr', 'tickets', 'ship'];
const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,60}$/;

function ensureDir() { mkdirSync(WF_DIR, { recursive: true }); }

function fileFor(slug) { return resolve(WF_DIR, `${slug}.md`); }

/**
 * Parses the lightweight YAML-ish frontmatter. Recognises three top-level keys
 * (slug, started, currentPhase) + a `phases:` list with one entry per phase.
 * Body content after `---` is preserved on update so user notes survive.
 */
function parse(text) {
  const fmMatch = text.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!fmMatch) return null;
  const fm = fmMatch[1];
  const body = fmMatch[2] ?? '';
  const slug = (fm.match(/^slug:\s*(.+)$/m) || [])[1]?.trim();
  const started = (fm.match(/^started:\s*(.+)$/m) || [])[1]?.trim();
  const currentPhase = (fm.match(/^currentPhase:\s*(.+)$/m) || [])[1]?.trim();
  const phases = {};
  for (const p of PHASES) {
    const status = (fm.match(new RegExp(`^${p}:\\s*(\\S+)(?:\\s+(.+))?$`, 'm')) || [])[1]?.trim() || 'pending';
    const ref = (fm.match(new RegExp(`^${p}-ref:\\s*(.+)$`, 'm')) || [])[1]?.trim() || '';
    phases[p] = { status, ref };
  }
  return { slug, started, currentPhase, phases, body };
}

function render(wf) {
  const lines = ['---', `slug: ${wf.slug}`, `started: ${wf.started}`, `currentPhase: ${wf.currentPhase}`];
  for (const p of PHASES) { lines.push(`${p}: ${wf.phases[p].status}`); if (wf.phases[p].ref) lines.push(`${p}-ref: ${wf.phases[p].ref}`); }
  lines.push('---');
  lines.push('');
  lines.push(`# Workflow — ${wf.slug}`);
  lines.push('');
  // Strip a previous identical heading from the preserved body so re-rendering doesn't dup.
  const cleanBody = wf.body.replace(/^\s*#\s*Workflow\s+—\s+\S+\s*\n+/m, '').trim();
  lines.push(cleanBody || '_(history will accumulate here as phases advance)_');
  lines.push('');
  return lines.join('\n');
}

function appendHistory(wf, line) { wf.body = (wf.body.trim() ? wf.body.trim() + '\n' : '') + `- ${line}`; return wf; }

function cmdNew(slug) {
  if (!SLUG_RE.test(slug)) { console.error(`✗ slug must match ${SLUG_RE} (got "${slug}")`); process.exit(1); }
  ensureDir();
  if (existsSync(fileFor(slug))) { console.error(`✗ workflow "${slug}" already exists at ${fileFor(slug)}`); process.exit(1); }
  const started = new Date().toISOString();
  const wf = { slug, started, currentPhase: 'roadmap', phases: Object.fromEntries(PHASES.map((p) => [p, { status: 'pending', ref: '' }])), body: '' };
  appendHistory(wf, `${started.slice(0, 10)} · created · next phase: roadmap`);
  writeFileSync(fileFor(slug), render(wf));
  console.log(`▶  Workflow "${slug}" created. Next phase: /roadmap (then \`workflow.mjs advance ${slug} <ref>\`).`);
}

function cmdAdvance(slug, ref) {
  if (!existsSync(fileFor(slug))) { console.error(`✗ workflow "${slug}" not found.`); process.exit(1); }
  const wf = parse(readFileSync(fileFor(slug), 'utf-8'));
  if (!wf) { console.error(`✗ workflow "${slug}" has a malformed breadcrumb.`); process.exit(1); }
  const idx = PHASES.indexOf(wf.currentPhase);
  if (idx < 0) { console.error(`✗ workflow "${slug}" has an unknown currentPhase: ${wf.currentPhase}`); process.exit(1); }
  wf.phases[wf.currentPhase].status = 'done';
  if (ref) wf.phases[wf.currentPhase].ref = ref;
  const nextPhase = PHASES[idx + 1];
  const stamp = new Date().toISOString().slice(0, 10);
  if (!nextPhase) {
    wf.currentPhase = 'done';
    appendHistory(wf, `${stamp} · ${PHASES[idx]} done${ref ? ` (ref: ${ref})` : ''} · workflow complete`);
    writeFileSync(fileFor(slug), render(wf));
    console.log(`✅  Workflow "${slug}" complete — all 4 phases done.`);
    return;
  }
  wf.currentPhase = nextPhase;
  appendHistory(wf, `${stamp} · ${PHASES[idx]} done${ref ? ` (ref: ${ref})` : ''} · next phase: ${nextPhase}`);
  writeFileSync(fileFor(slug), render(wf));
  console.log(`▶  Workflow "${slug}" advanced — ${PHASES[idx]} → ${nextPhase}.`);
}

function listAll() {
  ensureDir();
  return readdirSync(WF_DIR).filter((f) => f.endsWith('.md') && f !== '.gitkeep')
    .map((f) => parse(readFileSync(resolve(WF_DIR, f), 'utf-8'))).filter(Boolean)
    .sort((a, b) => b.started.localeCompare(a.started));
}

function cmdStatus(target, asJson) {
  const all = listAll();
  const filtered = target && target !== '--json' ? all.filter((w) => w.slug === target) : all;
  if (asJson) { console.log(JSON.stringify(filtered, null, 2)); return; }
  if (filtered.length === 0) { console.log(target ? `  Workflow "${target}" not found.` : '  No workflows yet. Start one with `workflow.mjs new <slug>`.'); return; }
  for (const w of filtered) {
    console.log(`\n  ${w.slug} (started ${w.started.slice(0, 10)}) — current: ${w.currentPhase}`);
    for (const p of PHASES) {
      const s = w.phases[p];
      const marker = s.status === 'done' ? '✓' : s.status === 'in-progress' ? '◐' : '·';
      const refNote = s.ref ? ` → ${s.ref}` : '';
      console.log(`    ${marker} ${p.padEnd(8)} ${s.status}${refNote}`);
    }
  }
  console.log('');
}

const cmd = process.argv[2];
if (cmd === 'new') cmdNew(process.argv[3]);
else if (cmd === 'advance') cmdAdvance(process.argv[3], process.argv[4]);
else if (cmd === 'status') cmdStatus(process.argv[3], process.argv.includes('--json'));
else { console.error('Usage: workflow.mjs <new <slug> | advance <slug> [ref] | status [<slug> | --json]>'); process.exit(1); }
