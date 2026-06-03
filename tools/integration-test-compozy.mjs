#!/usr/bin/env node
/**
 * VibeDevKit integration test — COMPOZY follow-through features.
 *
 * Sibling of `integration-test-guards.mjs`. Extracted as a responsibility seam
 * (guards is for input-rejection safety nets; the Compozy follow-throughs are
 * positive-path lifecycle tests of new features). Mirrors the
 * ADR-0016/ticket-047 split pattern.
 *
 * Tickets covered: 041 (/workflow macro), 043 (distill-detect), 046 (/resume).
 *
 * Run:  node tools/integration-test-compozy.mjs   (exit 0 = healthy)
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { KIT, run, reporter } from './it-helpers.mjs';

const rep = reporter();
const { ok, bad } = rep;
console.log('\n🌀 VibeDevKit integration test — Compozy follow-throughs\n');

const importKit = (rel) => import('file://' + join(KIT, rel).replaceAll('\\', '/'));
const tmp = (tag) => mkdtempSync(join(tmpdir(), `vibekit-${tag}-`));

/** 041 — /workflow macro lifecycle: new → 3× advance → completion → status. */
function testWorkflowMacro() {
  const proj = tmp('wf');
  run([join(KIT, 'install.mjs'), '--target', proj, '--level', '5', '--name', 'WF', '--yes']);
  const cli = (...a) => run([join(proj, 'vibekit', 'tools', 'scripts', 'workflow.mjs'), ...a], { cwd: proj });
  cli('new', 'BAD!!').status === 1 ? ok('/workflow refuses invalid slug (ticket 041)') : bad('bad slug accepted');
  cli('new', 'demo').status === 0 && existsSync(join(proj, 'vibekit/memory/workflows/demo.md')) ? ok('/workflow new creates breadcrumb (ticket 041)') : bad('breadcrumb missing');
  cli('new', 'demo').status === 1 ? ok('/workflow refuses duplicate slug') : bad('duplicate accepted');
  ['r1', 'ADR-0023', '[052]'].forEach((r) => cli('advance', 'demo', r));
  /complete/i.test(cli('advance', 'demo', 'merged').stdout) ? ok('/workflow lifecycle completes after 4 phases (ticket 041)') : bad('final advance missing complete');
  const data = JSON.parse(cli('status', '--json').stdout || '[]');
  data[0]?.slug === 'demo' && data[0].phases.roadmap.ref === 'r1' && data[0].phases.adr.ref === 'ADR-0023' ? ok('/workflow status surfaces phases + refs (ticket 041)') : bad(`status wrong: ${JSON.stringify(data[0])}`);
  rmSync(proj, { recursive: true, force: true });
}

/** 043 — distill-detect surfaces rule-like phrases (positive + negative + skip-headers). */
async function testDistillDetect() {
  const mod = await importKit('templates/vibekit/tools/scripts/distill-detect.mjs');
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
  const cli = (...args) => run([join(proj, 'vibekit', 'tools', 'scripts', 'resume.mjs'), ...args], { cwd: proj });
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
