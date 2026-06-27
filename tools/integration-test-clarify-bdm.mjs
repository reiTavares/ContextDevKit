#!/usr/bin/env node
/**
 * integration-test-clarify-bdm.mjs — OP-0005 / ADR-0125 Wave 2 end-to-end checks
 * for the ASK clarification surface and the `looksLikeNewTask` skip-guard fix,
 * tier `integration:enforcement`. Split out of integration-test-classify-bdm.mjs
 * to keep each suite under the 308-line budget (constitution §1).
 *
 * Drives the SHIPPED runtime modules under `templates/contextkit/` directly
 * (pure functions — no subprocess). Exit 0 on all-pass, non-zero on any failure.
 * Zero deps — node:* only.
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { reporter } from './it-helpers.mjs';

const KIT = dirname(dirname(fileURLToPath(import.meta.url)));
const EXEC = resolve(KIT, 'templates/contextkit/runtime/execution');
const urlFor = (rel) => pathToFileURL(resolve(EXEC, rel)).href;
const rep = reporter();

const { classifyWork, DEFAULT_WORK_CLASSIFICATION } = await import(urlFor('work-classifier.mjs'));
const policy = DEFAULT_WORK_CLASSIFICATION;

// ---------------------------------------------------------------------------
// F6. OP-0005 / ADR-0125 Wave 2 — ASK clarification surface + skip-guard fix.
// ---------------------------------------------------------------------------
console.log('\nF6. Wave 2 — ASK clarification + looksLikeNewTask skip guard...');
{
  const hookMod = await import(
    pathToFileURL(resolve(KIT, 'templates/contextkit/runtime/hooks/execution-contract-hook.mjs')).href
  );
  const { isPureConversation, looksLikeNewTask } = hookMod;

  // F6a. Near-tie / ambiguous objective → classifyWork returns needsClarification:true
  // with a non-empty clarifyQuestion string. A prompt with no strong Business or
  // Operation signals falls below the confidence floor (0.70) and triggers ASK.
  const ambiguous = classifyWork('update the platform strategy', policy);
  ambiguous.needsClarification === true
    ? rep.ok('F6a. near-tie/ambiguous objective → needsClarification=true')
    : rep.bad(`F6a. expected needsClarification=true, got ${ambiguous.needsClarification}`);
  typeof ambiguous.clarifyQuestion === 'string' && ambiguous.clarifyQuestion.length > 0
    ? rep.ok('F6a. clarifyQuestion is a non-empty string')
    : rep.bad(`F6a. clarifyQuestion invalid: ${JSON.stringify(ambiguous.clarifyQuestion)}`);
  ambiguous.confidence === 'ask'
    ? rep.ok('F6a. confidence=ask for the near-tie case')
    : rep.bad(`F6a. confidence: got ${ambiguous.confidence}, want 'ask'`);

  // F6b. A short imperative prompt is NOT treated as pure conversation when
  // looksLikeNewTask returns true (overriding the skip guard, OP-0005 Wave 2).
  const imperatives = [
    'fix the login bug',
    'implement the new auth flow',
    'add the export endpoint',
    'refactor the router',
  ];
  for (const prompt of imperatives) {
    const isConv = isPureConversation(prompt);
    const isTask = looksLikeNewTask(prompt);
    // The combined guard: skip only when isPureConversation AND NOT looksLikeNewTask.
    const wouldSkip = isConv && !isTask;
    !wouldSkip
      ? rep.ok(`F6b. "${prompt}" NOT skipped (isPureConversation=${isConv}, looksLikeNewTask=${isTask})`)
      : rep.bad(`F6b. "${prompt}" was incorrectly skipped by the skip guard`);
  }

  // F6c. Hook source statically verifies the ‹CONTEXTKIT-CLARIFY› guard is present.
  const hookSrc = readFileSync(
    resolve(KIT, 'templates/contextkit/runtime/hooks/execution-contract-hook.mjs'), 'utf-8'
  );
  hookSrc.includes('CONTEXTKIT-CLARIFY')
    ? rep.ok('F6c. hook source contains the ‹CONTEXTKIT-CLARIFY› marker')
    : rep.bad('F6c. hook source is missing the ‹CONTEXTKIT-CLARIFY› marker');
  hookSrc.includes('needsClarification') && hookSrc.includes('clarifyQuestion')
    ? rep.ok('F6c. hook source references needsClarification + clarifyQuestion fields')
    : rep.bad('F6c. hook source missing needsClarification or clarifyQuestion field reference');

  // F6d. orchestrate() sets envelope.clarification.needed=true for ASK signals.
  let orchestrate;
  try {
    ({ orchestrate } = await import(urlFor('request-orchestrator.mjs')));
  } catch (err) {
    rep.bad(`F6d. orchestrator import failed: ${err?.message ?? err}`);
  }
  if (orchestrate) {
    // Minimal valid config so resolveAutonomy does not throw (orchestrate()'s outer
    // try catches that contradiction and falls to fail-open).
    const orchCfg = { autonomy: { grade: 2 }, deliberations: { active: false }, routing: { mode: 'shadow' } };

    const askSignals = {
      work: { needsClarification: true, clarifyQuestion: 'Business or Operation?' },
      tier: 'feature', domain: 'general', needsAdr: false, paths: [], phase: '*', level: 7,
    };
    const envAsk = orchestrate(
      { requestId: 'req-ask-1', requestText: 'update the platform strategy', sessionId: null, signals: askSignals, context: {} },
      { root: process.cwd(), level: 7, config: orchCfg },
    );
    envAsk.clarification?.needed === true
      ? rep.ok('F6d. envelope.clarification.needed=true for ASK signals')
      : rep.bad(`F6d. envelope.clarification.needed wrong: ${JSON.stringify(envAsk.clarification)}`);
    typeof envAsk.clarification?.question === 'string' && envAsk.clarification.question.length > 0
      ? rep.ok('F6d. envelope.clarification.question is a non-empty string')
      : rep.bad(`F6d. envelope.clarification.question invalid: ${JSON.stringify(envAsk.clarification?.question)}`);

    // When needsClarification is false, envelope.clarification must not have needed:true.
    const clearSignals = {
      work: { needsClarification: false, clarifyQuestion: null },
      tier: 'trivial', domain: 'general', needsAdr: false, paths: [], phase: '*', level: 7,
    };
    const envClear = orchestrate(
      { requestId: 'req-clear-1', requestText: 'fix typo', sessionId: null, signals: clearSignals, context: {} },
      { root: process.cwd(), level: 7, config: orchCfg },
    );
    !envClear.clarification?.needed
      ? rep.ok('F6d. envelope.clarification not needed:true when needsClarification=false')
      : rep.bad('F6d. envelope.clarification.needed leaked true for a non-ASK signal');
  }
}

rep.finish('integration-clarify-bdm (BIZ-0001/WF-0036 A2 / OP-0005 Wave 2)');
