#!/usr/bin/env node
/**
 * ContextDevKit integration test - active squad posture gates.
 *
 * Covers the target-scoped guard/audit contract and the explicit
 * `squad activate` path that records postures in the current session ledger.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { git, installFixture, reporter, run } from './it-helpers.mjs';

const rep = reporter();
const { ok, bad } = rep;
console.log('\nContextDevKit integration test - active squads\n');

const fx = installFixture(rep);
const { proj } = fx;
const ctx = (...args) => run([join(proj, 'ctx.mjs'), ...args], { cwd: proj });

function trackAgyEdit(path) {
  run([join(proj, 'contextkit', 'runtime', 'hooks', 'track-edits.mjs'), '--host', 'agy'], {
    cwd: proj,
    input: JSON.stringify({ toolCall: { name: 'write_to_file', args: { TargetFile: path } } }),
  });
}

function markSimulation(objective, path) {
  return run([join(proj, 'contextkit', 'tools', 'scripts', 'mark-simulation.mjs'), objective, path], { cwd: proj });
}

try {
  writeFileSync(join(proj, 'README.md'), '# Active Squads Probe\n');
  git(['add', 'README.md'], proj);
  git(['commit', '-m', 'feat: initial commit', '--no-verify'], proj);

  const cfgPath = join(proj, 'contextkit', 'config.json');
  const cfg = JSON.parse(readFileSync(cfgPath, 'utf-8'));
  cfg.l5.highRiskPaths = ['src/auth/', 'src/secure/', 'prisma/schema.prisma'];
  writeFileSync(cfgPath, JSON.stringify(cfg, null, 2));

  run([join(proj, 'contextkit', 'runtime', 'antigravity', 'session-manager.mjs'), 'start'], { cwd: proj });
  const agySid = JSON.parse(readFileSync(join(proj, '.claude', '.sessions', '.agy-active.json'), 'utf-8')).sid;

  const authPath = 'src/auth/login.js';
  mkdirSync(join(proj, 'src', 'auth'), { recursive: true });
  writeFileSync(join(proj, authPath), 'export const login = () => true;\n');
  git(['add', authPath], proj);
  trackAgyEdit(authPath);

  const noSimulation = ctx('guard', authPath);
  noSimulation.status === 1 && /BLOCKED/i.test(noSimulation.stdout)
    ? ok('guard blocks src/auth/login.js before simulation')
    : bad(`guard did not block unsimulated auth path: ${noSimulation.status} ${noSimulation.stdout}`);

  markSimulation('cover auth login', authPath);
  const noPosture = ctx('guard', authPath);
  noPosture.status === 1 && /active squad compliance audit failed|BLOCKED/i.test(noPosture.stdout + noPosture.stderr)
    ? ok('simulation alone does not bypass missing security-team posture')
    : bad(`guard did not require security-team posture: ${noPosture.status} ${noPosture.stdout + noPosture.stderr}`);

  const activated = ctx('squad', 'activate', authPath);
  const ledgerPath = join(proj, '.claude', '.sessions', `${agySid}.json`);
  const ledger = JSON.parse(readFileSync(ledgerPath, 'utf-8'));
  activated.status === 0 && ledger.squads?.includes('security-team')
    ? ok('squad activate records security-team in the active ledger')
    : bad(`squad activate failed: ${activated.status} ${activated.stdout + activated.stderr}`);

  const allowed = ctx('guard', authPath);
  allowed.status === 0 && /allowed/i.test(allowed.stdout)
    ? ok('guard allows auth path after simulation and active security-team posture')
    : bad(`guard did not allow activated auth path: ${allowed.status} ${allowed.stdout + allowed.stderr}`);

  mkdirSync(join(proj, 'src', 'secure'), { recursive: true });
  mkdirSync(join(proj, 'prisma'), { recursive: true });
  writeFileSync(join(proj, 'src/secure/note.js'), 'export const note = true;\n');
  writeFileSync(join(proj, 'prisma/schema.prisma'), 'model User { id Int @id email String }\n');
  git(['add', 'src/secure/note.js', 'prisma/schema.prisma'], proj);
  markSimulation('cover secure note', 'src/secure/note.js');

  const scopedGuard = ctx('guard', 'src/secure/note.js');
  scopedGuard.status === 0 && /allowed/i.test(scopedGuard.stdout)
    ? ok('guard target audit ignores unrelated modified gated files')
    : bad(`guard leaked unrelated posture failure: ${scopedGuard.status} ${scopedGuard.stdout + scopedGuard.stderr}`);
} catch (err) {
  bad(`crashed: ${err?.stack || err}`);
} finally {
  fx.cleanup();
}

rep.finish('Integration (active squads)');
