#!/usr/bin/env node
/**
 * WF-0111 W11 focused contract: routing, swarm, risk acknowledgement, LGPD, and owner
 * preferences advise without becoming hidden authorization authorities.
 */
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  loadPolicy,
  resolveCodexDispatch,
  resolveModel,
} from '../templates/contextkit/tools/scripts/model-policy.mjs';
import { routePrompt } from '../templates/contextkit/runtime/execution/routing-runtime.mjs';
import { resolveRiskAcknowledgement } from '../templates/contextkit/runtime/governance/risk-acknowledgement.mjs';
import { applyOverOrchestrationGuard } from '../templates/contextkit/runtime/execution/agent-orchestration-guard.mjs';
import {
  confirmOwnerPreference,
  editOwnerPreference,
  listOwnerPreferences,
  resetOwnerPreferences,
  resolveOwnerPreference,
} from '../templates/contextkit/runtime/preferences/owner-preferences.mjs';

const KIT = resolve(import.meta.dirname, '..');
const policy = loadPolicy();
const tests = [];

function test(name, fn) {
  tests.push({ name, fn });
}

test('Codex dimensions produce a recommendation, never dispatch authority', () => {
  const recommendation = resolveCodexDispatch({ complexity: 'high', risk: 'high', policy });
  assert.equal(recommendation.decision, 'recommend');
  assert.equal(recommendation.recommendedModel, 'gpt-5.6-sol');
  assert.equal(recommendation.recommendedEffort, 'high');
  assert.equal(recommendation.binding, false);
  assert.equal(recommendation.continuation.allowed, true);
});

test('missing dimensions, critical-risk gaps, and unknown agents continue', () => {
  for (const recommendation of [
    resolveCodexDispatch({ policy }),
    resolveCodexDispatch({ complexity: 'low', risk: 'critical', policy }),
    resolveModel('not-registered', { host: 'codex', policy }),
  ]) {
    assert.equal(recommendation.decision, 'recommend');
    assert.equal(recommendation.binding, false);
    assert.equal(recommendation.continuation.allowed, true);
  }
});

test('missing and corrupt policy files return fail-honest continuation', () => {
  for (const policyPath of [
    join(tmpdir(), 'contextdevkit-policy-does-not-exist.json'),
    join(KIT, 'package.json'),
  ]) {
    const recommendation = resolveModel('qa-unit', { host: 'codex', policyPath });
    assert.equal(recommendation.decision, 'recommend');
    assert.equal(recommendation.status, 'unavailable');
    assert.equal(recommendation.continuation.allowed, true);
    assert.equal(recommendation.recommendedModel, null);
  }
});

test('host recommendations have parity and never replace the active model', () => {
  for (const host of ['claude', 'codex', 'agy']) {
    const recommendation = resolveModel('implementation-engineer', {
      host,
      complexity: 'high',
      risk: 'high',
      currentModel: 'owner-selected-model',
      policy,
    });
    assert.equal(recommendation.decision, 'recommend');
    assert.equal(recommendation.binding, false);
    assert.equal(recommendation.currentModel, 'owner-selected-model');
    assert.equal(recommendation.continuation.allowed, true);
  }
});

test('routing resolver failure remains observable and cannot block delivery', () => {
  const recommendation = routePrompt({
    promptText: 'Implement the requested change.',
    sessionId: 'session-w11',
    taskId: '420',
    routingConfigResolver() { throw new Error('simulated resolver failure'); },
  });
  assert.equal(recommendation.decision, 'recommend');
  assert.equal(recommendation.active, false);
  assert.equal(recommendation.applied, false);
  assert.equal(recommendation.blocking, false);
  assert.equal(recommendation.continuation.allowed, true);
  assert.match(recommendation.reason, /resolver-error/);
});

test('swarm caps are recommendations and selections remain byte-identical', () => {
  const selection = {
    lead: 'implementation-engineer',
    supporting: ['security', 'privacy-lgpd', 'test-engineer'],
    scouts: ['explorer'],
    reviewers: ['code-reviewer'],
    council: [],
    synthesizer: null,
    reasonCodes: [],
  };
  const recommendation = applyOverOrchestrationGuard(selection, { complexity: 'feature' }, {});
  assert.deepEqual(recommendation.supporting, selection.supporting);
  assert.deepEqual(recommendation.scouts, selection.scouts);
  assert.deepEqual(recommendation.reviewers, selection.reviewers);
  assert.equal(recommendation.guard.enforced, false);
  assert.equal(recommendation.guard.blocking, false);
  assert.equal(recommendation.guard.plannedAfter, recommendation.guard.plannedBefore);
});

