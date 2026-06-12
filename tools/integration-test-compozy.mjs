#!/usr/bin/env node
/**
 * ContextDevKit integration test — COMPOZY follow-through features.
 *
 * Sibling of `integration-test-guards.mjs`. Extracted as a responsibility seam
 * (guards is for input-rejection safety nets; the Compozy follow-throughs are
 * positive-path lifecycle tests of new features). Mirrors the
 * ADR-0016/ticket-047 split pattern.
 *
 * Tickets covered: 041 (/workflow macro), 043 (distill-detect), 046 (/resume),
 * 057 (workflow spec packs).
 *
 * Run:  node tools/integration-test-compozy.mjs   (exit 0 = healthy)
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { KIT, run, reporter, git as gitRun } from './it-helpers.mjs';

const rep = reporter();
const { ok, bad } = rep;
console.log('\n🌀 ContextDevKit integration test — Compozy follow-throughs\n');

const importKit = (rel) => import('file://' + join(KIT, rel).replaceAll('\\', '/'));
const tmp = (tag) => mkdtempSync(join(tmpdir(), `contextkit-${tag}-`));

/** 041 — /workflow macro lifecycle: new → 3× advance → completion → status. */
function testWorkflowMacro() {
  const proj = tmp('wf');
  gitRun(['init', '-b', 'main'], proj);
  run([join(KIT, 'install.mjs'), '--target', proj, '--level', '5', '--name', 'WF', '--yes']);
  const cli = (...a) => run([join(proj, 'contextkit', 'tools', 'scripts', 'workflow.mjs'), ...a], { cwd: proj });
  cli('new', 'BAD!!').status === 1 ? ok('/workflow refuses invalid slug (ticket 041)') : bad('bad slug accepted');
  cli('new', 'demo', '--kind', 'feature').status === 0 &&
    existsSync(join(proj, 'contextkit/memory/workflows/demo/index.md')) &&
    existsSync(join(proj, 'contextkit/memory/workflows/demo/prd.md')) &&
    existsSync(join(proj, 'contextkit/memory/workflows/demo/spec.md'))
    ? ok('/workflow new creates a spec-pack folder (ADR-0057)') : bad('spec-pack missing');
  cli('new', 'demo').status === 1 ? ok('/workflow refuses duplicate slug') : bad('duplicate accepted');
  ['intake-ok', 'prd-v1', 'spec-v1', 'ADR-0057', 'P2.1', '[148]', 'ship-log', 'suite-green'].forEach((r) => cli('advance', 'demo', r));
  /complete/i.test(cli('advance', 'demo', 'qa-approved').stdout) ? ok('/workflow lifecycle completes after spec-pack phases (ADR-0057)') : bad('final advance missing complete');
  writeFileSync(join(proj, 'untracked-report-note.md'), 'new file should appear in workflow report\n');
  const report = cli('report', 'demo', '--task', '148');
  const reportPath = join(proj, 'contextkit/memory/workflows/demo/reports', `${new Date().toISOString().slice(0, 10)}.md`);
  report.status === 0 && existsSync(reportPath)
    ? ok('/workflow report writes a dated factual report (ADR-0057)') : bad(`report missing: ${report.stderr}${report.stdout}`);
  readFileSync(reportPath, 'utf-8').includes('untracked-report-note.md')
    ? ok('/workflow report includes untracked touched files (ADR-0057)') : bad('report omitted untracked files');
  writeFileSync(join(proj, 'contextkit/memory/workflows/legacy.md'), [
    '---',
    'slug: legacy',
    'started: 2026-01-01T00:00:00.000Z',
    'currentPhase: roadmap',
    'roadmap: pending',
    'adr: pending',
    'tickets: pending',
    'ship: pending',
    '---',
    '# Workflow - legacy',
    '',
  ].join('\n'));
  const data = JSON.parse(cli('status', '--json').stdout || '[]');
  const demo = data.find((w) => w.slug === 'demo');
  const legacy = data.find((w) => w.slug === 'legacy');
  demo?.format === 'pack' && demo.phases.prd.ref === 'prd-v1' && demo.phases.adr.ref === 'ADR-0057'
    ? ok('/workflow status surfaces spec-pack phases + refs (ADR-0057)') : bad(`status wrong: ${JSON.stringify(demo)}`);
  legacy?.format === 'legacy' && legacy.phases.roadmap.status === 'pending'
    ? ok('/workflow status remains compatible with legacy breadcrumbs') : bad(`legacy status wrong: ${JSON.stringify(legacy)}`);
  rmSync(proj, { recursive: true, force: true });
}

