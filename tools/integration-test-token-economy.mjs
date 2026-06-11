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
  const usageLine = (i, o, extra = {}) => JSON.stringify({ type: 'assistant', sessionId: 'sess1', timestamp: '2026-05-24T00:00:00Z', cwd: proj, ...extra, message: { role: 'assistant', usage: { input_tokens: i, output_tokens: o, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } });
  // Main-loop, a /debate subagent (isSidechain), and a /ship command line → exercises ADR-0044 D3 attribution.
  writeFileSync(join(ttx, 'sess1.jsonl'), [usageLine(100, 200), usageLine(50, 25, { attributionSkill: 'ship' }), usageLine(40, 60, { isSidechain: true, attributionSkill: 'debate' }), '{ bad json'].join('\n'));
  const tr = script('token-report.mjs', '--from', ttx, '--json');
  (() => { try { const j = JSON.parse(tr.stdout); return j.sessions === 1 && j.totals.total === 475 && j.totals.input === 190; } catch { return false; } })()
    ? ok('token-report aggregates token usage from transcripts') : bad(`token-report failed: ${tr.stdout || tr.stderr}`);
  // ADR-0044 D3 — per-agent (main vs subagent fan-out) and per-command attribution, transcript-derived.
  (() => { try { const a = JSON.parse(tr.stdout).attribution; return a.agents.subagent.input === 40 && a.agents.subagent.output === 60 && a.agents.main.turns === 2 && a.commands.debate && a.commands.ship; } catch { return false; } })()
    ? ok('token-report attributes tokens per-agent (sidechain) and per-command (ADR-0044 D3)') : bad(`token-report D3 attribution wrong: ${tr.stdout}`);

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
} catch (err) {
  bad(`crashed: ${err?.stack || err}`);
} finally {
  fx.cleanup();
}

rep.finish('Integration (token economy)');
