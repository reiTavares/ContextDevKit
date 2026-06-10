#!/usr/bin/env node
/**
 * ContextDevKit integration test — CORE engine (install + the real hooks).
 *
 * Installs the kit into a throwaway temp project and drives the runtime hooks
 * end-to-end (drift block, L5 gate, predictions, concurrency, --update, …). The
 * tool scripts (pipeline, deps, fleet, agent-tuning, …) are covered by
 * `integration-test-tooling.mjs`. Shared harness: `it-helpers.mjs`.
 *
 * Run:  node tools/integration-test.mjs   (exit 0 = healthy)
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { KIT, run, readJson, reporter, installFixture } from './it-helpers.mjs';

const rep = reporter();
const { ok, bad } = rep;
console.log('\n🌀 ContextDevKit integration test — core\n');
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
  // ADR-0041/0042: the grade-blind regression cell lives in
  // integration-test-guards.mjs (testGateGradeBlind) — line budget here.
  script('mark-simulation.mjs', 'cover secure', 'src/secure/');
  hook('simulate-gate.mjs', { session_id: 'it', tool_name: 'Write', tool_input: { file_path: 'src/secure/x.js' } }).trim() === ''
    ? ok('L5 gate allows after /simulate-impact')
    : bad('L5 gate still blocked after simulation');
  // Ancestor parity: /simulate-impact leaves a prediction trail file.
  existsSync(join(proj, 'contextkit', 'memory', 'predictions')) && readdirSync(join(proj, 'contextkit', 'memory', 'predictions')).some((f) => f.endsWith('.md'))
    ? ok('simulate-impact writes a prediction file (predictions/)')
    : bad('no prediction file written');
  // Pluggable-detector seed (026): README + inert example install (discoverable, not auto-run).
  existsSync(join(proj, 'contextkit', 'detectors', 'README.md')) && existsSync(join(proj, 'contextkit', 'detectors', 'example-detector.mjs.example'))
    ? ok('detectors seed installed (README + .example, discoverable)') : bad('detectors seed not installed');
  // Ancestor parity: workflow guides (L1–L6) + reusable playbooks are installed.
  existsSync(join(proj, 'contextkit', 'workflows', 'README.md')) &&
    ['tech-debt-sweep.md', 'simulate-impact.md', 'distillation-cycle.md', 'security-batch.md']
      .every((f) => existsSync(join(proj, 'contextkit', 'workflows', 'playbooks', f)))
    ? ok('workflows + playbooks installed (workflows/playbooks/)')
    : bad('workflows/playbooks not installed');
  // Ancestor parity #1 (loop closed): predictions-review fills the Actual section.
  script('predictions-review.mjs');
  const predMd = readdirSync(join(proj, 'contextkit', 'memory', 'predictions')).find((f) => f.endsWith('.md'));
  const predBody = predMd ? readFileSync(join(proj, 'contextkit', 'memory', 'predictions', predMd), 'utf-8') : '';
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

  // 008 — a booting session must NOT delete a concurrent session's fresh/empty ledger.
  const concLedger = join(proj, '.claude', '.sessions', 'concurrent.json');
  writeFileSync(concLedger, JSON.stringify({ sessionId: 'concurrent', startedAt: Date.now(), modifications: [], registered: false, stopWarnedAt: null, simulations: [] }));
  hook('session-start.mjs', { session_id: 'booting-now' });
  existsSync(concLedger) ? ok('session-start preserves a concurrent session fresh ledger (008)') : bad('session-start deleted a concurrent fresh ledger');

  // Safe --update: preserves CLAUDE.md, config (level + overrides), memory.
  writeFileSync(join(proj, 'CLAUDE.md'), readFileSync(join(proj, 'CLAUDE.md'), 'utf-8') + '\n## USER MARKER\n');
  run([join(KIT, 'install.mjs'), '--target', proj, '--update']);
  const afterCfg = readJson(join(proj, 'contextkit', 'config.json'));
  readFileSync(join(proj, 'CLAUDE.md'), 'utf-8').includes('USER MARKER') && afterCfg.level === 5 && !existsSync(join(proj, 'CLAUDE.contextdevkit.md'))
    ? ok('--update preserves CLAUDE.md + level (no data loss)')
    : bad('--update lost data (CLAUDE.md/level/side-file)');

  // setup-complete silences the trigger.
  script('setup-complete.mjs');
  !hook('session-start.mjs', {}).includes('First run')
    ? ok('first-run trigger silent after setup-complete')
    : bad('trigger still firing after setup-complete');

  // context-level down to L2 removes PreToolUse wiring.
  script('context-level.mjs', '2');
  const settings = readJson(join(proj, '.claude', 'settings.json'));
  !settings.hooks?.PreToolUse ? ok('context-level 2 removes the L5 PreToolUse hook') : bad('PreToolUse still wired at L2');
  settings.hooks?.SessionStart && settings.hooks?.Stop ? ok('context-level 2 keeps L1/L2 hooks') : bad('L1/L2 hooks lost');
  // L7 is a valid capability-tier level (no new hook beyond L5/L6).
  script('context-level.mjs', '7');
  readJson(join(proj, 'contextkit', 'config.json')).level === 7 ? ok('context-level 7 sets the L7 capability tier') : bad('context-level 7 not applied');

  // GitHub templates + QA/compliance/design/security agents + two-tier briefings.
  existsSync(join(proj, '.github', 'PULL_REQUEST_TEMPLATE.md')) ? ok('GitHub PR template installed') : bad('PR template not installed');
  existsSync(join(proj, '.claude', 'agents', 'qa-orchestrator.md')) ? ok('QA squad agents installed (L5)') : bad('qa-orchestrator agent missing');
  existsSync(join(proj, 'contextkit', 'squads', 'README.md')) ? ok('squad manifest installed') : bad('squads/README.md missing');
  existsSync(join(proj, '.claude', 'agents', 'privacy-lgpd.md')) && existsSync(join(proj, '.claude', 'agents', 'ux-designer.md'))
    ? ok('compliance + design squads installed') : bad('new squad agents missing');
  existsSync(join(proj, '.claude', 'agents', 'infra-security.md')) ? ok('security-team infra-security agent installed') : bad('infra-security agent missing');
  script('squad.mjs', 'brief', 'security');
  existsSync(join(proj, 'contextkit', 'squads', 'security-team', 'security.md'))
    ? ok('squad brief scaffolds a tier-2 briefing (squads/<team>/)') : bad('squad brief did not scaffold');

  // Status-line widget: wired into settings.json + runs and prints a line.
  readJson(join(proj, '.claude', 'settings.json')).statusLine?.command?.includes('contextkit/runtime/statusline')
    ? ok('statusLine widget wired into settings.json') : bad('statusLine not wired into settings.json');
  (run([join(proj, 'contextkit', 'runtime', 'statusline.mjs')], { cwd: proj }).stdout || '').includes('🌀')
    ? ok('statusline.mjs prints a status line') : bad('statusline.mjs produced no output');

  // context-config show/set round-trip.
  script('context-config.mjs', 'set', 'qa.coverageTarget.lines', '90');
  const showOut = script('context-config.mjs', 'show', 'qa.coverageTarget.lines').stdout || '';
  showOut.trim() === '90' ? ok('context-config set/show round-trips') : bad(`context-config round-trip failed: ${showOut}`);

  // doctor runs and reports — and accepts the current level (L7 set above) as valid,
  // not "out of range" (regression guard for the level-range cap).
  const doc = script('doctor.mjs');
  /ContextDevKit doctor/i.test(doc.stdout || '') && !/level.*out of range/i.test(doc.stdout || '')
    ? ok('doctor runs + accepts L7 as a valid level') : bad(`doctor failed/flagged level: ${doc.stdout || doc.stderr}`);

  // L5/L6 scanners run and produce JSON.
  const debt = script('tech-debt-scan.mjs', '--json');
  (() => { try { return Array.isArray(JSON.parse(debt.stdout).findings); } catch { return false; } })()
    ? ok('tech-debt-scan emits JSON findings') : bad(`tech-debt-scan failed: ${debt.stderr}`);
  const stats = script('stats.mjs', '--json');
  (() => { try { return typeof JSON.parse(stats.stdout).driftRatePct === 'number'; } catch { return false; } })()
    ? ok('stats emits JSON metrics') : bad(`stats failed: ${stats.stderr}`);

  // best-practices doc + business-rules scaffold installed.
  existsSync(join(proj, 'contextkit', 'best-practices.md')) ? ok('best-practices.md installed') : bad('best-practices.md missing');
  existsSync(join(proj, 'contextkit', 'memory', 'business-rules', '_TEMPLATE.md')) ? ok('business-rules/ scaffolded (ancestor parity)') : bad('business-rules template missing');

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
  // Optional AST contract drift (#001): with a parser available (fake via CONTEXT_CONTRACT_PARSER),
  // extraction uses the AST, not regex — the baseline reflects AST-derived names.
  const astCfg = readJson(cfgPath);
  astCfg.l5.contractGlobs = ['src/ast/'];
  writeFileSync(cfgPath, JSON.stringify(astCfg, null, 2));
  mkdirSync(join(proj, 'src', 'ast'), { recursive: true });
  writeFileSync(join(proj, 'src', 'ast', 'mod.js'), 'export const regexName = 1;\n');
  writeFileSync(join(proj, '_fakeparser.mjs'), 'export function parse(){return{body:[{type:"ExportDefaultDeclaration"},{type:"ExportNamedDeclaration",specifiers:[{exported:{name:"astOnly"}}]}]};}\n');
  run([join(proj, 'contextkit', 'tools', 'scripts', 'contract-scan.mjs'), '--save'], { cwd: proj, env: { ...process.env, CONTEXT_CONTRACT_PARSER: join(proj, '_fakeparser.mjs') } });
  const astBaseline = readFileSync(join(proj, 'contextkit', 'memory', 'contract-baseline.json'), 'utf-8');
  astBaseline.includes('astOnly') && !astBaseline.includes('regexName')
    ? ok('contract-scan uses the optional AST parser when importable') : bad(`AST path not used: ${astBaseline}`);

  // Playbook management (#8): the registry lists installed playbooks; run records a tracked entry.
  const pbList = script('playbook.mjs', 'list').stdout || '';
  pbList.includes('tech-debt-sweep') && pbList.includes('security-batch')
    ? ok('playbook list shows the registry') : bad(`playbook list missing entries: ${pbList}`);
  script('playbook.mjs', 'run', 'tech-debt-sweep', 'IT run');
  const pbRuns = existsSync(join(proj, 'contextkit', 'memory', 'playbook-runs.md'))
    && readFileSync(join(proj, 'contextkit', 'memory', 'playbook-runs.md'), 'utf-8');
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
  writeFileSync(join(proj, 'contextkit', 'memory', 'sessions', '2026-01-01-01-x.md'), '# x\n');
  writeFileSync(join(proj, 'contextkit', 'memory', 'predictions', 'unrev.md'), '# Prediction\n\n## Actual — fill on review\n');
  hook('session-start.mjs', {}).includes('/predictions-review')
    ? ok('predictions-review cadence reminds when a review is due') : bad('no predictions-review cadence reminder');

  // Roadmap seeded (undefined) + find reports it as not-defined.
  existsSync(join(proj, 'contextkit', 'memory', 'roadmap.md')) ? ok('roadmap.md installed') : bad('roadmap.md missing');
  const rm = script('roadmap.mjs', 'find', '--json');
  (() => { try { return JSON.parse(rm.stdout).canonicalDefined === false; } catch { return false; } })()
    ? ok('roadmap find reports undefined (seed placeholder)') : bad(`roadmap find failed: ${rm.stderr || rm.stdout}`);

  // ADR-0033 — engine-update signal: a changed .engine-version is announced once on the next boot.
  hook('session-start.mjs', {}); // establish the "seen" marker for the current version
  writeFileSync(join(proj, 'contextkit', '.engine-version'), '9.9.9\n');
  hook('session-start.mjs', {}).includes('engine updated to **v9.9.9**')
    ? ok('session-start announces an engine update across sessions (ADR-0033)')
    : bad('engine-update signal not emitted');

  // ADR-0033 — weekly value line surfaces sessions + ADRs (local-only, no PII).
  writeFileSync(join(proj, 'contextkit', 'memory', 'decisions', '0099-x.md'), '# x\n');
  rmSync(join(proj, '.claude', '.sessions', '.value-nudge'), { force: true });
  hook('session-start.mjs', {}).includes('ContextDevKit here:')
    ? ok('boot value line surfaces accrued value (ADR-0033)')
    : bad('boot value line not emitted');

  // ADR-0034 — open bugs surface at boot.
  script('pipeline.mjs', 'add', '--type', 'bug', '--priority', 'P0', '--title', 'boot bug signal test');
  hook('session-start.mjs', {}).includes('Open bugs awaiting resolution')
    ? ok('session-start surfaces open bugs (ADR-0034)')
    : bad('open-bugs boot signal missing');

  // ADR-0034 — Stop hook auto-concludes a working task whose acceptance criteria are all checked.
  mkdirSync(join(proj, 'contextkit', 'pipeline', 'working'), { recursive: true });
  writeFileSync(join(proj, 'contextkit', 'pipeline', 'working', '077-autoadv.md'),
    '---\nid: 077\ntitle: autoadv\ntype: chore\nstatus: working\n---\n\n## autoadv\n\n**Acceptance criteria:**\n- [x] one\n- [x] two\n');
  mkdirSync(join(proj, '.claude', '.workspace'), { recursive: true });
  writeFileSync(join(proj, '.claude', '.workspace', 'autoadv.json'), JSON.stringify({ sessionId: 'autoadv', tasks: [{ id: '077' }], claims: [] }));
  hook('check-registration.mjs', { session_id: 'autoadv' });
  existsSync(join(proj, 'contextkit', 'pipeline', 'conclusion', '077-autoadv.md')) && !existsSync(join(proj, 'contextkit', 'pipeline', 'working', '077-autoadv.md'))
    ? ok('Stop hook auto-concludes a fully-checked task (ADR-0034)')
    : bad('auto-advance did not conclude the all-checked task');

  // ADR-0035 (task 080) — deliberation nudge: soft, never-blocks, level-gated, debounced.
  const setDelib = (extra) => {
    const c = readJson(cfgPath);
    c.level = 5;
    c.l5.highRiskPaths = ['src/secure/'];
    c.deliberations = { active: true, voices: 3, minLevel: 5, nudgeOnHighRisk: true, ...extra };
    writeFileSync(cfgPath, JSON.stringify(c, null, 2));
  };
  setDelib();
  const dn1 = hook('deliberation-nudge.mjs', { session_id: 'delibA', tool_name: 'Write', tool_input: { file_path: 'src/secure/x.js' } });
  dn1.includes('<deliberation-nudge>') && !dn1.includes('"decision"')
    ? ok('deliberation-nudge suggests /debate on a high-risk edit, never blocks (ADR-0035)')
    : bad(`deliberation-nudge missing or blocked: ${dn1}`);
  hook('deliberation-nudge.mjs', { session_id: 'delibA', tool_name: 'Write', tool_input: { file_path: 'src/secure/y.js' } }).trim() === ''
    ? ok('deliberation-nudge debounces to once per session (ADR-0035)')
    : bad('deliberation-nudge fired twice in one session');
  hook('deliberation-nudge.mjs', { session_id: 'delibB', tool_name: 'Write', tool_input: { file_path: 'src/normal.js' } }).trim() === ''
    ? ok('deliberation-nudge silent on a non-high-risk path')
    : bad('deliberation-nudge fired on a non-high-risk path');
  setDelib({ minLevel: 6 });
  hook('deliberation-nudge.mjs', { session_id: 'delibC', tool_name: 'Write', tool_input: { file_path: 'src/secure/z.js' } }).trim() === ''
    ? ok('deliberation-nudge is silent below minLevel (ADR-0035)')
    : bad('deliberation-nudge fired below minLevel');
  setDelib({ nudgeOnHighRisk: false });
  hook('deliberation-nudge.mjs', { session_id: 'delibD', tool_name: 'Write', tool_input: { file_path: 'src/secure/w.js' } }).trim() === ''
    ? ok('deliberation-nudge respects nudgeOnHighRisk:false (toggle)')
    : bad('deliberation-nudge ignored the off toggle');

  // ADR-0035 (task 082) — deliberations reindex: filesystem → DELIBERATIONS.md, badges, ordering.
  const delibDir = join(proj, 'contextkit', 'memory', 'deliberations');
  mkdirSync(delibDir, { recursive: true });
  writeFileSync(join(delibDir, '2026-02-01-01-alpha.md'), '# Deliberation: Alpha\n\n- **Status**: resolved\n');
  writeFileSync(join(delibDir, '2026-02-02-02-beta.md'), '# Deliberation: Beta\n\n- **Status**: unresolved\n');
  writeFileSync(join(delibDir, 'not-a-deliberation.md'), '# junkentry\n'); // malformed name → ignored
  script('deliberations-reindex.mjs');
  const delibIndex = readFileSync(join(proj, 'contextkit', 'memory', 'DELIBERATIONS.md'), 'utf-8');
  delibIndex.includes('Alpha') && delibIndex.includes('Beta') && delibIndex.includes('✅ resolved') && delibIndex.includes('⚖️ unresolved') && delibIndex.indexOf('Beta') < delibIndex.indexOf('Alpha') && !delibIndex.includes('junkentry')
    ? ok('deliberations-reindex: both entries, status badges, newest-first, malformed ignored (ADR-0035)')
    : bad(`deliberations-reindex output wrong: ${delibIndex}`);
} catch (err) {
  bad(`crashed: ${err?.stack || err}`);
} finally {
  fx.cleanup();
}

rep.finish('Integration (core)');
