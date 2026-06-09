#!/usr/bin/env node
/**
 * ContextDevKit integration test — TOOLING scripts.
 *
 * Installs the kit into a throwaway temp project and exercises the tool scripts
 * (modular CLAUDE.md, git, deep-analysis, security mode, deps-audit, gh-alerts,
 * fleet, agent-tuning, …). Two focused siblings carry the longer subsystems:
 * `integration-test-tooling-pipeline.mjs` (DevPipeline, ADR-0016 H1 split)
 * and `integration-test-tooling-agent-forge.mjs` (forge round-trip + Fase 6
 * pipeline DSL — split when Fase 6 pushed this file past the RED zone, as the
 * cohesion note had anticipated). The core hooks/engine are covered by
 * `integration-test.mjs`. Shared harness: `it-helpers.mjs`.
 *
 * Cohesion note (line budget): the remaining ~13 tool checks share ONE
 * fixture install at L5 and run in dependency order under a single
 * try/finally — that is the responsibility seam (one install, many tool
 * scripts). The next natural extraction when budget pressure returns is the
 * deps-audit + GitHub security batch (the next-longest cohesive subsystem).
 *
 * Run:  node tools/integration-test-tooling.mjs   (exit 0 = healthy)
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { KIT, run, git, readJson, reporter, installFixture } from './it-helpers.mjs';

const rep = reporter();
const { ok, bad } = rep;
console.log('\n🌀 ContextDevKit integration test — tooling\n');
const fx = installFixture(rep);
const { proj, cfgPath, hook, script } = fx;

try {
  // Antigravity integration: the install produced the agent assets, CLI runner, and instructions.
  existsSync(join(proj, '.antigravity', 'agents')) && existsSync(join(proj, '.antigravity', 'skills')) &&
    existsSync(join(proj, 'ctx.mjs')) && existsSync(join(proj, 'INSTRUCTIONS.md'))
    ? ok('Antigravity assets installed (.antigravity/{agents,skills} + ctx.mjs + INSTRUCTIONS.md)')
    : bad('Antigravity assets not installed by the installer');

  // Modular CLAUDE.md: two apps lacking CLAUDE.md → scaffold creates both.
  mkdirSync(join(proj, 'apps', 'api'), { recursive: true });
  mkdirSync(join(proj, 'apps', 'web'), { recursive: true });
  writeFileSync(join(proj, 'apps', 'api', 'package.json'), '{"name":"api"}');
  writeFileSync(join(proj, 'apps', 'web', 'package.json'), '{"name":"web"}');
  const cmFind = script('claude-md.mjs', 'find', '--json');
  (() => { try { return JSON.parse(cmFind.stdout).moduleRoots.length === 2; } catch { return false; } })()
    ? ok('claude-md detects 2 module roots') : bad(`claude-md find failed: ${cmFind.stdout || cmFind.stderr}`);
  script('claude-md.mjs', 'scaffold');
  existsSync(join(proj, 'apps', 'api', 'CLAUDE.md')) && existsSync(join(proj, 'apps', 'web', 'CLAUDE.md'))
    ? ok('claude-md scaffolds scoped CLAUDE.md per module') : bad('module CLAUDE.md not scaffolded');

  // Version control: git.mjs reports a repo with no remote (temp project has none).
  const gitStatus = script('git.mjs', 'status', '--json');
  (() => { try { const g = JSON.parse(gitStatus.stdout); return g.isRepo === true && g.remoteUrl === null; } catch { return false; } })()
    ? ok('git.mjs reports repo + missing remote') : bad(`git.mjs failed: ${gitStatus.stdout || gitStatus.stderr}`);

  // ADR-0030 — complexity rubric: regulated domain auto-routes + forces architectural tier.
  const clsLgpd = script('complexity-rubric.mjs', 'classify', 'store user CPF and consent', '--json');
  (() => { try { const j = JSON.parse(clsLgpd.stdout); return j.domain === 'lgpd' && j.requiredAgents.includes('privacy-lgpd') && j.tier === 'architectural' && j.needsAdr === true; } catch { return false; } })()
    ? ok('complexity-rubric routes a regulated (LGPD) task to privacy-lgpd + architectural tier')
    : bad(`complexity-rubric LGPD classify failed: ${clsLgpd.stdout || clsLgpd.stderr}`);
  const clsTrivial = script('complexity-rubric.mjs', 'classify', 'fix typo in readme', '--json');
  (() => { try { const j = JSON.parse(clsTrivial.stdout); return j.tier === 'trivial' && j.needsAdr === false && j.domain === 'general'; } catch { return false; } })()
    ? ok('complexity-rubric classifies a trivial task with no ceremony')
    : bad(`complexity-rubric trivial classify failed: ${clsTrivial.stdout || clsTrivial.stderr}`);

  // ADR-0030 — validate-doc flags an unfilled ADR template (placeholders), runs the adr rubric.
  const vdTpl = script('validate-doc.mjs', 'contextkit/memory/decisions/_TEMPLATE.md', '--json');
  (() => { try { const j = JSON.parse(vdTpl.stdout); return j.type === 'adr' && j.errorCount > 0 && j.findings.some((f) => f.code === 'PLACEHOLDER'); } catch { return false; } })()
    ? ok('validate-doc flags an unfilled ADR template (placeholders)')
    : bad(`validate-doc template check failed: ${vdTpl.stdout || vdTpl.stderr}`);

  // ADR-0030 — draft-changelog groups Conventional Commits since the last tag.
  git(['add', '-A'], proj);
  git(['commit', '-m', 'feat(x): add a thing', '--no-verify'], proj);
  const dc = script('draft-changelog.mjs', '--json');
  (() => { try { const j = JSON.parse(dc.stdout); return Array.isArray(j.groups?.Added) && j.groups.Added.some((i) => i.text.includes('add a thing')); } catch { return false; } })()
    ? ok('draft-changelog groups Conventional Commits into Keep-a-Changelog sections')
    : bad(`draft-changelog failed: ${dc.stdout || dc.stderr}`);

  // ADR-0030 follow-up — installer scaffolds the Diátaxis docs spine; reindex is idempotent.
  existsSync(join(proj, 'docs', 'README.md')) && existsSync(join(proj, 'docs', 'reference', 'README.md'))
    ? ok('installer scaffolds the Diátaxis docs spine (buckets + index)')
    : bad('Diátaxis docs spine not scaffolded by installer');
  const dr = script('docs-reindex.mjs', '--json');
  (() => { try { const j = JSON.parse(dr.stdout); return j.ok === true && typeof j.buckets?.reference === 'number' && j.indexWritten === true; } catch { return false; } })()
    ? ok('docs-reindex regenerates the index idempotently')
    : bad(`docs-reindex failed: ${dr.stdout || dr.stderr}`);

  // ADR-0032 — pipeline `add` auto-classifies the title (regulated domain → route + architectural tier).
  const addOut = script('pipeline.mjs', 'add', '--type', 'feature', '--title', 'store user CPF and consent').stdout || '';
  addOut.includes('privacy-lgpd') && addOut.includes('architectural')
    ? ok('pipeline add auto-classifies + routes a regulated task (ADR-0032)')
    : bad(`pipeline add auto-classify failed: ${addOut}`);

  // ADR-0032 — session-draft pre-fills Done from the ledger.
  hook('track-edits.mjs', { session_id: 'sd', tool_name: 'Write', tool_input: { file_path: 'src/feature/x.js' } });
  const sd = script('session-draft.mjs', '--json');
  (() => { try { return JSON.parse(sd.stdout).files.includes('src/feature/x.js'); } catch { return false; } })()
    ? ok('session-draft drafts the Done section from the ledger (ADR-0032)')
    : bad(`session-draft failed: ${sd.stdout || sd.stderr}`);

  // ADR-0032 — advise-review tallies advise:<lane> tasks into a per-lane hit-rate.
  script('pipeline.mjs', 'add', '--type', 'chore', '--source', 'advise:ux', '--title', 'cap the boot drift banner');
  const ar = script('advise-review.mjs', '--json');
  (() => { try { const j = JSON.parse(ar.stdout); return j.rows.some((r) => r.lane === 'ux' && r.open >= 1) && typeof j.hitRatePct === 'number'; } catch { return false; } })()
    ? ok('advise-review computes per-lane advisor hit-rate (ADR-0032)')
    : bad(`advise-review failed: ${ar.stdout || ar.stderr}`);

  // ADR-0034 — adr-tasks parses an ADR's Decision into proposed backlog tasks.
  writeFileSync(join(proj, 'contextkit', 'memory', 'decisions', '0050-x.md'),
    '# ADR-0050: x\n\n## Decision\n\n1. **Do the first thing.**\n2. **Do the second thing.**\n\n## Consequences\n- ok\n');
  const at = script('adr-tasks.mjs', '0050', '--json');
  (() => { try { const j = JSON.parse(at.stdout); return j.adrId === '0050' && j.tasks.length === 2; } catch { return false; } })()
    ? ok('adr-tasks parses the Decision into backlog tasks (ADR-0034)')
    : bad(`adr-tasks failed: ${at.stdout || at.stderr}`);

  // DevPipeline tests live in `integration-test-tooling-pipeline.mjs` (sibling).

  // Deep analysis: aggregates the deterministic scanners into one report.
  const deep = JSON.parse(script('deep-analysis.mjs', '--json').stdout || '{}');
  deep.byScan && typeof deep.total === 'number' && Array.isArray(deep.findings)
    ? ok('deep-analysis aggregates scanners into one report') : bad(`deep-analysis failed: ${JSON.stringify(deep).slice(0, 120)}`);

  // Security mode: SessionStart reminds to /deep-analysis on the cadence (default-on).
  const secCfg = readJson(cfgPath);
  secCfg.securityMode = { active: true, everyNSessions: 1 };
  writeFileSync(cfgPath, JSON.stringify(secCfg, null, 2));
  writeFileSync(join(proj, 'contextkit', 'memory', 'sessions', '2026-01-01-01-x.md'), '# x');
  hook('session-start.mjs', { session_id: 'sec' }).includes('Security mode')
    ? ok('security-mode boot trigger fires on cadence') : bad('security-mode banner missing');
  secCfg.securityMode.active = false;
  writeFileSync(cfgPath, JSON.stringify(secCfg, null, 2));
  !hook('session-start.mjs', { session_id: 'sec' }).includes('Security mode')
    ? ok('security-mode disabled via config (active:false)') : bad('security-mode fired while disabled');

  // Security: a crafted base-branch arg must reach git LITERALLY (one invalid ref →
  // non-zero exit), not be split by a shell — proves no shell was involved.
  const wt = script('worktree-new.mjs', 'feat', 'HEAD; echo INJECTED_PWNED');
  wt.status !== 0
    ? ok('worktree-new passes the base-branch arg literally (no shell injection)')
    : bad('worktree-new shell injection NOT neutralized (a shell split the arg)');

  // tech-debt --ci gate: a clean project has no RED-zone finding → exits 0.
  const debtCi = script('tech-debt-scan.mjs', '--ci');
  debtCi.status === 0 && /CI gate/.test(debtCi.stdout || '')
    ? ok('tech-debt --ci gate passes on a clean project')
    : bad(`tech-debt --ci gate failed: ${debtCi.stdout || debtCi.stderr}`);

  // Pluggable detectors: a drop-in contextkit/detectors/*.mjs is loaded and its findings appear.
  mkdirSync(join(proj, 'contextkit', 'detectors'), { recursive: true });
  writeFileSync(join(proj, 'contextkit', 'detectors', 'custom.mjs'),
    "export default function detectFooBar(p, c) { return c.includes('FOOBAR') ? [{ kind: 'custom-foobar', severity: 2, path: p, line: 1, message: 'FOOBAR marker' }] : []; }\n");
  mkdirSync(join(proj, 'src'), { recursive: true });
  writeFileSync(join(proj, 'src', 'marker.js'), '// FOOBAR\n');
  JSON.parse(script('tech-debt-scan.mjs', '--json').stdout || '{"findings":[]}').findings.some((f) => f.kind === 'custom-foobar')
    ? ok('tech-debt-scan loads a drop-in custom detector (contextkit/detectors/)') : bad('custom detector not loaded');

  // Stack presets: install --preset merges stack paths into config (union with defaults).
  run([join(KIT, 'install.mjs'), '--target', proj, '--update', '--preset', 'go']);
  (readJson(cfgPath).ledger?.important || []).includes('internal/')
    ? ok('install --preset merges a stack preset into config') : bad('preset paths not merged into config');

  // Recommended start level (ADR-0009): greenfield auto-picks L3, existing auto-picks L7
  // (the latter also proves the level cap accepts 7 — a broken cap would downgrade to 2).
  const gdir = mkdtempSync(join(tmpdir(), 'contextkit-gf-'));
  const edir = mkdtempSync(join(tmpdir(), 'contextkit-ex-'));
  try {
    run([join(KIT, 'install.mjs'), '--target', gdir, '--yes']);
    readJson(join(gdir, 'contextkit', 'config.json')).level === 3
      ? ok('install auto-picks L3 for a greenfield project') : bad(`greenfield default not L3: ${readJson(join(gdir, 'contextkit', 'config.json')).level}`);
    mkdirSync(join(edir, 'src'), { recursive: true });
    writeFileSync(join(edir, 'src', 'index.js'), 'export const x = 1;\n');
    run([join(KIT, 'install.mjs'), '--target', edir, '--yes']);
    readJson(join(edir, 'contextkit', 'config.json')).level === 7
      ? ok('install auto-picks L7 for an existing project (+ level cap accepts 7)') : bad(`existing default not L7: ${readJson(join(edir, 'contextkit', 'config.json')).level}`);
  } finally {
    rmSync(gdir, { recursive: true, force: true });
    rmSync(edir, { recursive: true, force: true });
  }

  // Quality CI workflow scaffolded (contract-drift + tech-debt gates).
  existsSync(join(proj, '.github', 'workflows', 'quality.yml')) ? ok('quality CI workflow installed') : bad('quality.yml not installed');

  // Visual testing harness (#6): the scaffolder writes a Playwright starter; status detects it.
  script('visual-test.mjs', 'scaffold', '--js');
  existsSync(join(proj, 'playwright.config.js')) && existsSync(join(proj, 'tests', 'visual', 'home.spec.js'))
    ? ok('visual-test scaffolds a Playwright starter') : bad('visual-test did not scaffold');
  (() => { try { return JSON.parse(script('visual-test.mjs', 'status', '--json').stdout).set === true; } catch { return false; } })()
    ? ok('visual-test status detects the scaffolded harness') : bad('visual-test status missed the harness');

  // Dependency audit: flags no-lockfile + loose version ranges as findings.
  writeFileSync(join(proj, 'package.json'), JSON.stringify({ name: 'it', dependencies: { leftpad: '*' } }));
  const deps = JSON.parse(script('deps-audit.mjs', '--json').stdout || '{"findings":[]}').findings || [];
  deps.some((f) => f.kind === 'no-lockfile') && deps.some((f) => f.kind === 'loose-range')
    ? ok('deps-audit flags no-lockfile + loose ranges') : bad(`deps-audit findings: ${JSON.stringify(deps)}`);

  // Dependency policy: a denied license is flagged; --sbom writes a CycloneDX SBOM.
  const depCfg = readJson(cfgPath);
  depCfg.deps = { requireLockfile: true, licenses: { allow: [], deny: ['GPL-3.0'] } };
  writeFileSync(cfgPath, JSON.stringify(depCfg, null, 2));
  writeFileSync(join(proj, 'package.json'), JSON.stringify({ name: 'it', version: '1.0.0', dependencies: { gpllib: '1.0.0' } }));
  mkdirSync(join(proj, 'node_modules', 'gpllib'), { recursive: true });
  writeFileSync(join(proj, 'node_modules', 'gpllib', 'package.json'), JSON.stringify({ name: 'gpllib', version: '1.0.0', license: 'GPL-3.0' }));
  JSON.parse(script('deps-audit.mjs', '--json').stdout || '{"findings":[]}').findings.some((f) => f.kind === 'license-deny')
    ? ok('deps-audit flags a denied license (deps policy)') : bad('deps-audit did not flag the denied license');
  script('deps-audit.mjs', '--sbom');
  (() => { try { const s = readJson(join(proj, 'contextkit', 'memory', 'sbom.json')); return s.bomFormat === 'CycloneDX' && (s.components || []).some((c) => c.name === 'gpllib'); } catch { return false; } })()
    ? ok('deps-audit --sbom writes a CycloneDX SBOM') : bad('SBOM not written/invalid');

  // GitHub-native security: scaffolding + code-security agent installed; alert sync degrades safely.
  existsSync(join(proj, '.github', 'dependabot.yml')) && existsSync(join(proj, '.github', 'workflows', 'security.yml'))
    ? ok('GitHub security scaffolding installed (dependabot.yml + security workflow)') : bad('security scaffolding not installed');
  existsSync(join(proj, '.claude', 'agents', 'code-security.md')) ? ok('code-security agent installed (L5)') : bad('code-security agent missing');
  const ghAlerts = script('gh-alerts.mjs', '--json');
  ghAlerts.status === 0 && (() => { try { return Array.isArray(JSON.parse(ghAlerts.stdout).findings); } catch { return false; } })()
    ? ok('gh-alerts degrades safely without a GitHub repo (exit 0, empty findings)') : bad(`gh-alerts failed: ${ghAlerts.stdout || ghAlerts.stderr}`);

  // Fleet mode: register this project in a temp registry, aggregate stats across the fleet.
  const fleetEnv = { ...process.env, CONTEXT_FLEET_FILE: join(proj, '.fleet.json') };
  const fleet = (...a) => run([join(proj, 'contextkit', 'tools', 'scripts', 'fleet.mjs'), ...a], { cwd: proj, env: fleetEnv });
  fleet('add', proj);
  const fleetStats = fleet('stats', '--json');
  (() => { try { const d = JSON.parse(fleetStats.stdout); return d.totals.repos === 1 && d.repos[0]?.ok === true && typeof d.totals.totalSessions === 'number'; } catch { return false; } })()
    ? ok('fleet stats aggregates a registered repo (control plane)') : bad(`fleet failed: ${fleetStats.stdout || fleetStats.stderr}`);

  // Agent tuning: signal aggregation lists the installed agent roster (proposes only).
  const tuning = script('agent-tuning.mjs', '--json');
  (() => { try { const d = JSON.parse(tuning.stdout); return Array.isArray(d.agents) && d.agents.length >= 1 && typeof d.sessionsAnalyzed === 'number'; } catch { return false; } })()
    ? ok('agent-tuning aggregates the agent roster + signals') : bad(`agent-tuning failed: ${tuning.stdout || tuning.stderr}`);

  // ─ Ticket 056: media-gen content-addressed cache (fake adapter, no network) ─
  const mediaDir = join(proj, 'contextkit', 'runtime', 'providers', 'media');
  const callLog = join(proj, '.fake-media-calls.log');
  writeFileSync(join(mediaDir, 'zz-fake.mjs'), [
    "import { writeFileSync, appendFileSync } from 'node:fs';",
    "export const id = 'fake-img'; export const kind = 'image';",
    "export const envVar = 'FAKE_MEDIA_KEY'; export const requiredEnv = ['FAKE_MEDIA_KEY'];",
    'export function estimateCostUsd() { return 1.23; }',
    'export async function generate({ prompt, outPath }) {',
    "  appendFileSync(process.env.FAKE_CALL_LOG, 'x');",
    "  writeFileSync(outPath, 'IMG:' + prompt);",
    "  return { outPath, durationMs: 1, costEstimateUsd: 1.23, providerRequestId: 'fake' };",
    '}',
  ].join('\n'));
  const mgEnv = { ...process.env, FAKE_MEDIA_KEY: 'set', FAKE_CALL_LOG: callLog };
  const mg = (...a) => run([join(proj, 'contextkit', 'tools', 'scripts', 'media-gen.mjs'), ...a], { cwd: proj, env: mgEnv });
  const calls = () => (existsSync(callLog) ? readFileSync(callLog, 'utf-8').length : 0);
  mg('image', '--provider', 'fake-img', '--prompt', 'hello world', '--out', 'out1.png');
  const callsAfterFirst = calls();
  mg('image', '--provider', 'fake-img', '--prompt', 'hello world', '--out', 'out2.png');
  callsAfterFirst === 1 && calls() === 1 && existsSync(join(proj, 'out2.png'))
    ? ok('media-gen serves a cache hit on the 2nd identical call — no provider call (ticket 056)')
    : bad(`media cache miss: after1=${callsAfterFirst} after2=${calls()}`);
  mg('image', '--provider', 'fake-img', '--prompt', 'hello world', '--out', 'out3.png', '--no-cache');
  calls() === 2 ? ok('media-gen --no-cache bypasses the cache (ticket 056)') : bad(`--no-cache did not bypass: calls=${calls()}`);

  // agent-forge round-trip + Fase 6 pipeline DSL → integration-test-tooling-agent-forge.mjs.
} catch (err) {
  bad(`crashed: ${err?.stack || err}`);
} finally {
  fx.cleanup();
}

rep.finish('Integration (tooling)');
