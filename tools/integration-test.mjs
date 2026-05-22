#!/usr/bin/env node
/**
 * VibeDevKit integration test — exercises the REAL hooks end-to-end.
 *
 * Unlike `selfcheck.mjs` (static import smoke test), this installs the kit into
 * a throwaway temp project and drives the hooks through `child_process` with a
 * real stdin pipe — exactly how Claude Code invokes them. Cross-platform
 * (avoids PowerShell's broken string-to-stdin piping) and self-cleaning, so it
 * runs identically locally and in CI.
 *
 * Run:  node tools/integration-test.mjs   (exit 0 = healthy)
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const KIT = dirname(dirname(fileURLToPath(import.meta.url)));
let failures = 0;
const ok = (m) => console.log(`  ✓ ${m}`);
const bad = (m) => {
  console.error(`  ✗ ${m}`);
  failures++;
};

const node = process.execPath;
const run = (args, opts = {}) => spawnSync(node, args, { encoding: 'utf-8', ...opts });
const git = (args, cwd) => spawnSync('git', args, { cwd, encoding: 'utf-8' });

function readJson(p) {
  return JSON.parse(readFileSync(p, 'utf-8').replace(/^﻿/, ''));
}

async function main() {
  console.log('\n🌀 VibeDevKit integration test\n');
  const proj = mkdtempSync(join(tmpdir(), 'vibekit-it-'));
  try {
    git(['init', '-b', 'main'], proj);
    git(['config', 'user.email', 'it@example.com'], proj);
    git(['config', 'user.name', 'IT'], proj);

    // Install at Level 5.
    const inst = run([join(KIT, 'install.mjs'), '--target', proj, '--level', '5', '--name', 'IT App', '--yes']);
    inst.status === 0 ? ok('install at Level 5') : bad(`install failed (status ${inst.status}): ${inst.stderr}`);

    const hook = (name, payload) =>
      run([join(proj, 'vibekit', 'runtime', 'hooks', name)], { cwd: proj, input: JSON.stringify(payload) }).stdout || '';
    const script = (rel, ...a) => run([join(proj, 'vibekit', 'tools', 'scripts', rel), ...a], { cwd: proj });

    // First-run trigger.
    hook('session-start.mjs', {}).includes('First run')
      ? ok('SessionStart fires the first-run trigger')
      : bad('first-run banner missing');

    // Drift ledger + Stop block.
    hook('track-edits.mjs', { session_id: 'it', tool_name: 'Write', tool_input: { file_path: 'src/a.js' } });
    hook('track-edits.mjs', { session_id: 'it', tool_name: 'Write', tool_input: { file_path: 'src/b.js' } });
    existsSync(join(proj, '.claude', '.sessions', 'it.json')) ? ok('PostToolUse writes the ledger') : bad('ledger not written');
    hook('check-registration.mjs', { session_id: 'it' }).includes('"decision":"block"')
      ? ok('Stop blocks on drift')
      : bad('Stop did not block on drift');

    // L5 gate: block, then allow after a simulation record.
    const cfgPath = join(proj, 'vibekit', 'config.json');
    const cfg = readJson(cfgPath);
    cfg.l5.highRiskPaths = ['src/secure/'];
    writeFileSync(cfgPath, JSON.stringify(cfg, null, 2));
    hook('simulate-gate.mjs', { session_id: 'it', tool_name: 'Write', tool_input: { file_path: 'src/secure/x.js' } }).includes('"decision":"block"')
      ? ok('L5 gate blocks an unsimulated high-risk edit')
      : bad('L5 gate did not block');
    script('mark-simulation.mjs', 'cover secure', 'src/secure/');
    hook('simulate-gate.mjs', { session_id: 'it', tool_name: 'Write', tool_input: { file_path: 'src/secure/x.js' } }).trim() === ''
      ? ok('L5 gate allows after /simulate-impact')
      : bad('L5 gate still blocked after simulation');

    // setup-complete silences the trigger.
    script('setup-complete.mjs');
    !hook('session-start.mjs', {}).includes('First run')
      ? ok('first-run trigger silent after setup-complete')
      : bad('trigger still firing after setup-complete');

    // vibe-level down to L2 removes PreToolUse wiring.
    script('vibe-level.mjs', '2');
    const settings = readJson(join(proj, '.claude', 'settings.json'));
    !settings.hooks?.PreToolUse ? ok('vibe-level 2 removes the L5 PreToolUse hook') : bad('PreToolUse still wired at L2');
    settings.hooks?.SessionStart && settings.hooks?.Stop ? ok('vibe-level 2 keeps L1/L2 hooks') : bad('L1/L2 hooks lost');

    // doctor runs and reports.
    const doc = script('doctor.mjs');
    /VibeDevKit doctor/i.test(doc.stdout || '') ? ok('doctor runs') : bad(`doctor failed: ${doc.stderr}`);
  } finally {
    rmSync(proj, { recursive: true, force: true });
  }

  console.log(failures === 0 ? '\n✅ Integration test passed.\n' : `\n❌ ${failures} check(s) failed.\n`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('integration test crashed:', err);
  process.exit(1);
});