/** 043 — distill-detect surfaces rule-like phrases (positive + negative + skip-headers). */
async function testDistillDetect() {
  const mod = await importKit('templates/contextkit/tools/scripts/distill-detect.mjs');
  mod.detect('We decided that all auth flows must use refresh tokens. From now on, always validate JWTs.').length >= 2
    ? ok('distill-detect surfaces multiple rule-like phrases (ticket 043)') : bad('seeded sentence produced no candidates');
  mod.detect('Today we fixed a minor bug in the login flow.').length === 0
    ? ok('distill-detect is quiet on neutral narrative (ticket 043 false-positive guard)') : bad('neutral paragraph triggered a candidate');
  mod.detect('# We decided X\n> from now on Y').length === 0
    ? ok('distill-detect skips headings + blockquotes (ticket 043)') : bad('heading/blockquote triggered');
}

/** 046 — /resume lifecycle: list, refuse unknown, refuse claim conflict, happy path. */
function testResumeCommand() {
  const proj = tmp('resume');
  run([join(KIT, 'install.mjs'), '--target', proj, '--level', '5', '--name', 'ResumeIT', '--yes']);
  mkdirSync(join(proj, '.claude', '.sessions'), { recursive: true });
  mkdirSync(join(proj, '.claude', '.workspace'), { recursive: true });
  const sess = (id, extra) => JSON.stringify({ sessionId: id, startedAt: Date.now() - 3600000, modifications: [{ path: 'src/a.js', tool: 'Edit', at: Date.now() }], registered: false, stopWarnedAt: null, simulations: [], ...extra });
  const ws = (id, claims) => JSON.stringify({ sessionId: id, branch: 'main', user: 'rt', startedAt: Date.now() - 3600000, lastHeartbeat: Date.now(), claims });
  writeFileSync(join(proj, '.claude', '.sessions', 'sess-target.json'), sess('sess-target'));
  writeFileSync(join(proj, '.claude', '.workspace', 'sess-target.json'), ws('sess-target', [{ path: 'src/a.js', claimedAt: Date.now() }]));
  writeFileSync(join(proj, '.claude', '.sessions', 'sess-other.json'), sess('sess-other'));
  const cli = (...args) => run([join(proj, 'contextkit', 'tools', 'scripts', 'resume.mjs'), ...args], { cwd: proj });
  const listOut = cli();
  listOut.stdout.includes('sess-target') && listOut.stdout.includes('sess-other') ? ok('/resume lists unregistered drift candidates (ticket 046)') : bad(`list: ${listOut.stdout}`);
  const badId = cli('nope-not-real');
  badId.status === 1 && /not found among unregistered/.test(badId.stderr + badId.stdout) ? ok('/resume refuses unknown session id (rule 8)') : bad(`unknown-id: ${badId.stderr}`);
  writeFileSync(join(proj, '.claude', '.workspace', 'sess-active.json'), ws('sess-active', [{ path: 'src/a.js', claimedAt: Date.now() }]));
  const conflict = cli('sess-target');
  conflict.status === 1 && /claimed by another active session/.test(conflict.stderr + conflict.stdout) ? ok('/resume refuses cross-session claim conflict (ticket 046)') : bad(`conflict: ${conflict.stderr}`);
  writeFileSync(join(proj, '.claude', '.workspace', 'sess-active.json'), ws('sess-active', []));
  const happy = cli('sess-target');
  const pointer = existsSync(join(proj, '.claude', '.sessions', '.last-touched')) ? JSON.parse(readFileSync(join(proj, '.claude', '.sessions', '.last-touched'), 'utf-8')) : {};
  happy.status === 0 && pointer.sessionId === 'sess-target' ? ok('/resume rewrites .last-touched on success') : bad(`happy: status=${happy.status}, pointer=${JSON.stringify(pointer)}`);
  rmSync(proj, { recursive: true, force: true });
}

async function main() {
  testWorkflowMacro();
  await testDistillDetect();
  testResumeCommand();
  rep.finish('Integration (Compozy)');
}

main().catch((err) => {
  bad(`Compozy crashed: ${err?.stack || err}`);
  rep.finish('Integration (Compozy)');
});
