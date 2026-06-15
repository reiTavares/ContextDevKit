#!/usr/bin/env node
/**
 * ContextDevKit integration test — token economy & the fan-out economy (ADR-0044 F3).
 *
 * Split from `integration-test.mjs` (own fixture) when the token-report + F3
 * coverage grew past that file's line budget — one suite, one concern. Covers
 * `/token-report` aggregation + the D3 per-agent/per-command attribution, the D1
 * bounded subagent pack, the D5 deterministic memory retriever, and the D2
 * count-by-type `[Unreleased]` boot digest with its raw fallback. [ADR-0027/0044]
 *
 * Run:  node tools/integration-test-token-economy.mjs   (exit 0 = healthy)
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { reporter, installFixture } from './it-helpers.mjs';

const rep = reporter();
const { ok, bad } = rep;
console.log('\n🪙  ContextDevKit integration test — token economy (F3)\n');
const fx = installFixture(rep);
const { proj, script, hook } = fx;

try {
  // Token economy (#7): token-report aggregates usage from transcripts (fake --from dir; also
  // exercises the cwd filter + defensive JSON parsing of a bad line).
  const ttx = join(proj, '_ttx');
  mkdirSync(ttx, { recursive: true });
  const usageLine = (i, o, extra = {}) => { const { model, ...rest } = extra; return JSON.stringify({ type: 'assistant', sessionId: 'sess1', timestamp: '2026-05-24T00:00:00Z', cwd: proj, ...rest, message: { role: 'assistant', model, usage: { input_tokens: i, output_tokens: o, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } }); };
  // Main-loop (opus), a /ship line (opus), and a /debate subagent on a CHEAP model (haiku) → exercises
  // ADR-0044 D3 attribution AND the ADR-0052 byModel split (premium main loop vs cheap fan-out).
  writeFileSync(join(ttx, 'sess1.jsonl'), [usageLine(100, 200, { model: 'claude-opus-4-8' }), usageLine(50, 25, { attributionSkill: 'ship', model: 'claude-opus-4-8' }), usageLine(40, 60, { isSidechain: true, attributionSkill: 'debate', model: 'claude-haiku-4-5' }), '{ bad json'].join('\n'));
  const tr = script('token-report.mjs', '--from', ttx, '--json');
  (() => { try { const j = JSON.parse(tr.stdout); return j.sessions === 1 && j.totals.total === 475 && j.totals.input === 190; } catch { return false; } })()
    ? ok('token-report aggregates token usage from transcripts') : bad(`token-report failed: ${tr.stdout || tr.stderr}`);
  // ADR-0044 D3 — per-agent (main vs subagent fan-out) and per-command attribution, transcript-derived.
  (() => { try { const a = JSON.parse(tr.stdout).attribution; return a.agents.subagent.input === 40 && a.agents.subagent.output === 60 && a.agents.main.turns === 2 && a.commands.debate && a.commands.ship; } catch { return false; } })()
    ? ok('token-report attributes tokens per-agent (sidechain) and per-command (ADR-0044 D3)') : bad(`token-report D3 attribution wrong: ${tr.stdout}`);
  // ADR-0052 Phase 2 — byModel split: the premium main loop and the cheap fan-out land in distinct buckets.
  (() => { try { const m = JSON.parse(tr.stdout).attribution.byModel; return m['claude-opus-4-8']?.turns === 2 && m['claude-opus-4-8']?.input === 150 && m['claude-haiku-4-5']?.input === 40 && m['claude-haiku-4-5']?.output === 60; } catch { return false; } })()
    ? ok('token-report splits spend per model — premium main vs cheap fan-out (ADR-0052 Phase 2)') : bad(`token-report byModel split wrong: ${tr.stdout}`);

  // ADR-0044 D1/D5 — deterministic memory retriever + bounded subagent pack.
  writeFileSync(join(proj, 'contextkit', 'memory', 'GLOSSARY.md'), '# Glossary\n\n| Domain term (UI / business) | Code identifier | Notes |\n| --- | --- | --- |\n| Pipeline | `pipeline.mjs` | the DevPipeline board |\n');
  const mr = script('memory-retrieve.mjs', '--objective', 'pipeline board', '--json');
  (() => { try { const j = JSON.parse(mr.stdout); return j.tokens.includes('pipeline') && j.glossary.some((g) => /Pipeline/.test(g)); } catch { return false; } })()
    ? ok('memory-retrieve selects the matching glossary row for the objective (ADR-0044 D5)') : bad(`memory-retrieve missed the glossary hit: ${mr.stdout || mr.stderr}`);
  const mrText = script('memory-retrieve.mjs', '--objective', 'pipeline board').stdout;
  mrText.split('\n').length <= 40 && !/TODO|TBD|<placeholder>|…\s*$/m.test(mrText.replace(/truncated/g, ''))
    ? ok('memory-retrieve output is capped at 40 lines with no placeholder markers (ADR-0044 D5)') : bad(`memory-retrieve cap/placeholder guard failed (${mrText.split('\n').length} lines)`);
  script('memory-retrieve.mjs', '--objective', 'pipeline board').stdout === mrText
    ? ok('memory-retrieve is idempotent — same objective ⇒ byte-identical output (ADR-0044 D5)') : bad('memory-retrieve output is not idempotent');
  const sp = script('context-pack.mjs', '--for-subagent', '--objective', 'pipeline board').stdout;
  sp.startsWith('# 🧭 Subagent context pack') && sp.includes('Do not re-read boot context') && sp.split('\n').length <= 130
    ? ok('context-pack --for-subagent is bounded and carries the no-re-read rule (ADR-0044 D1)') : bad(`subagent pack malformed (${sp.split('\n').length} lines)`);

  // ADR-0044 D2 — the boot banner shows a count-by-type [Unreleased] digest, with a raw fallback.
  mkdirSync(join(proj, 'docs'), { recursive: true });
  writeFileSync(join(proj, 'docs', 'CHANGELOG.md'), '# Changelog\n\n## [Unreleased]\n\n### Added\n- **Alpha.** new thing\n- **Beta.** another new thing\n\n### Fixed\n- **Gamma.** a fix\n\n## [1.0.0] - 2026-01-01\n- old\n');
  const d2Banner = hook('session-start.mjs', {});
  /Added 2 · Fixed 1 \(3 entries\)/.test(d2Banner) && !d2Banner.includes('new thing\n- **Beta')
    ? ok('boot banner digests [Unreleased] as a count-by-type tally (ADR-0044 D2)') : bad('boot banner did not show the [Unreleased] digest');
  // Audit 135: a nested sub-bullet is detail of its parent, not a new entry.
  writeFileSync(join(proj, 'docs', 'CHANGELOG.md'), '# Changelog\n\n## [Unreleased]\n\n### Added\n- **Parent.** a top-level entry\n  - nested detail under the parent\n\n## [1.0.0] - 2026-01-01\n- old\n');
  /Added 1 \(1 entry\)/.test(hook('session-start.mjs', {}))
    ? ok('boot [Unreleased] digest counts only column-0 bullets, not nested sub-bullets (audit 135)') : bad('digest inflated the count with a nested sub-bullet');
  writeFileSync(join(proj, 'docs', 'CHANGELOG.md'), '# Changelog\n\n## [Unreleased]\n\nFreeform notes without typed subsections here.\n\n## [1.0.0] - 2026-01-01\n- old\n');
  hook('session-start.mjs', {}).includes('Freeform notes without typed subsections')
    ? ok('boot banner falls back to the raw [Unreleased] section on a parse miss (ADR-0044 D2)') : bad('boot banner did not fall back to raw [Unreleased]');

  // EACP end-to-end (WF0018 Wave 1): adapter → normalize → bucketsClose → lenses (ADR-0078/0081).
  const { default: path } = await import('node:path');
  const econ = {
    bucketsLib: await import('file://' + path.resolve(proj, 'contextkit/tools/scripts/economics/usage-buckets.mjs').replaceAll('\\', '/')),
    eventLib: await import('file://' + path.resolve(proj, 'contextkit/tools/scripts/economics/usage-event.mjs').replaceAll('\\', '/')),
    lensesLib: await import('file://' + path.resolve(proj, 'contextkit/tools/scripts/economics/attribution-lenses.mjs').replaceAll('\\', '/')),
    adapterLib: await import('file://' + path.resolve(proj, 'contextkit/tools/scripts/economics/adapters/claude-code.mjs').replaceAll('\\', '/')),
  };

  // (a) Adapter → normalize → bucketsClose path on synthetic usage line
  (() => { try {
    const synLine = {
      message: { model: 'claude-opus-4-1', usage: { input_tokens: 100, output_tokens: 50, cache_read_input_tokens: 800, cache_creation_input_tokens: 150 } },
      sessionId: 'eacp-test-sess',
      timestamp: Date.now(),
    };
    const adapted = econ.adapterLib.adapt(synLine);
    return adapted && econ.bucketsLib.bucketsClose(adapted);
  } catch { return false; } })()
    ? ok('economics: adapter → normalize → bucketsClose path holds on synthetic usage line') : bad('economics: adapter/normalize/bucketsClose pipeline failed');

  // (b) Cumulative trap neutralization
  (() => { try {
    const cumEvents = [
      { buckets: { freshInput: 100, output: 50, cacheRead: 800, cacheWrite: 150, reasoning: 0 }, bucketMode: 'cumulative', total: 1100 },
      { buckets: { freshInput: 150, output: 100, cacheRead: 1500, cacheWrite: 250, reasoning: 0 }, bucketMode: 'cumulative', total: 2000 },
    ];
    const naiveSum = cumEvents.reduce((s, e) => s + econ.bucketsLib.throughput(e.buckets), 0);
    const deltaized = econ.bucketsLib.toDelta(cumEvents);
    const normalized = deltaized.reduce((s, e) => s + econ.bucketsLib.throughput(e.buckets), 0);
    return naiveSum > normalized;
  } catch { return false; } })()
    ? ok('economics: cumulative trap is neutralized by toDelta') : bad('economics: cumulative trap not neutralized');

  // (c) Inclusive lens carries direct confidence
  (() => { try {
    const events = [
      { buckets: { freshInput: 100, output: 50, cacheRead: 800, cacheWrite: 150, reasoning: 0 }, agentScope: 'main' },
      { buckets: { freshInput: 50, output: 30, cacheRead: 400, cacheWrite: 75, reasoning: 0 }, agentScope: 'subagent' },
    ];
    const res = econ.lensesLib.inclusive(events);
    return res.confidence === 'direct';
  } catch { return false; } })()
    ? ok('economics: inclusive lens returns confidence="direct"') : bad('economics: inclusive lens confidence wrong');
} catch (err) {
  bad(`crashed: ${err?.stack || err}`);
} finally {
  fx.cleanup();
}

rep.finish('Integration (token economy)');
