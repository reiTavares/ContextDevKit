#!/usr/bin/env node
/**
 * VibeDevKit integration test — CORE engine (install + the real hooks).
 *
 * Installs the kit into a throwaway temp project and drives the runtime hooks
 * end-to-end (drift block, L5 gate, predictions, concurrency, --update, …). The
 * tool scripts (pipeline, deps, fleet, agent-tuning, …) are covered by
 * `integration-test-tooling.mjs`. Shared harness: `it-helpers.mjs`.
 *
 * Run:  node tools/integration-test.mjs   (exit 0 = healthy)
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { KIT, run, readJson, reporter, installFixture } from './it-helpers.mjs';

const rep = reporter();
const { ok, bad } = rep;
console.log('\n🌀 VibeDevKit integration test — core\n');
const fx = installFixture(rep);
const { proj, cfgPath, hook, script } = fx;

try {
  // L3 git hooks installed (pre-push conflict check).
  existsSync(join(proj, '.git', 'hooks', 'pre-push')) ? ok('pre-push git hook installed') : bad('pre-push hook missing');

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
  // Ancestor parity: /simulate-impact leaves a prediction trail file.
  existsSync(join(proj, 'vibekit', 'memory', 'predictions')) && readdirSync(join(proj, 'vibekit', 'memory', 'predictions')).some((f) => f.endsWith('.md'))
    ? ok('simulate-impact writes a prediction file (predictions/)')
    : bad('no prediction file written');
  // Ancestor parity: workflow guides (L1–L6) + reusable playbooks are installed.
  existsSync(join(proj, 'vibekit', 'workflows', 'README.md')) &&
    ['tech-debt-sweep.md', 'simulate-impact.md', 'distillation-cycle.md', 'security-batch.md']
      .every((f) => existsSync(join(proj, 'vibekit', 'workflows', 'playbooks', f)))
    ? ok('workflows + playbooks installed (workflows/playbooks/)')
    : bad('workflows/playbooks not installed');
  // Ancestor parity #1 (loop closed): predictions-review fills the Actual section.
  script('predictions-review.mjs');
  const predMd = readdirSync(join(proj, 'vibekit', 'memory', 'predictions')).find((f) => f.endsWith('.md'));
  const predBody = predMd ? readFileSync(join(proj, 'vibekit', 'memory', 'predictions', predMd), 'utf-8') : '';
  predBody.includes('## Actual (reviewed') && predBody.includes('src/a.js') && !predBody.includes('fill on review')
    ? ok('predictions-review closes the predicted-vs-actual loop (Actual filled)')
    : bad('predictions-review did not fill the Actual section');

  // Concurrency guard (L3+): warn before overwriting a file another session edited.
  hook('track-edits.mjs', { session_id: 'other', tool_name: 'Write', tool_input: { file_path: 'src/shared.js' } });
  hook('concurrency-guard.mjs', { session_id: 'me', tool_name: 'Write', tool_input: { file_path: 'src/shared.js' } }).includes('Concurrency')
    ? ok('concurrency-guard warns on cross-session collision')
    : bad('concurrency-guard did not warn');
  const l5settings = readJson(join(proj, '.claude', 'settings.json'));
  (l5settings.hooks?.PreToolUse || []).some((g) => (g.hooks || []).some((h) => h.command.includes('concurrency-guard')))
    ? ok('L5 wires the concurrency guard (PreToolUse)') : bad('concurrency-guard not wired at L5');

  // Safe --update: preserves CLAUDE.md, config (level + overrides), memory.
  writeFileSync(join(proj, 'CLAUDE.md'), readFileSync(join(proj, 'CLAUDE.md'), 'utf-8') + '\n## USER MARKER\n');
  run([join(KIT, 'install.mjs'), '--target', proj, '--update']);
  const afterCfg = readJson(join(proj, 'vibekit', 'config.json'));
  readFileSync(join(proj, 'CLAUDE.md'), 'utf-8').includes('USER MARKER') && afterCfg.level === 5 && !existsSync(join(proj, 'CLAUDE.vibedevkit.md'))
    ? ok('--update preserves CLAUDE.md + level (no data loss)')
    : bad('--update lost data (CLAUDE.md/level/side-file)');

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

  // GitHub templates + QA/compliance/design/security agents + two-tier briefings.
  existsSync(join(proj, '.github', 'PULL_REQUEST_TEMPLATE.md')) ? ok('GitHub PR template installed') : bad('PR template not installed');
  existsSync(join(proj, '.claude', 'agents', 'qa-orchestrator.md')) ? ok('QA squad agents installed (L5)') : bad('qa-orchestrator agent missing');
  existsSync(join(proj, 'vibekit', 'squads', 'README.md')) ? ok('squad manifest installed') : bad('squads/README.md missing');
  existsSync(join(proj, '.claude', 'agents', 'privacy-lgpd.md')) && existsSync(join(proj, '.claude', 'agents', 'ux-designer.md'))
    ? ok('compliance + design squads installed') : bad('new squad agents missing');
  existsSync(join(proj, '.claude', 'agents', 'infra-security.md')) ? ok('security-team infra-security agent installed') : bad('infra-security agent missing');
  script('squad.mjs', 'brief', 'security');
  existsSync(join(proj, 'vibekit', 'squads', 'security-team', 'security.md'))
    ? ok('squad brief scaffolds a tier-2 briefing (squads/<team>/)') : bad('squad brief did not scaffold');

  // vibe-config show/set round-trip.
  script('vibe-config.mjs', 'set', 'qa.coverageTarget.lines', '90');
  const showOut = script('vibe-config.mjs', 'show', 'qa.coverageTarget.lines').stdout || '';
  showOut.trim() === '90' ? ok('vibe-config set/show round-trips') : bad(`vibe-config round-trip failed: ${showOut}`);

  // doctor runs and reports.
  const doc = script('doctor.mjs');
  /VibeDevKit doctor/i.test(doc.stdout || '') ? ok('doctor runs') : bad(`doctor failed: ${doc.stderr}`);

  // L5/L6 scanners run and produce JSON.
  const debt = script('tech-debt-scan.mjs', '--json');
  (() => { try { return Array.isArray(JSON.parse(debt.stdout).findings); } catch { return false; } })()
    ? ok('tech-debt-scan emits JSON findings') : bad(`tech-debt-scan failed: ${debt.stderr}`);
  const stats = script('stats.mjs', '--json');
  (() => { try { return typeof JSON.parse(stats.stdout).driftRatePct === 'number'; } catch { return false; } })()
    ? ok('stats emits JSON metrics') : bad(`stats failed: ${stats.stderr}`);

  // best-practices doc + business-rules scaffold installed.
  existsSync(join(proj, 'vibekit', 'best-practices.md')) ? ok('best-practices.md installed') : bad('best-practices.md missing');
  existsSync(join(proj, 'vibekit', 'memory', 'business-rules', '_TEMPLATE.md')) ? ok('business-rules/ scaffolded (ancestor parity)') : bad('business-rules template missing');

  // Contract drift: deepened extractor catches default / export* / abstract / type-only.
  const ccfg = readJson(cfgPath);
  ccfg.l5 = ccfg.l5 || {};
  ccfg.l5.contractGlobs = ['src/contract/'];
  writeFileSync(cfgPath, JSON.stringify(ccfg, null, 2));
  mkdirSync(join(proj, 'src', 'contract'), { recursive: true });
  const apiPath = join(proj, 'src', 'contract', 'api.ts');
  writeFileSync(apiPath, [
    'export default function main() {}',
    'export const alpha = 1;',
    'export abstract class Beta {}',
    "export * from './other';",
    'export type Gamma = { x: number };',
    "export { delta, epsilon as zeta } from './m';",
  ].join('\n'));
  script('contract-scan.mjs', '--save');
  writeFileSync(apiPath, ['export const alpha = 1;', "export { delta, epsilon as zeta } from './m';"].join('\n'));
  const drift = script('contract-scan.mjs', '--json');
  (() => {
    try {
      const removed = JSON.parse(drift.stdout).removals.join('\n');
      return ['default', 'Beta', 'Gamma'].every((n) => removed.includes(n)) && removed.includes('* from ./other');
    } catch { return false; }
  })()
    ? ok('contract-scan detects removed default / export* / abstract / type-only exports')
    : bad(`contract-scan drift miss: ${drift.stdout || drift.stderr}`);
  // Optional AST contract drift (#001): with a parser available (fake via VIBE_CONTRACT_PARSER),
  // extraction uses the AST, not regex — the baseline reflects AST-derived names.
  const astCfg = readJson(cfgPath);
  astCfg.l5.contractGlobs = ['src/ast/'];
  writeFileSync(cfgPath, JSON.stringify(astCfg, null, 2));
  mkdirSync(join(proj, 'src', 'ast'), { recursive: true });
  writeFileSync(join(proj, 'src', 'ast', 'mod.js'), 'export const regexName = 1;\n');
  writeFileSync(join(proj, '_fakeparser.mjs'), 'export function parse(){return{body:[{type:"ExportDefaultDeclaration"},{type:"ExportNamedDeclaration",specifiers:[{exported:{name:"astOnly"}}]}]};}\n');
  run([join(proj, 'vibekit', 'tools', 'scripts', 'contract-scan.mjs'), '--save'], { cwd: proj, env: { ...process.env, VIBE_CONTRACT_PARSER: join(proj, '_fakeparser.mjs') } });
  const astBaseline = readFileSync(join(proj, 'vibekit', 'memory', 'contract-baseline.json'), 'utf-8');
  astBaseline.includes('astOnly') && !astBaseline.includes('regexName')
    ? ok('contract-scan uses the optional AST parser when importable') : bad(`AST path not used: ${astBaseline}`);

  // Playbook management (#8): the registry lists installed playbooks; run records a tracked entry.
  const pbList = script('playbook.mjs', 'list').stdout || '';
  pbList.includes('tech-debt-sweep') && pbList.includes('security-batch')
    ? ok('playbook list shows the registry') : bad(`playbook list missing entries: ${pbList}`);
  script('playbook.mjs', 'run', 'tech-debt-sweep', 'IT run');
  const pbRuns = existsSync(join(proj, 'vibekit', 'memory', 'playbook-runs.md'))
    && readFileSync(join(proj, 'vibekit', 'memory', 'playbook-runs.md'), 'utf-8');
  pbRuns && pbRuns.includes('tech-debt-sweep')
    ? ok('playbook run records a tracked entry') : bad('playbook run did not track');

  // Token economy (#7): token-report aggregates usage from transcripts (fake --from dir; also
  // exercises the cwd filter + defensive JSON parsing of a bad line).
  const ttx = join(proj, '_ttx');
  mkdirSync(ttx, { recursive: true });
  const usageLine = (i, o) => JSON.stringify({ type: 'assistant', sessionId: 'sess1', timestamp: '2026-05-24T00:00:00Z', cwd: proj, message: { role: 'assistant', usage: { input_tokens: i, output_tokens: o, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } });
  writeFileSync(join(ttx, 'sess1.jsonl'), [usageLine(100, 200), usageLine(50, 25), '{ bad json'].join('\n'));
  const tr = script('token-report.mjs', '--from', ttx, '--json');
  (() => { try { const j = JSON.parse(tr.stdout); return j.sessions === 1 && j.totals.total === 375 && j.totals.input === 150; } catch { return false; } })()
    ? ok('token-report aggregates token usage from transcripts') : bad(`token-report failed: ${tr.stdout || tr.stderr}`);

  // Predictions-review cadence (#002): cadence on + an unreviewed prediction → SessionStart reminds.
  const prCfg = readJson(cfgPath);
  prCfg.predictionsReview = { active: true, everyNSessions: 1 };
  writeFileSync(cfgPath, JSON.stringify(prCfg, null, 2));
  writeFileSync(join(proj, 'vibekit', 'memory', 'sessions', '2026-01-01-01-x.md'), '# x\n');
  writeFileSync(join(proj, 'vibekit', 'memory', 'predictions', 'unrev.md'), '# Prediction\n\n## Actual — fill on review\n');
  hook('session-start.mjs', {}).includes('/predictions-review')
    ? ok('predictions-review cadence reminds when a review is due') : bad('no predictions-review cadence reminder');

  // Roadmap seeded (undefined) + find reports it as not-defined.
  existsSync(join(proj, 'vibekit', 'memory', 'roadmap.md')) ? ok('roadmap.md installed') : bad('roadmap.md missing');
  const rm = script('roadmap.mjs', 'find', '--json');
  (() => { try { return JSON.parse(rm.stdout).canonicalDefined === false; } catch { return false; } })()
    ? ok('roadmap find reports undefined (seed placeholder)') : bad(`roadmap find failed: ${rm.stderr || rm.stdout}`);
} catch (err) {
  bad(`crashed: ${err?.stack || err}`);
} finally {
  fx.cleanup();
}

rep.finish('Integration (core)');
