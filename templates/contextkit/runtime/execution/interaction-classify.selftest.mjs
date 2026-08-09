/** Focused contract tests for WF-0111 W02 interaction/intake classification. */
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { classifyInteraction } from './interaction-classify.mjs';
import { intake, normalizeExistingWorkResolution } from './task-intake.mjs';
import { classifyRequest } from './request-classify.mjs';
import { classifyWork } from './work-classifier.mjs';
import { currentCallRevokes } from './no-code-prior.mjs';

const failures = [];

/** @param {string} label @param {boolean} condition @param {string} [detail] */
function assert(label, condition, detail = '') {
  process.stdout.write(`  ${condition ? 'ok  ' : 'FAIL'} ${label}${!condition && detail ? ` — ${detail}` : ''}\n`);
  if (!condition) failures.push(label);
}

const readOnlyPrompts = [
  ['Explique como o intake funciona.', 'conversation'],
  ['Analise por que o ContextDevKit cria workflows demais.', 'exploration'],
  ['Como eu poderia criar uma arquitetura melhor sem alterar nada?', 'exploration'],
  ['O que a LGPD exige neste tipo de sistema?', 'conversation'],
  ['Compare batch e workflow.', 'exploration'],
  ['Explain how intake works.', 'conversation'],
  ['Analyze why ContextDevKit creates too many workflows.', 'exploration'],
  ['How could I create a better architecture without changing anything?', 'exploration'],
  ['What does privacy law require for this system?', 'conversation'],
  ['Compare batch and workflow.', 'exploration'],
];

process.stdout.write('[interaction fast path]\n');
const emptyRoot = mkdtempSync(join(tmpdir(), 'contextdevkit-interaction-'));
try {
  for (const [prompt, expected] of readOnlyPrompts) {
    const classified = classifyInteraction(prompt);
    const intakeResult = intake({ objective: prompt, taskId: 'must-not-leak' }, { root: emptyRoot });
    assert(`${expected}: ${prompt}`, classified.intent === expected, classified.intent);
    assert(`no task id/full classification: ${prompt}`, !('taskId' in intakeResult.signals)
      && !('tier' in intakeResult.signals)
      && !('work' in intakeResult.signals));
  }
  assert('read-only intake writes no artifact', readdirSync(emptyRoot).length === 0);
} finally {
  rmSync(emptyRoot, { recursive: true, force: true });
}

const longQuestion = `${'Contexto detalhado sem ordem de alteração. '.repeat(16)}Como eu poderia criar, corrigir, arquitetar e migrar isso sem alterar nada?`;
assert('500+ character question remains exploration', longQuestion.length > 500
  && classifyInteraction(longQuestion).intent === 'exploration');
assert('Portuguese polite request is mutation', classifyInteraction('Pode corrigir este typo?').intent === 'mutation');
assert('English polite request is mutation', classifyInteraction('Could you fix this typo?').intent === 'mutation');

process.stdout.write('[uncertainty and authoritative promotion]\n');
const uncertainPt = classifyInteraction('Ajuste isso.');
assert('vague mutation is unclassified', uncertainPt.intent === 'unclassified');
assert('uncertainty asks one short PT question', uncertainPt.clarification === 'Você quer que eu altere algo?');
assert('same revision does not ask twice', classifyInteraction('Ajuste isso.', { clarificationAsked: true }).clarification === null);
assert('real write promotes uncertainty', classifyInteraction('Ajuste isso.', { writeAttempt: true }).intent === 'mutation');
assert('mutation is monotonic', classifyInteraction('Explique isso.', { priorIntent: 'mutation' }).intent === 'mutation');
assert('Read never promotes', currentCallRevokes('Read', ['README.md']) === false);
for (const path of ['README.md', 'contextkit/memory/state.json', 'contextkit/config.json']) {
  assert(`Write promotes ${path}`, currentCallRevokes('Write', [path]) === true);
}
assert('unknown Edit target still promotes', currentCallRevokes('Edit', []) === true);

process.stdout.write('[existing work before creation]\n');
assert('only resolver=new permits creation', normalizeExistingWorkResolution('new').canCreate === true);
for (const state of ['explicit', 'inferred', 'ambiguous', 'none']) {
  assert(`${state} does not permit creation`, normalizeExistingWorkResolution(state).canCreate === false);
}
assert('explicit active work resumes', normalizeExistingWorkResolution('explicit').canResume === true);
const done = normalizeExistingWorkResolution({ state: 'explicit', itemStatus: 'done' });
assert('done work does not reopen implicitly', done.canResume === false && done.requiresExplicitReopen === true);
assert('explicit order can reopen done work', normalizeExistingWorkResolution(
  { state: 'explicit', itemStatus: 'done' }, { explicitReopen: true },
).canResume === true);

process.stdout.write('[nature and execution shape]\n');
assert('small fix has no invented Operation owner', classifyWork('Fix this typo.').nature === 'none');
assert('durable strategic capability can classify Business', classifyWork('Launch a new product for a new market.').nature === 'business');
assert('durable incident context can classify Operation', classifyWork('Handle this incident and production outage.').nature === 'operation');
const ambiguousNature = classifyWork('Fix a durable strategic capability.');
assert('competing owner evidence stays unclassified', ambiguousNature.nature === 'unclassified'
  && ambiguousNature.needsClarification === true);
assert('Business does not imply workflow', classifyWork('Launch a new product for a new market.').executionMode === 'direct');
for (const word of ['architecture', 'ADR', 'compliance', 'business']) {
  assert(`${word} alone does not force workflow`, classifyWork(`Implement this ${word} change.`).executionMode === 'direct');
}
assert('1-3 cohesive tasks are direct', classifyWork('Update three related files.').executionMode === 'direct');
assert('4-12 independent tasks are batch', classifyWork('Update five independent texts.').executionMode === 'batch');
assert('Portuguese 4-12 independent tasks are batch', classifyWork('Atualize estes cinco textos independentes.').executionMode === 'batch');
assert('cutover plus rollback is workflow', classifyWork('Migrate the store with cutover and rollback.').executionMode === 'workflow');

process.stdout.write('[request classification degradation]\n');
const readOnlyRequest = classifyRequest(intake({ objective: 'Compare batch and workflow.' }).signals);
assert('read-only request skips governed classification', readOnlyRequest.intent === 'exploration'
  && readOnlyRequest.primaryType === 'research');
assert('malformed intake degrades without throwing', intake(null).signals.interaction.intent === 'unclassified');
assert('null intake environment degrades without throwing', intake(null, null).signals.interaction.intent === 'unclassified');
const hostilePrompt = { toString() { throw new Error('boom'); } };
const degradedInteraction = classifyInteraction(hostilePrompt);
assert('classifier failure is unclassified/degraded', degradedInteraction.intent === 'unclassified'
  && degradedInteraction.reasonCodes.includes('interaction-classifier-degraded'));

if (failures.length > 0) {
  process.stdout.write(`\nFAILED (${failures.length}): ${failures.join('; ')}\n`);
  process.exit(1);
}
process.stdout.write('\nPASSED\n');