test('real safety gets non-binding acknowledgement metadata without grades', () => {
  const ordinary = resolveRiskAcknowledgement('edit');
  assert.equal(ordinary.required, false);
  assert.equal(ordinary.binding, false);
  assert.equal(ordinary.continuation.allowed, true);

  const secret = resolveRiskAcknowledgement('edit', { path: '.env.production' });
  assert.equal(secret.required, true);
  assert.equal(secret.kind, 'secret-rotation');
  assert.match(secret.message, /platform safety boundary/i);

  const destructive = resolveRiskAcknowledgement('push', { force: true });
  assert.equal(destructive.required, true);
  assert.equal(destructive.kind, 'force-push');

  const acknowledged = resolveRiskAcknowledgement('destructive-production', {
    acknowledgedBy: 'owner',
    acknowledgedAt: '2026-08-08T12:00:00.000Z',
    reason: 'Owner explicitly accepts the production rollback risk.',
  });
  assert.equal(acknowledged.acknowledged, true);
  assert.equal(acknowledged.acknowledgedBy, 'owner');
  assert.equal(acknowledged.blocking, false);
});

test('legacy subagent gate is physically absent', async () => {
  await assert.rejects(
    readFile(join(KIT, 'templates/contextkit/runtime/hooks/subagent-gate.mjs'), 'utf8'),
    /ENOENT/,
  );
});

test('LGPD agent is explicit shadow guidance with evidence categories', async () => {
  const source = await readFile(join(KIT, 'templates/claude/agents/privacy-lgpd.md'), 'utf8');
  assert.match(source, /^mode:\s*shadow$/m);
  assert.match(source, /Observed fact/);
  assert.match(source, /Inference/);
  assert.match(source, /Unknown external context/);
  assert.match(source, /DPO\/legal question/);
  assert.doesNotMatch(source, /refuse on sight/i);
});

test('owner preferences are versioned, auditable, non-binding, and current-instruction subordinate', async () => {
  const root = await mkdtemp(join(tmpdir(), 'contextdevkit-owner-preferences-'));
  const now = '2026-08-08T12:00:00.000Z';
  try {
    const dryRun = editOwnerPreference(root, {
      key: 'swarm.preference', value: 'avoid-unless-useful', scope: 'project', source: 'inferred', confidence: 0.8,
    }, { actor: 'owner', now });
    assert.equal(dryRun.applied, false);
    assert.deepEqual(listOwnerPreferences(root).preferences, []);

    const edited = editOwnerPreference(root, {
      key: 'swarm.preference', value: 'avoid-unless-useful', scope: 'project', source: 'inferred', confidence: 0.8,
    }, { actor: 'owner', now, write: true });
    assert.equal(edited.applied, true);
    assert.equal(edited.store.schemaVersion, 1);
    assert.equal(edited.store.revision, 1);
    assert.equal(edited.authority, 'recommendation-only');

    const confirmed = confirmOwnerPreference(root, 'swarm.preference', {
      actor: 'owner', now: '2026-08-08T12:01:00.000Z', write: true,
    });
    assert.equal(confirmed.store.preferences[0].source, 'explicit');
    assert.equal(confirmed.store.revision, 2);

    const ignoredInference = editOwnerPreference(root, {
      key: 'swarm.preference', value: 'always', scope: 'project', source: 'inferred', confidence: 0.9,
    }, { actor: 'system', now: '2026-08-08T12:01:30.000Z', write: true });
    assert.equal(ignoredInference.applied, false);
    assert.equal(ignoredInference.status, 'ignored-inferred-below-explicit');
    assert.equal(listOwnerPreferences(root).revision, 2);

    const resolved = resolveOwnerPreference(root, 'swarm.preference', {
      currentInstruction: 'Use a swarm for this request.',
    });
    assert.equal(resolved.authority, 'current-instruction');
    assert.equal(resolved.blocking, false);
    assert.equal(resolved.preference.value, 'avoid-unless-useful');

    assert.throws(() => editOwnerPreference(root, {
      key: 'swarm.preference', value: 'token=sk-secret-value', source: 'explicit', confidence: 1,
    }, { actor: 'owner', now, write: true }), /sensitive/i);

    const audit = await readFile(join(root, 'contextkit/memory/preferences/owner-preferences.audit.jsonl'), 'utf8');
    assert.match(audit, /"action":"edit"/);
    assert.match(audit, /"action":"confirm"/);
    assert.doesNotMatch(audit, /avoid-unless-useful|sk-secret-value/);

    const reset = resetOwnerPreferences(root, { actor: 'owner', now: '2026-08-08T12:02:00.000Z', write: true });
    assert.equal(reset.store.revision, 3);
    assert.deepEqual(reset.store.preferences, []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

let failures = 0;
for (const { name, fn } of tests) {
  try {
    await fn();
    process.stdout.write(`ok - ${name}\n`);
  } catch (error) {
    failures += 1;
    process.stderr.write(`not ok - ${name}\n${error?.stack ?? error}\n`);
  }
}

process.stdout.write(`advisory-policy: ${tests.length - failures}/${tests.length} passed\n`);
process.exitCode = failures === 0 ? 0 : 1;
