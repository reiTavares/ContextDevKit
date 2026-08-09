#!/usr/bin/env node
/** Integration coverage for the ADR-0158 optional subagent-scope recommendation. */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { evaluateSubagentRecommendation } from '../templates/contextkit/runtime/hooks/subagent-gate.mjs';

const hookPath = resolve('templates/contextkit/runtime/hooks/subagent-gate.mjs');

function runHook(payload) {
  return spawnSync(process.execPath, [hookPath], {
    cwd: process.cwd(),
    input: typeof payload === 'string' ? payload : JSON.stringify(payload),
    encoding: 'utf8',
  });
}

const defaultRun = runHook({ hook_event_name: 'SubagentStop', agent_type: 'worker' });
assert.equal(defaultRun.status, 0);
assert.equal(defaultRun.stdout, '', 'default path must be silent');

const malformed = runHook('{not-json');
assert.equal(malformed.status, 0);
assert.equal(malformed.stdout, '', 'malformed input must continue silently');

const report = {
  label: 'worker',
  declared: ['src/allowed/'],
  touched: ['src/outside/file.mjs'],
  forbidden: ['secrets/'],
};
const recommendation = evaluateSubagentRecommendation(report);
assert.equal(recommendation.decision, 'recommend');
assert.equal(recommendation.mode, 'canary');
assert.equal(recommendation.blocking, false);
assert.equal(recommendation.persisted, false);
assert.equal(recommendation.status, 'finding');

const explicitRun = runHook({
  hook_event_name: 'SubagentStop',
  contextdevkit_scope_report: report,
});
assert.equal(explicitRun.status, 0);
assert.match(explicitRun.stdout, /Canary recommendation/);
assert.match(explicitRun.stdout, /delivery continues/);
assert.doesNotMatch(explicitRun.stdout, /"decision"\s*:\s*"block"/);

console.log('integration-test-subagent-gate: PASS (inert default, explicit canary, fail-open)');
