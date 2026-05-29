#!/usr/bin/env node
/**
 * VibeDevKit integration test — TOOLING scripts.
 *
 * Installs the kit into a throwaway temp project and exercises the tool scripts
 * (modular CLAUDE.md, git, deep-analysis, security mode, deps-audit, gh-alerts,
 * fleet, agent-tuning, agent-forge round-trip, …). The DevPipeline chain has
 * its own focused sibling at `integration-test-tooling-pipeline.mjs` (ADR-0016
 * H1 split). The core hooks/engine are covered by `integration-test.mjs`.
 * Shared harness: `it-helpers.mjs`.
 *
 * Cohesion note (line budget): the remaining 18-ish tool checks share ONE
 * fixture install at L5 and run in dependency order under a single
 * try/finally — that is the responsibility seam (one install, many tool
 * scripts). The next natural extraction when budget pressure returns is the
 * agent-forge round-trip block (the longest single subsystem); recorded as
 * a follow-up, not done in this split.
 *
 * Run:  node tools/integration-test-tooling.mjs   (exit 0 = healthy)
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { KIT, run, readJson, reporter, installFixture } from './it-helpers.mjs';

const rep = reporter();
const { ok, bad } = rep;
console.log('\n🌀 VibeDevKit integration test — tooling\n');
const fx = installFixture(rep);
const { proj, cfgPath, hook, script } = fx;

try {
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

  // DevPipeline tests live in `integration-test-tooling-pipeline.mjs` (sibling).

  // Deep analysis: aggregates the deterministic scanners into one report.
  const deep = JSON.parse(script('deep-analysis.mjs', '--json').stdout || '{}');
  deep.byScan && typeof deep.total === 'number' && Array.isArray(deep.findings)
    ? ok('deep-analysis aggregates scanners into one report') : bad(`deep-analysis failed: ${JSON.stringify(deep).slice(0, 120)}`);

  // Security mode: SessionStart reminds to /deep-analysis on the cadence (default-on).
  const secCfg = readJson(cfgPath);
  secCfg.securityMode = { active: true, everyNSessions: 1 };
  writeFileSync(cfgPath, JSON.stringify(secCfg, null, 2));
  writeFileSync(join(proj, 'vibekit', 'memory', 'sessions', '2026-01-01-01-x.md'), '# x');
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

  // Pluggable detectors: a drop-in vibekit/detectors/*.mjs is loaded and its findings appear.
  mkdirSync(join(proj, 'vibekit', 'detectors'), { recursive: true });
  writeFileSync(join(proj, 'vibekit', 'detectors', 'custom.mjs'),
    "export default function detectFooBar(p, c) { return c.includes('FOOBAR') ? [{ kind: 'custom-foobar', severity: 2, path: p, line: 1, message: 'FOOBAR marker' }] : []; }\n");
  mkdirSync(join(proj, 'src'), { recursive: true });
  writeFileSync(join(proj, 'src', 'marker.js'), '// FOOBAR\n');
  JSON.parse(script('tech-debt-scan.mjs', '--json').stdout || '{"findings":[]}').findings.some((f) => f.kind === 'custom-foobar')
    ? ok('tech-debt-scan loads a drop-in custom detector (vibekit/detectors/)') : bad('custom detector not loaded');

  // Stack presets: install --preset merges stack paths into config (union with defaults).
  run([join(KIT, 'install.mjs'), '--target', proj, '--update', '--preset', 'go']);
  (readJson(cfgPath).ledger?.important || []).includes('internal/')
    ? ok('install --preset merges a stack preset into config') : bad('preset paths not merged into config');

  // Recommended start level (ADR-0009): greenfield auto-picks L3, existing auto-picks L7
  // (the latter also proves the level cap accepts 7 — a broken cap would downgrade to 2).
  const gdir = mkdtempSync(join(tmpdir(), 'vibekit-gf-'));
  const edir = mkdtempSync(join(tmpdir(), 'vibekit-ex-'));
  try {
    run([join(KIT, 'install.mjs'), '--target', gdir, '--yes']);
    readJson(join(gdir, 'vibekit', 'config.json')).level === 3
      ? ok('install auto-picks L3 for a greenfield project') : bad(`greenfield default not L3: ${readJson(join(gdir, 'vibekit', 'config.json')).level}`);
    mkdirSync(join(edir, 'src'), { recursive: true });
    writeFileSync(join(edir, 'src', 'index.js'), 'export const x = 1;\n');
    run([join(KIT, 'install.mjs'), '--target', edir, '--yes']);
    readJson(join(edir, 'vibekit', 'config.json')).level === 7
      ? ok('install auto-picks L7 for an existing project (+ level cap accepts 7)') : bad(`existing default not L7: ${readJson(join(edir, 'vibekit', 'config.json')).level}`);
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
  (() => { try { const s = readJson(join(proj, 'vibekit', 'memory', 'sbom.json')); return s.bomFormat === 'CycloneDX' && (s.components || []).some((c) => c.name === 'gpllib'); } catch { return false; } })()
    ? ok('deps-audit --sbom writes a CycloneDX SBOM') : bad('SBOM not written/invalid');

  // GitHub-native security: scaffolding + code-security agent installed; alert sync degrades safely.
  existsSync(join(proj, '.github', 'dependabot.yml')) && existsSync(join(proj, '.github', 'workflows', 'security.yml'))
    ? ok('GitHub security scaffolding installed (dependabot.yml + security workflow)') : bad('security scaffolding not installed');
  existsSync(join(proj, '.claude', 'agents', 'code-security.md')) ? ok('code-security agent installed (L5)') : bad('code-security agent missing');
  const ghAlerts = script('gh-alerts.mjs', '--json');
  ghAlerts.status === 0 && (() => { try { return Array.isArray(JSON.parse(ghAlerts.stdout).findings); } catch { return false; } })()
    ? ok('gh-alerts degrades safely without a GitHub repo (exit 0, empty findings)') : bad(`gh-alerts failed: ${ghAlerts.stdout || ghAlerts.stderr}`);

  // Fleet mode: register this project in a temp registry, aggregate stats across the fleet.
  const fleetEnv = { ...process.env, VIBE_FLEET_FILE: join(proj, '.fleet.json') };
  const fleet = (...a) => run([join(proj, 'vibekit', 'tools', 'scripts', 'fleet.mjs'), ...a], { cwd: proj, env: fleetEnv });
  fleet('add', proj);
  const fleetStats = fleet('stats', '--json');
  (() => { try { const d = JSON.parse(fleetStats.stdout); return d.totals.repos === 1 && d.repos[0]?.ok === true && typeof d.totals.totalSessions === 'number'; } catch { return false; } })()
    ? ok('fleet stats aggregates a registered repo (control plane)') : bad(`fleet failed: ${fleetStats.stdout || fleetStats.stderr}`);

  // Agent tuning: signal aggregation lists the installed agent roster (proposes only).
  const tuning = script('agent-tuning.mjs', '--json');
  (() => { try { const d = JSON.parse(tuning.stdout); return Array.isArray(d.agents) && d.agents.length >= 1 && typeof d.sessionsAnalyzed === 'number'; } catch { return false; } })()
    ? ok('agent-tuning aggregates the agent roster + signals') : bad(`agent-tuning failed: ${tuning.stdout || tuning.stderr}`);

  // agent-forge — installed at L>=4 + /forge-new round-trip: the architect/router/packager
  // pipeline writes a complete APF (yaml dep available) or proves the pure-JS half of the
  // pipeline (assembleManifest + router + generators) when yaml is absent (CI default).
  existsSync(join(proj, 'vibekit', 'squads', 'agent-forge', 'lib', 'router.mjs'))
    ? ok('agent-forge squad installed at L>=4 (vibekit/squads/agent-forge)')
    : bad('agent-forge squad missing from L5 install');
  const forgeBase = join(proj, 'vibekit', 'squads', 'agent-forge').replaceAll('\\', '/');
  const blueprint = {
    agent_name: 'intake-classifier',
    role_one_line: 'You classify intake forms by department.',
    intent: { category: 'classification', complexity: 'low' },
    privacy: { allow_cloud_providers: true, data_residency: 'br-or-eu' },
    capabilities: { tools: false, structured_output: true },
    runtime_adapters: ['node', 'python'],
  };
  let yamlAvail = false;
  try { await import('yaml'); yamlAvail = true; } catch { /* optional dep — ADR-0013 */ }
  if (yamlAvail) {
    const { forgeNew } = await import('file://' + join(forgeBase, 'cli', 'forge-new.mjs').replaceAll('\\', '/'));
    const result = await forgeNew(blueprint, join(proj, 'agent-packages'), { now: '2026-05-26T12:00:00Z' });
    const apf = result.summary.targetDir;
    const expected = ['manifest.yaml', 'README.md', 'prompts/system.canonical.md',
      'prompts/system.anthropic.md', 'prompts/system.openai.md',
      'prompts/system.google.md', 'prompts/system.deepseek.md', 'prompts/system.ollama.md',
      'tools/schemas.canonical.json',
      'tools/adapters/anthropic.tools.json', 'tools/adapters/openai.tools.json',
      'tools/adapters/google.tools.json', 'tools/adapters/deepseek.tools.json', 'tools/adapters/ollama.tools.json',
      'evals/golden.jsonl', 'governance/cost.policy.yaml', 'adapters/node/index.js'];
    const missing = expected.filter((f) => !existsSync(join(apf, f)));
    missing.length === 0 ? ok(`forge-new writes a complete APF (${expected.length} files)`) : bad(`APF missing: ${missing.join(', ')}`);
    const manifest = readFileSync(join(apf, 'manifest.yaml'), 'utf-8');
    manifest.includes(result.summary.provenance.blueprint_hash)
      ? ok('forge-new stamps provenance.blueprint_hash into manifest.yaml') : bad('blueprint_hash not stamped');
    manifest.includes('provider: ' + result.decision.primary.split('/')[0])
      ? ok('forge-new stamps the routed primary provider into manifest.yaml') : bad('primary provider not in manifest');
    readFileSync(join(apf, 'prompts/system.anthropic.md'), 'utf-8').includes('<role>')
      ? ok('forge-new emits the Anthropic XML system prompt') : bad('Anthropic XML prompt missing');
    readFileSync(join(apf, 'prompts/system.deepseek.md'), 'utf-8').includes('Think step by step')
      ? ok('forge-new emits the DeepSeek prompt with explicit CoT cue (Fase 2)') : bad('DeepSeek CoT cue missing');
    readFileSync(join(apf, 'prompts/system.google.md'), 'utf-8').includes('systemInstruction')
      ? ok('forge-new emits the Gemini prompt with safetySettings note (Fase 2)') : bad('Gemini systemInstruction note missing');
    JSON.parse(readFileSync(join(apf, 'tools/adapters/openai.tools.json'), 'utf-8')).tools.every((t) => t.type === 'function')
      ? ok('forge-new emits OpenAI function-format tool adapters') : bad('OpenAI adapter malformed');
    const googleAdapter = JSON.parse(readFileSync(join(apf, 'tools/adapters/google.tools.json'), 'utf-8'));
    Array.isArray(googleAdapter.functionDeclarations) && googleAdapter.functionDeclarations.every((decl) => !('additionalProperties' in (decl.parameters || {})))
      ? ok('forge-new emits Gemini functionDeclarations (additionalProperties stripped) (Fase 2)') : bad('Gemini adapter malformed or kept stripped fields');
    JSON.parse(readFileSync(join(apf, 'tools/adapters/deepseek.tools.json'), 'utf-8')).tools.every((t) => t.type === 'function')
      ? ok('forge-new emits DeepSeek tool adapter (OpenAI-compat) (Fase 2)') : bad('DeepSeek adapter malformed');
    readFileSync(join(apf, 'adapters/node/index.js'), 'utf-8').length > 0
      ? ok('forge-new ships the Node runtime adapter (round-trip ready)') : bad('Node adapter missing');
    const pyproject = readFileSync(join(apf, 'adapters/python/pyproject.toml'), 'utf-8');
    pyproject.includes(blueprint.agent_name) && !pyproject.includes('{{AGENT_NAME}}')
      ? ok('forge-new ships the Python runtime adapter with name stamped (Fase 2)') : bad('Python adapter not stamped (pyproject.toml)');
    readFileSync(join(apf, 'manifest.yaml'), 'utf-8').includes('python')
      ? ok('forge-new stamps runtime_adapters: [..., python] into manifest.yaml (Fase 2)') : bad('python missing from manifest runtime_adapters');
    const costPolicy = readFileSync(join(apf, 'governance/cost.policy.yaml'), 'utf-8');
    !costPolicy.includes('{{') && costPolicy.includes('budgets:')
      ? ok('forge-new writes a POPULATED cost.policy.yaml (no {{TOKEN}}, Fase 3)') : bad('cost.policy still carries placeholders or no budgets');
    const qualityPolicy = readFileSync(join(apf, 'governance/quality.policy.yaml'), 'utf-8');
    qualityPolicy.includes('eval_gates:') && qualityPolicy.includes('fallback_chain:')
      ? ok('forge-new writes a populated quality.policy.yaml (Fase 3)') : bad('quality.policy missing required sections');
    const fallbackChain = readFileSync(join(apf, 'governance/fallback-chain.yaml'), 'utf-8');
    fallbackChain.includes('primary:') && fallbackChain.includes('on_safety_block: do_not_fallback')
      ? ok('forge-new writes a fallback-chain.yaml built from the router decision (Fase 3)') : bad('fallback-chain missing primary or safety_block rule');
    readFileSync(join(apf, 'evals/thresholds.yaml'), 'utf-8').includes('release_gate:')
      ? ok('forge-new writes a populated evals/thresholds.yaml (Fase 3)') : bad('evals/thresholds.yaml not populated');
    /eval_passed_at:\s*null/.test(readFileSync(join(apf, 'manifest.yaml'), 'utf-8'))
      ? ok('forge-new leaves eval_passed_at null without runEval (Fase 3 gate)') : bad('eval_passed_at not null without runEval');
    const gated = await forgeNew(blueprint, join(proj, 'agent-packages-gated'), {
      now: '2026-05-26T12:00:00Z',
      runEval: { provider: (input) => (input.text ? { redacted: '[ok]' } : { y: 'ok' }) },
    });
    gated.evalResult?.verdict === 'pass' && readFileSync(join(gated.summary.targetDir, 'manifest.yaml'), 'utf-8').includes('eval_passed_at: \'2026-05-26')
      ? ok('forge-new with runEval (passing mock) stamps eval_passed_at into manifest.yaml (Fase 3)') : bad(`runEval gate failed: verdict=${gated.evalResult?.verdict}`);
    const ragBlueprint = { agent_name: 'contract-qa', role_one_line: 'You answer questions about contracts from the knowledge base.', intent: { category: 'rag-answer', complexity: 'high', domain: 'legal-pt-br' }, privacy: { allow_cloud_providers: true, data_residency: 'br-or-eu' }, capabilities: { tools: false, rag: true }, runtime_adapters: ['node', 'go'] };
    const ragResult = await forgeNew(ragBlueprint, join(proj, 'agent-packages-rag'), { now: '2026-05-26T12:00:00Z' });
    const ragApf = ragResult.summary.targetDir;
    const ragConfig = readFileSync(join(ragApf, 'rag/config.yaml'), 'utf-8');
    !ragConfig.includes('{{') && /backend:\s*qdrant/.test(ragConfig)
      ? ok('forge-new writes a populated rag/config.yaml (qdrant backend for cloud-OK, Fase 5)') : bad('rag/config.yaml not populated or wrong backend');
    /multilingual-e5/.test(ragConfig)
      ? ok('forge-new picks multilingual-e5 for non-`-en` domain (Fase 5)') : bad('embedding model wrong for multilingual domain');
    const goMod = readFileSync(join(ragApf, 'adapters/go/go.mod'), 'utf-8');
    goMod.includes('contract-qa') && !goMod.includes('{{')
      ? ok('forge-new stamps Go adapter go.mod when runtime_adapters includes go (Fase 5)') : bad(`go.mod not stamped: ${goMod}`);
  } else {
    const { validateBlueprint, fillDefaults } = await import('file://' + join(forgeBase, 'lib', 'architect.mjs').replaceAll('\\', '/'));
    const { routeAgent } = await import('file://' + join(forgeBase, 'lib', 'router.mjs').replaceAll('\\', '/'));
    const { assembleManifest } = await import('file://' + join(forgeBase, 'lib', 'packager.mjs').replaceAll('\\', '/'));
    const { generatePrompts } = await import('file://' + join(forgeBase, 'lib', 'prompt-gen.mjs').replaceAll('\\', '/'));
    const { generateAdapters } = await import('file://' + join(forgeBase, 'lib', 'tool-gen.mjs').replaceAll('\\', '/'));
    validateBlueprint(blueprint).ok ? ok('forge-new (no-yaml): blueprint validates') : bad('blueprint invalid');
    !validateBlueprint({ ...blueprint, runtime_adapters: ['rust'] }).ok
      ? ok('forge-new (no-yaml): validateBlueprint rejects unknown runtime_adapters (Fase 2)') : bad('validateBlueprint accepted bogus runtime');
    const filled = fillDefaults(blueprint);
    Array.isArray(filled.runtime_adapters) && filled.runtime_adapters[0] === 'node'
      ? ok('forge-new (no-yaml): fillDefaults sets runtime_adapters default [node] (Fase 2)') : bad('runtime_adapters default missing');
    const decision = await routeAgent(filled);
    const manifest = assembleManifest(filled, decision, { now: '2026-05-26T12:00:00Z' });
    manifest.metadata.name === blueprint.agent_name && manifest.spec.model_selection.primary.provider === decision.primary.split('/')[0]
      ? ok('forge-new (no-yaml): assembleManifest stamps name + routed primary') : bad('assembleManifest mismatch');
    const pyManifest = assembleManifest({ ...filled, runtime_adapters: ['node', 'python'] }, decision, { now: '2026-05-26T12:00:00Z' });
    pyManifest.spec.runtime_adapters.includes('python')
      ? ok('forge-new (no-yaml): blueprint.runtime_adapters flows into manifest.spec.runtime_adapters (Fase 2)') : bad('runtime_adapters did not flow through');
    /^[a-f0-9]{64}$/.test(manifest.metadata.provenance.blueprint_hash)
      ? ok('forge-new (no-yaml): provenance.blueprint_hash is SHA-256') : bad('blueprint_hash malformed');
    const prompts = generatePrompts('# Role\nYou classify.\n\n# Context\nClinic.\n\n# Rules\n- JSON.\n\n# Output\nJSON.\n');
    prompts.anthropic.includes('<role>') && prompts.openai.includes('# Role')
      ? ok('forge-new (no-yaml): prompt-gen renders Anthropic XML + OpenAI Markdown') : bad('prompt-gen output wrong');
    prompts.google?.includes('systemInstruction') && prompts.deepseek?.includes('Think step by step') && prompts.ollama?.includes('chat_template')
      ? ok('forge-new (no-yaml): prompt-gen renders Gemini + DeepSeek (CoT) + Ollama (chat_template) (Fase 2)') : bad('Fase 2 prompts missing or malformed');
    const adapters = generateAdapters({ classify: { description: 'Classify text', input_schema: { type: 'object', additionalProperties: false, properties: { text: { type: 'string' } }, required: ['text'] } } });
    adapters.anthropic.tools[0].name === 'classify' && adapters.openai.tools[0].type === 'function'
      ? ok('forge-new (no-yaml): tool-gen renders Anthropic + OpenAI adapters') : bad('tool-gen output wrong');
    const geminiDecl = adapters.google?.functionDeclarations?.[0];
    geminiDecl?.name === 'classify' && !('additionalProperties' in (geminiDecl.parameters || {}))
      ? ok('forge-new (no-yaml): tool-gen Gemini strips JSON-Schema fields not in the subset (Fase 2)') : bad('Gemini down-conversion wrong');
    adapters.deepseek?.tools?.[0]?.type === 'function' && adapters.ollama?.tools?.[0]?.type === 'function'
      ? ok('forge-new (no-yaml): tool-gen DeepSeek + Ollama mirror OpenAI shape (Fase 2)') : bad('DeepSeek/Ollama adapters wrong');
    console.log('  ⓘ yaml dep not installed — full file-write round-trip skipped (install: npm i yaml).');
  }

  // Fase 6 — squad-pipeline DSL: pipeline.yaml ships, validates, dry-run is non-empty.
  // (ADR-0015 Part A; full grammar in docs/SQUAD-PIPELINE-FORMAT.md.)
  existsSync(join(proj, 'vibekit', 'squads', 'agent-forge', 'pipeline.yaml'))
    ? ok('agent-forge ships pipeline.yaml (Fase 6)')
    : bad('agent-forge pipeline.yaml missing from install');
  const pipelineEngineUrl = 'file://' + join(proj, 'vibekit', 'tools', 'scripts', 'squad-pipeline.mjs').replaceAll('\\', '/');
  const { loadAndValidate, plan } = await import(pipelineEngineUrl);
  const lv = await loadAndValidate('agent-forge').catch((err) => ({ error: err }));
  if (yamlAvail) {
    if (lv.error) {
      bad(`Fase 6: loadAndValidate threw with yaml available: ${lv.error.message}`);
    } else {
      lv.pipeline?.squad === 'agent-forge' && lv.pipeline.steps.length >= 8
        ? ok(`Fase 6: agent-forge pipeline validates (${lv.pipeline.steps.length} steps)`)
        : bad(`Fase 6: pipeline shape wrong: ${JSON.stringify({ squad: lv.pipeline?.squad, steps: lv.pipeline?.steps?.length })}`);
      const rows = plan(lv.pipeline, { blueprint: { tools: ['x'] }, capabilities: { rag: false } });
      rows.find((r) => r.id === 'generate-tools')?.marker === '↺' || rows.find((r) => r.id === 'generate-tools')?.marker === '✓'
        ? ok('Fase 6: dry-run runs generate-tools when blueprint.tools.length > 0')
        : bad(`Fase 6: generate-tools marker wrong: ${rows.find((r) => r.id === 'generate-tools')?.marker}`);
      rows.find((r) => r.id === 'generate-rag')?.marker === '⊘'
        ? ok('Fase 6: dry-run skips generate-rag when capabilities.rag == false (⊘)')
        : bad(`Fase 6: generate-rag marker wrong under rag=false: ${rows.find((r) => r.id === 'generate-rag')?.marker}`);
      rows.find((r) => r.id === 'eval-gate')?.marker === '↺'
        ? ok('Fase 6: dry-run marks eval-gate retry loop (↺, max_cycles: 3)')
        : bad(`Fase 6: eval-gate marker wrong: ${rows.find((r) => r.id === 'eval-gate')?.marker}`);
    }
  } else {
    lv.yamlAbsent === true
      ? ok('Fase 6: squad-pipeline takes the yaml-absent informative path (opt-in, not hot-path)')
      : bad(`Fase 6: expected { yamlAbsent: true } when yaml is missing, got ${JSON.stringify(lv)}`);
  }
} catch (err) {
  bad(`crashed: ${err?.stack || err}`);
} finally {
  fx.cleanup();
}

rep.finish('Integration (tooling)');
