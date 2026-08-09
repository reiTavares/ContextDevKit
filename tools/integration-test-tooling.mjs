#!/usr/bin/env node
/**
 * ContextDevKit integration test — TOOLING scripts.
 *
 * Installs the kit into a throwaway temp project and exercises the tool scripts
 * (modular CLAUDE.md, git, deep-analysis, security mode, deps-audit, gh-alerts,
 * fleet, agent-tuning, …). One focused sibling carries the longer subsystem:
 * `integration-test-tooling-agent-forge.mjs` (forge round-trip + Fase 6
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
  // Antigravity host assertions live in integration-test-antigravity.mjs (ADR-0048).

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

  // project-map has its own suite → integration-test-project-map.mjs.

  // Version control: git.mjs reports a repo with no remote (temp project has none).
  const gitStatus = script('git.mjs', 'status', '--json');
  (() => { try { const g = JSON.parse(gitStatus.stdout); return g.isRepo === true && g.remoteUrl === null && g.pr === null; } catch { return false; } })()
    ? ok('git.mjs reports repo + missing remote (no PR layer without a remote)') : bad(`git.mjs failed: ${gitStatus.stdout || gitStatus.stderr}`);

  // ADR-0047 A1 — PR fact: an unanswerable gh lookup is SKIPPED, never "none" (rule 8).
  // Deterministic both ways: gh unauthed (CI) and gh authed against a nonexistent repo
  // (dev machine) both end on the skipped path.
  git(['remote', 'add', 'origin', 'https://github.com/contextdevkit/it-fake-repo.git'], proj);
  const gitPr = script('git.mjs', 'status', '--json');
  (() => { try { const g = JSON.parse(gitPr.stdout); return g.provider === 'github' && g.pr?.status === 'skipped'; } catch { return false; } })()
    ? ok('git.mjs PR fact degrades to skipped, never a false "none" (ADR-0047 A1, rule 8)')
    : bad(`git.mjs PR fact wrong: ${gitPr.stdout || gitPr.stderr}`);
  git(['remote', 'remove', 'origin'], proj);

  // ContextDevKit 4.0 — regulated-domain vocabulary is advisory and does not force ceremony.
  const clsLgpd = script('complexity-rubric.mjs', 'classify', 'store user CPF and consent', '--json');
  (() => { try { const j = JSON.parse(clsLgpd.stdout); return j.domain === 'lgpd' && j.recommendedAgents.includes('privacy-lgpd') && j.tier === 'feature' && j.needsAdr === false; } catch { return false; } })()
    ? ok('complexity-rubric reports LGPD risk without forcing architectural ceremony')
    : bad(`complexity-rubric LGPD classify failed: ${clsLgpd.stdout || clsLgpd.stderr}`);
  const clsTrivial = script('complexity-rubric.mjs', 'classify', 'fix typo in readme', '--json');
  (() => { try { const j = JSON.parse(clsTrivial.stdout); return j.tier === 'trivial' && j.needsAdr === false && j.domain === 'general'; } catch { return false; } })()
    ? ok('complexity-rubric classifies a trivial task with no ceremony')
    : bad(`complexity-rubric trivial classify failed: ${clsTrivial.stdout || clsTrivial.stderr}`);

  // ContextDevKit 4 — the compatibility template is visibly non-authoritative;
  // new ADRs are generated through the canonical Decision CLI.
  const vdTpl = script('validate-doc.mjs', 'contextkit/memory/decisions/_TEMPLATE.md', '--json');
  const installedDecisionReference = readFileSync(join(proj, 'contextkit', 'memory', 'decisions', '_TEMPLATE.md'), 'utf-8');
  (() => { try { const j = JSON.parse(vdTpl.stdout); return j.type === 'adr' && j.errorCount > 0 && /do not copy/i.test(installedDecisionReference); } catch { return false; } })()
    ? ok('legacy ADR template is an explicit rejected compatibility reference')
    : bad(`ADR compatibility reference check failed: ${vdTpl.stdout || vdTpl.stderr}`);
  const installedDecisionStandard = join(proj, 'contextkit', 'memory', 'decisions', 'README.md');
  existsSync(installedDecisionStandard)
    && /canonical Decision CLI/.test(readFileSync(installedDecisionStandard, 'utf-8'))
    && !existsSync(join(proj, 'contextkit', 'memory', 'decisions', '0000-record-architecture-decisions.md'))
    ? ok('installer publishes the canonical ADR authoring standard')
    : bad('installer did not publish the canonical ADR authoring standard');

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

  // ADR-0034 — adr-tasks parses an ADR's Decision into proposed backlog tasks.
  writeFileSync(join(proj, 'contextkit', 'memory', 'decisions', '0050-x.md'),
    '# ADR-0050: x\n\n## Decision\n\n1. **Do the first thing.**\n2. **Do the second thing.**\n\n## Consequences\n- ok\n');
  const at = script('adr-tasks.mjs', '0050', '--json');
  (() => { try { const j = JSON.parse(at.stdout); return j.adrId === '0050' && j.tasks.length === 2; } catch { return false; } })()
    ? ok('adr-tasks parses the Decision into backlog tasks (ADR-0034)')
    : bad(`adr-tasks failed: ${at.stdout || at.stderr}`);

  // Canonical task-store and CLI cutover behavior lives in pipeline-cutover.selftest.mjs.

  // Deep analysis: aggregates the deterministic scanners into one report.
  const deep = JSON.parse(script('deep-analysis.mjs', '--json').stdout || '{}');
  deep.byScan && typeof deep.total === 'number' && Array.isArray(deep.findings)
    ? ok('deep-analysis aggregates scanners into one report') : bad(`deep-analysis failed: ${JSON.stringify(deep).slice(0, 120)}`);

  // Security: a crafted base-branch arg must reach git LITERALLY (one invalid ref →
  // non-zero exit), not be split by a shell — proves no shell was involved.
  const wt = script('worktree-new.mjs', 'feat', 'HEAD; echo INJECTED_PWNED');
  wt.status !== 0
    ? ok('worktree-new passes the base-branch arg literally (no shell injection)')
    : bad('worktree-new shell injection NOT neutralized (a shell split the arg)');

  // tech-debt --ci is DEMOTED to REPORT-ONLY (WF-0057 W6, ADR-0122): the
  // governance gate owns CI blocking now, so this legacy path always exits 0 and
  // prints an advisory line (never an enforcing CI-gate verdict).
  const debtCi = script('tech-debt-scan.mjs', '--ci');
  debtCi.status === 0 && /tech-debt \(advisory\)/.test(debtCi.stdout || '')
    ? ok('tech-debt --ci is advisory/report-only (governance gate owns CI blocking)')
    : bad(`tech-debt --ci report-only check failed: ${debtCi.stdout || debtCi.stderr}`);

  // Pluggable detectors: a drop-in contextkit/detectors/*.mjs is loaded and its findings appear.
  mkdirSync(join(proj, 'contextkit', 'detectors'), { recursive: true });
  writeFileSync(join(proj, 'contextkit', 'detectors', 'custom.mjs'),
    "export default function detectFooBar(p, c) { return c.includes('FOOBAR') ? [{ kind: 'custom-foobar', severity: 2, path: p, line: 1, message: 'FOOBAR marker' }] : []; }\n");
  mkdirSync(join(proj, 'src'), { recursive: true });
  writeFileSync(join(proj, 'src', 'marker.js'), '// FOOBAR\n');
  JSON.parse(script('tech-debt-scan.mjs', '--json').stdout || '{"findings":[]}').findings.some((f) => f.kind === 'custom-foobar')
    ? ok('tech-debt-scan loads a drop-in custom detector (contextkit/detectors/)') : bad('custom detector not loaded');

  // Stack presets tune risk and QA hints without reviving a path-based state ledger.
  run([join(KIT, 'install.mjs'), '--target', proj, '--update', '--preset', 'go']);
  (readJson(cfgPath).l5?.highRiskPaths || []).includes('internal/auth/')
    ? ok('install --preset merges advisory stack risk paths') : bad('preset risk paths not merged into config');

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

  // ADR-0047 A5 — --registry: an unreachable registry is a SKIP finding, never a pass.
  const regOut = run([join(proj, 'contextkit', 'tools', 'scripts', 'deps-audit.mjs'), '--registry', '--json'],
    { cwd: proj, env: { ...process.env, CONTEXT_NPM_REGISTRY: 'http://127.0.0.1:9' } });
  (() => { try { return JSON.parse(regOut.stdout).findings.some((f) => f.kind === 'registry-skipped'); } catch { return false; } })()
    ? ok('deps-audit --registry reports an unreachable registry as skipped, not a pass (ADR-0047 A5, rule 8)')
    : bad(`--registry skip finding missing: ${regOut.stdout || regOut.stderr}`);

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
