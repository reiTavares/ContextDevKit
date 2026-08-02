#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadGlobalPolicy, resolveGlobalRoute, validateGlobalPolicy } from './resolve-subagent-route.mjs';

const argv = process.argv.slice(2);
const projectIndex = argv.indexOf('--contextkit-project');
const contextKitProject = projectIndex >= 0 ? argv[projectIndex + 1] : null;
const globalOnlyRoot = resolve(fileURLToPath(new URL('.', import.meta.url)));
const { policy } = loadGlobalPolicy();

for (const [key, expected] of Object.entries(policy.matrix)) {
  const [complexity, risk] = key.split('|');
  const fallback = resolveGlobalRoute({ complexity, risk, projectRoot: globalOnlyRoot, agent: 'selftest' });
  assert.equal(fallback.environment, 'global-fallback');
  assert.equal(fallback.decision, 'dispatch');
  assert.equal(fallback.model, expected.model, `${key} fallback model`);
  assert.equal(fallback.effort, expected.effort, `${key} fallback effort`);
  assert.equal(fallback.ruleId, expected.ruleId, `${key} fallback rule`);
  if (contextKitProject) {
    const contextKit = resolveGlobalRoute({ complexity, risk, projectRoot: contextKitProject, agent: 'selftest' });
    assert.equal(contextKit.environment, 'contextkit');
    assert.equal(contextKit.decision, 'dispatch', `${key} ContextKit decision`);
    assert.equal(contextKit.model, fallback.model, `${key} parity model`);
    assert.equal(contextKit.effort, fallback.effort, `${key} parity effort`);
    assert.equal(contextKit.ruleId, fallback.ruleId, `${key} parity rule`);
  }
}

for (const complexity of ['low', 'moderate', 'high', 'xhigh']) {
  assert.equal(resolveGlobalRoute({ complexity, risk: 'critical', projectRoot: globalOnlyRoot }).decision, 'refuse');
}
assert.equal(resolveGlobalRoute({ complexity: 'high', projectRoot: globalOnlyRoot }).decision, 'refuse');
const invalidUltra = structuredClone(policy);
invalidUltra.matrix['low|low'].model = 'gpt-5.6-sol';
invalidUltra.matrix['low|low'].effort = 'ultra';
assert.throws(() => validateGlobalPolicy(invalidUltra), /ultra invariant/);

const cli = resolve(fileURLToPath(new URL('./resolve-subagent-route.mjs', import.meta.url)));
const refusal = spawnSync(process.execPath, [cli, '--project-root', globalOnlyRoot, '--complexity', 'high', '--risk', 'critical'], { encoding: 'utf8' });
assert.equal(refusal.status, 2, 'refusal must be machine-enforceable');
console.log(`global subagent routing selftest: PASS (21 routes${contextKitProject ? ', ContextKit parity' : ''}, 4 critical refusals, partial refusal, ultra guard, exit=2)`);
