#!/usr/bin/env node
import assert from 'node:assert/strict';
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const KIT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const installer = resolve(KIT, 'templates/contextkit/tools/scripts/install-codex-global-routing.mjs');
const temporaryRoot = await mkdtemp(join(tmpdir(), 'contextdevkit-codex-global-'));
const codexHome = join(temporaryRoot, 'codex-home');
const projectRoot = join(temporaryRoot, 'project');

function run(command, args, cwd = KIT) {
  const child = spawnSync(command, args, { cwd, encoding: 'utf8' });
  assert.equal(child.status, 0, `${command} ${args.join(' ')} failed\n${child.stdout}\n${child.stderr}`);
  return child.stdout.trim();
}

try {
  await mkdir(codexHome, { recursive: true });
  await writeFile(join(codexHome, 'config.toml'), 'model = "existing-model"\n\n[features]\ncustom_feature = true\nmulti_agent = false\n\n[agents]\nmax_concurrent_threads_per_session = 2\n', 'utf8');
  await writeFile(join(codexHome, 'AGENTS.md'), '# Personal rule\n\nKeep this content.\n', 'utf8');

  const firstReceipt = JSON.parse(run(process.execPath, [installer, '--codex-home', codexHome]));
  assert.equal(firstReceipt.routes, 21);
  assert.ok(firstReceipt.backup, 'changed config must receive a backup');
  const firstConfig = await readFile(join(codexHome, 'config.toml'), 'utf8');
  assert.match(firstConfig, /model = "existing-model"/);
  assert.match(firstConfig, /custom_feature = true/);
  assert.match(firstConfig, /multi_agent = true/);
  assert.match(firstConfig, /multi_agent_v2 = true/);
  assert.match(firstConfig, /enabled = true/);
  assert.match(firstConfig, /max_concurrent_threads_per_session = 15/);
  assert.match(firstConfig, /default_subagent_model = "gpt-5.6-luna"/);
  assert.match(firstConfig, /default_subagent_reasoning_effort = "max"/);

  const firstAgents = await readFile(join(codexHome, 'AGENTS.md'), 'utf8');
  assert.match(firstAgents, /# Personal rule/);
  assert.equal((firstAgents.match(/contextdevkit:codex-global-routing:start/g) ?? []).length, 1);
  const snapshot = JSON.parse(await readFile(join(codexHome, 'harness', 'subagent-routing-policy.json'), 'utf8'));
  assert.equal(Object.keys(snapshot.matrix).length, 21);

  await mkdir(join(projectRoot, 'contextkit', 'tools', 'scripts'), { recursive: true });
  await mkdir(join(projectRoot, 'contextkit', 'policy'), { recursive: true });
  await copyFile(resolve(KIT, 'templates/contextkit/tools/scripts/model-policy.mjs'), join(projectRoot, 'contextkit', 'tools', 'scripts', 'model-policy.mjs'));
  await copyFile(resolve(KIT, 'templates/contextkit/policy/routing-policy.json'), join(projectRoot, 'contextkit', 'policy', 'routing-policy.json'));
  run(process.execPath, [join(codexHome, 'harness', 'resolve-subagent-route.selftest.mjs'), '--contextkit-project', projectRoot]);

  const secondReceipt = JSON.parse(run(process.execPath, [installer, '--codex-home', codexHome]));
  assert.equal(secondReceipt.backup, null, 'idempotent second install must not create a backup');
  assert.equal(await readFile(join(codexHome, 'config.toml'), 'utf8'), firstConfig);
  assert.equal(await readFile(join(codexHome, 'AGENTS.md'), 'utf8'), firstAgents);
  console.log('integration-test-codex-global-routing: PASS (config preservation, idempotence, 21 routes, ContextKit parity)');
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
}
