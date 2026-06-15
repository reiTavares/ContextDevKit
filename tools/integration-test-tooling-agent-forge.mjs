#!/usr/bin/env node
/**
 * ContextDevKit integration test — TOOLING / agent-forge.
 *
 * Sibling of `integration-test-tooling.mjs`. Extracted as a responsibility
 * seam (the split the parent file's cohesion note anticipated when budget
 * pressure returned — Fase 6 was the trigger). agent-forge is the longest
 * single subsystem in the tooling matrix: install round-trip + APF
 * structure assertions (yaml-available branch) + pure-JS fallback
 * (no-yaml branch) + Fase 6 pipeline DSL — together they crossed the
 * 308-line hard limit when Fase 6 landed.
 *
 * Each sibling installs its own fixture — the cost is one extra install;
 * the benefit is a focused, under-budget file per subsystem. Mirrors the
 * ADR-0016 H1 split that produced `integration-test-tooling-pipeline.mjs`.
 *
 * Run:  node tools/integration-test-tooling-agent-forge.mjs   (exit 0 = healthy)
 */
import { cpSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { reporter, installFixture, KIT } from './it-helpers.mjs';

const rep = reporter();
const { ok, bad } = rep;
console.log('\n🌀 ContextDevKit integration test — tooling / agent-forge\n');
const fx = installFixture(rep);
const { proj } = fx;

/**
 * Stage the optional `yaml` dependency INTO a fixture so the forge resolves it.
 *
 * The forge's `lib/yaml.mjs` runs from inside the temp fixture and resolves
 * `import('yaml')` by walking up from its own URL - the tmpdir has no
 * node_modules, so a `yaml` installed at the KIT root is invisible to it.
 * Detecting availability with `import('yaml')` from THIS file (rooted at the
 * KIT) and then executing inside the fixture diverge - a false signal (CDK-010).
 *
 * Copying `yaml` into `<fixtureRoot>/node_modules/yaml` makes detection and
 * execution share one resolution path: the round-trip branch only runs when the
 * forge can actually load yaml. Hot path untouched - this is test-only staging.
 *
 * @param {string} fixtureRoot the temp project root (forge lives under it)
 * @returns {boolean} true if `yaml` was resolvable from the KIT and staged
 */
function stageOptionalYaml(fixtureRoot) {
  try {
    const requireFromKit = createRequire(join(KIT, 'package.json'));
    const yamlPackageDir = dirname(requireFromKit.resolve('yaml/package.json'));
    const destDir = join(fixtureRoot, 'node_modules', 'yaml');
    mkdirSync(dirname(destDir), { recursive: true });
    cpSync(yamlPackageDir, destDir, { recursive: true });
    return true;
  } catch {
    return false; // yaml not installed at the KIT root - exercise the absent branch
  }
}

try {
  // agent-forge — installed at L>=4 + /forge-new round-trip: the architect/router/packager
  // pipeline writes a complete APF (yaml dep available) or proves the pure-JS half of the
  // pipeline (assembleManifest + router + generators) when yaml is absent (CI default).
  existsSync(join(proj, 'contextkit', 'squads', 'agent-forge', 'lib', 'router.mjs'))
    ? ok('agent-forge squad installed at L>=4 (contextkit/squads/agent-forge)')
    : bad('agent-forge squad missing from L5 install');
  const forgeBase = join(proj, 'contextkit', 'squads', 'agent-forge').replaceAll('\\', '/');
  const blueprint = {
    agent_name: 'intake-classifier',
    role_one_line: 'You classify intake forms by department.',
    intent: { category: 'classification', complexity: 'low' },
    privacy: { allow_cloud_providers: true, data_residency: 'br-or-eu' },
    capabilities: { tools: false, structured_output: true },
    runtime_adapters: ['node', 'python'],
  };
  // Stage `yaml` into the fixture so the forge (running from the tmpdir) resolves
  // the SAME module THIS test detected - no false "available" signal (CDK-010).
  const yamlAvail = stageOptionalYaml(proj);
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
    // The packaged golden seed (seed-001) expects { label: '<class-label>' } under an
    // exact rubric; the mock must echo it for a real pass (CDK-010 surfaced this the
    // first time the round-trip branch ran). PII-shaped inputs still get redacted.
    const passingMock = (input) => (input?.text ? { redacted: '[ok]', label: '<class-label>' } : { label: '<class-label>' });
    const gated = await forgeNew(blueprint, join(proj, 'agent-packages-gated'), {
      now: '2026-05-26T12:00:00Z',
      runEval: { provider: passingMock },
    });
    gated.evalResult?.verdict === 'pass' && readFileSync(join(gated.summary.targetDir, 'manifest.yaml'), 'utf-8').includes('eval_passed_at: 2026-05-26')
      ? ok('forge-new with runEval (passing mock) stamps eval_passed_at into manifest.yaml (Fase 3)') : bad(`runEval gate failed: verdict=${gated.evalResult?.verdict} failures=${gated.evalResult?.failures?.join(',')}`);
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
  existsSync(join(proj, 'contextkit', 'squads', 'agent-forge', 'pipeline.yaml'))
    ? ok('agent-forge ships pipeline.yaml (Fase 6)')
    : bad('agent-forge pipeline.yaml missing from install');
  const pipelineEngineUrl = 'file://' + join(proj, 'contextkit', 'tools', 'scripts', 'squad-pipeline.mjs').replaceAll('\\', '/');
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

rep.finish('Integration (tooling — agent-forge)');
