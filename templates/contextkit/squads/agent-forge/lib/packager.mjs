/**
 * packager — assembles the Agent Package (APF v1) for a routed blueprint. Reads the
 * APF template tree, writes a stamped copy to the target dir, generates per-provider
 * prompts + tool adapters, and stamps provenance (blueprint hash, forge version,
 * timestamp) into the manifest.
 *
 * Split:
 * - `assembleManifest(blueprint, decision)` — pure, returns the in-memory manifest
 *   object. No I/O, no YAML dep — exercised by the unit tests.
 * - `packageAgent(blueprint, decision, targetDir)` — full I/O: depends on the optional
 *   `yaml` dep via `lib/yaml.mjs` (ADR-0013) to serialize the manifest. Required at
 *   packaging time; not required to import this module.
 */
import { copyFile, mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { blueprintHash } from './architect.mjs';
import { designEvalSet, toJsonl } from './eval-designer.mjs';
import { attachGovernance } from './governance-officer.mjs';
import { generatePrompts } from './prompt-gen.mjs';
import { designRagConfig } from './rag-designer.mjs';
import { generateAdapters } from './tool-gen.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const APF_TEMPLATE = resolve(HERE, '..', 'templates', 'agent-package');
const FORGE_VERSION = '0.1.0';

function splitId(fullId) {
  const [provider, ...rest] = String(fullId).split('/');
  return { provider, model: rest.join('/') };
}

/**
 * Build the manifest object in memory. Pure, deterministic when `opts.now` is fixed.
 * The YAML serializer is called by `packageAgent`; tests should call this directly
 * to inspect structure without needing the `yaml` dep.
 */
export function assembleManifest(blueprint, decision, opts = {}) {
  const now = opts.now ?? new Date().toISOString();
  const today = now.slice(0, 10);
  const primary = splitId(decision.primary);
  const fallback = decision.fallback
    ? { ...splitId(decision.fallback), condition: 'primary_5xx OR primary_timeout' }
    : null;
  const cheap = decision.cheap_path ? splitId(decision.cheap_path) : null;
  const premium = decision.premium_path ? splitId(decision.premium_path) : null;
  return {
    apiVersion: 'agentforge.contextdevkit.io/v1',
    kind: 'Agent',
    metadata: {
      name: blueprint.agent_name,
      version: opts.version ?? '0.1.0',
      description: blueprint.role_one_line,
      author: blueprint.author || 'unknown',
      created: today,
      provenance: {
        forged_by: `agent-forge@${opts.forgeVersion ?? FORGE_VERSION}`,
        blueprint_hash: blueprintHash(blueprint),
        eval_passed_at: opts.evalResult?.verdict === 'pass' ? (opts.evalPassedAt ?? now) : null,
      },
    },
    spec: {
      intent: blueprint.intent,
      sla: blueprint.sla,
      cost: blueprint.cost,
      volume: blueprint.volume,
      privacy: blueprint.privacy,
      capabilities: blueprint.capabilities,
      model_selection: {
        primary: { ...primary, temperature: 0, max_tokens: 4000 },
        ...(fallback ? { fallback: [fallback] } : {}),
        ...(cheap ? { cheap_path: cheap } : {}),
        ...(premium ? { premium_path: premium } : {}),
        rules_applied: decision.applied_rules ?? [],
      },
      evals: { golden: 'evals/golden.jsonl', thresholds: 'evals/thresholds.yaml' },
      governance: {
        cost: 'governance/cost.policy.yaml',
        compliance: 'governance/compliance.policy.yaml',
        quality: 'governance/quality.policy.yaml',
        fallback: 'governance/fallback-chain.yaml',
      },
      runtime_adapters: opts.runtimeAdapters ?? blueprint.runtime_adapters ?? ['node'],
    },
  };
}

async function copyTree(src, dest) {
  await mkdir(dest, { recursive: true });
  for (const entry of await readdir(src, { withFileTypes: true })) {
    const s = join(src, entry.name);
    const d = join(dest, entry.name);
    if (entry.isDirectory()) await copyTree(s, d);
    else await copyFile(s, d);
  }
}

async function writeText(p, body) {
  await mkdir(dirname(p), { recursive: true });
  await writeFile(p, body);
}

/** Replace the README's Model Selection Rationale section body with the router's output. */
function stampReadme(readme, decision) {
  const sectionRe = /## Model Selection Rationale[\s\S]*?(?=\n## )/;
  if (sectionRe.test(readme)) return readme.replace(sectionRe, decision.rationale.trim() + '\n\n');
  return readme + '\n\n' + decision.rationale + '\n';
}

/**
 * Write a complete Agent Package to `targetDir`. Requires the `yaml` dep (ADR-0013)
 * at runtime; throws a clear, actionable error via `loadYaml` if absent.
 */
export async function packageAgent(blueprint, decision, targetDir, opts = {}) {
  const governance = attachGovernance(blueprint, decision);
  const evalSet = designEvalSet(blueprint);

  const { stringifyYaml } = await import('./yaml.mjs');
  await copyTree(APF_TEMPLATE, targetDir);

  const manifest = assembleManifest(blueprint, decision, opts);
  await writeText(join(targetDir, 'manifest.yaml'), await stringifyYaml(manifest));

  await writeText(join(targetDir, 'evals/golden.jsonl'), toJsonl(evalSet.golden));
  await writeText(join(targetDir, 'evals/red-team.jsonl'), toJsonl(evalSet.redTeam));
  await writeText(join(targetDir, 'evals/rubric.yaml'), await stringifyYaml(evalSet.rubric));
  await writeText(join(targetDir, 'evals/thresholds.yaml'), await stringifyYaml(evalSet.thresholds));

  await writeText(join(targetDir, 'governance/cost.policy.yaml'), await stringifyYaml(governance.cost));
  await writeText(join(targetDir, 'governance/compliance.policy.yaml'), await stringifyYaml(governance.compliance));
  await writeText(join(targetDir, 'governance/quality.policy.yaml'), await stringifyYaml(governance.quality));
  await writeText(join(targetDir, 'governance/fallback-chain.yaml'), await stringifyYaml(governance.fallback));

  let rag = null;
  if (blueprint?.capabilities?.rag === true) {
    rag = designRagConfig(blueprint);
    await writeText(join(targetDir, 'rag/config.yaml'), await stringifyYaml(rag.config));
    await writeText(join(targetDir, 'rag/ingestion/chunker.config.yaml'), await stringifyYaml(rag.chunker));
    await writeText(join(targetDir, 'rag/ingestion/sources.yaml'), await stringifyYaml(rag.sources));
    await writeText(join(targetDir, 'rag/retrieval/query-template.md'), rag.queryTemplate);
    await writeText(join(targetDir, 'rag/retrieval/rerank.config.yaml'), await stringifyYaml(rag.rerank));
  }

  const canonicalPrompt = await readFile(join(targetDir, 'prompts/system.canonical.md'), 'utf-8');
  const prompts = generatePrompts(canonicalPrompt);
  await writeText(join(targetDir, 'prompts/system.anthropic.md'), prompts.anthropic);
  await writeText(join(targetDir, 'prompts/system.openai.md'), prompts.openai);
  await writeText(join(targetDir, 'prompts/system.google.md'), prompts.google);
  await writeText(join(targetDir, 'prompts/system.deepseek.md'), prompts.deepseek);
  await writeText(join(targetDir, 'prompts/system.ollama.md'), prompts.ollama);

  const canonicalTools = JSON.parse((await readFile(join(targetDir, 'tools/schemas.canonical.json'), 'utf-8')).replace(/^﻿/, ''));
  const adapters = generateAdapters(canonicalTools);
  await writeText(join(targetDir, 'tools/adapters/anthropic.tools.json'), JSON.stringify(adapters.anthropic, null, 2) + '\n');
  await writeText(join(targetDir, 'tools/adapters/openai.tools.json'), JSON.stringify(adapters.openai, null, 2) + '\n');
  await writeText(join(targetDir, 'tools/adapters/google.tools.json'), JSON.stringify(adapters.google, null, 2) + '\n');
  await writeText(join(targetDir, 'tools/adapters/deepseek.tools.json'), JSON.stringify(adapters.deepseek, null, 2) + '\n');
  await writeText(join(targetDir, 'tools/adapters/ollama.tools.json'), JSON.stringify(adapters.ollama, null, 2) + '\n');

  const readmePath = join(targetDir, 'README.md');
  await writeText(readmePath, stampReadme(await readFile(readmePath, 'utf-8'), decision));

  await stampRuntimeAdapters(targetDir, blueprint, manifest.spec.runtime_adapters);

  return {
    targetDir,
    manifest,
    files_written: ['manifest.yaml',
      'prompts/system.anthropic.md', 'prompts/system.openai.md',
      'prompts/system.google.md', 'prompts/system.deepseek.md', 'prompts/system.ollama.md',
      'tools/adapters/anthropic.tools.json', 'tools/adapters/openai.tools.json',
      'tools/adapters/google.tools.json', 'tools/adapters/deepseek.tools.json',
      'tools/adapters/ollama.tools.json',
      'evals/golden.jsonl', 'evals/red-team.jsonl', 'evals/rubric.yaml', 'evals/thresholds.yaml',
      'governance/cost.policy.yaml', 'governance/compliance.policy.yaml',
      'governance/quality.policy.yaml', 'governance/fallback-chain.yaml',
      'README.md'],
    provenance: manifest.metadata.provenance,
    governance,
    evalSet,
    rag,
  };
}

/**
 * Replace `{{AGENT_NAME}}` (and the project version) in the Node + Python adapter
 * manifests when those runtimes are requested. Pure I/O: no behavioural change to
 * the adapter logic, just removes the literal placeholders so the package installs
 * cleanly. Stays best-effort — a missing adapter dir is ignored.
 */
async function stampRuntimeAdapters(targetDir, blueprint, runtimes) {
  const name = blueprint.agent_name;
  const modulePath = blueprint?.go_module_path || 'example.com';
  const subs = (text) => String(text)
    .replaceAll('{{AGENT_NAME}}', name)
    .replaceAll('{{SEE_LICENSE}}', 'UNLICENSED')
    .replaceAll('{{MODULE_PATH}}', modulePath)
    .replaceAll('{{1.22}}', '1.22')
    .replaceAll('{{3.10}}', '3.10');
  const safeStamp = async (path) => {
    try {
      await writeText(path, subs(await readFile(path, 'utf-8')));
    } catch {
      /* adapter dir absent or unreadable — ignore */
    }
  };
  if (runtimes?.includes('node')) {
    await safeStamp(join(targetDir, 'adapters/node/package.json'));
    await safeStamp(join(targetDir, 'adapters/node/README.md'));
  }
  if (runtimes?.includes('python')) {
    await safeStamp(join(targetDir, 'adapters/python/pyproject.toml'));
    await safeStamp(join(targetDir, 'adapters/python/README.md'));
  }
  if (runtimes?.includes('go')) {
    await safeStamp(join(targetDir, 'adapters/go/go.mod'));
    await safeStamp(join(targetDir, 'adapters/go/README.md'));
  }
}
