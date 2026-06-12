/**
 * Self-check — TEMPLATE INVENTORY (sibling runner of selfcheck-runtime/-config/
 * -source, extracted from selfcheck.mjs at its natural seam — ADR-0041 F0,
 * task 104). Asserts the shipped template tree is complete: slash commands
 * (recursive, collision-free basenames — ticket 047), agent archetypes, tool
 * scripts, GitHub scaffolding, agent-forge package template, workflows and
 * playbooks. Pure presence checks — behavioral invariants live in the siblings.
 */
import { existsSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

/** Model-alias whitelist for agent frontmatter (ADR-0052 — aliases only, never versioned IDs). */
const VALID_MODEL_ALIASES = new Set(['haiku', 'sonnet', 'opus', 'inherit']);

/**
 * Runs the template-inventory checks.
 * @param {{ ok: (m: string) => void, bad: (m: string) => void }} reporter
 * @param {{ KIT: string }} ctx repo root
 */
export async function runTemplateChecks({ ok, bad }, { KIT }) {
  console.log('Checking template inventory...');
  // Ticket 047 — commands live in domain subfolders + at root. Walk recursively
  // and assert (a) every expected command resolves by basename, (b) no two
  // commands collide on basename (Claude Code resolves by basename).
  async function walkCmds(dir, acc = []) {
    for (const ent of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
      const full = resolve(dir, ent.name);
      if (ent.isDirectory()) await walkCmds(full, acc);
      else if (ent.name.endsWith('.md') && ent.name !== 'README.md') acc.push(ent.name);
    }
    return acc;
  }
  const cmds = await walkCmds(resolve(KIT, 'templates/claude/commands'));
  cmds.length >= 35 ? ok(`${cmds.length} slash commands present (across packs + root)`) : bad(`only ${cmds.length} slash commands`);
  const seen = new Map();
  for (const c of cmds) seen.set(c, (seen.get(c) || 0) + 1);
  const collisions = [...seen.entries()].filter(([, n]) => n > 1);
  collisions.length === 0 ? ok('no command basename collides across packs (ticket 047)') : bad(`basename collisions: ${collisions.map(([n]) => n).join(', ')}`);
  for (const c of ['setupcontextdevkit.md', 'distill-sessions.md', 'distill-apply.md', 'context-doctor.md', 'context-config.md', 'test-plan.md', 'scaffold-tests.md', 'qa-signoff.md', 'audit.md', 'ship.md', 'retro.md', 'context-stats.md', 'contract-check.md', 'aidevtool-from0.md', 'analyze-code-ia-practices.md', 'pipeline.md', 'roadmap.md', 'claude-md.md', 'git.md', 'squad.md', 'deps-audit.md', 'deep-analysis.md', 'security-setup.md', 'fleet.md', 'tune-agents.md', 'playbook.md', 'token-report.md', 'visual-test.md', 'forge-new.md',
    'forge-list.md', 'forge-show.md', 'forge-doctor.md', 'forge-policy.md', 'forge-budget.md', 'forge-audit.md',
    'forge-eval.md', 'forge-redteam.md', 'forge-route.md', 'forge-fallback-test.md',
    'forge-refresh-matrix.md', 'forge-killswitch.md', 'forge-deprecate.md', 'runs.md', 'project-map.md', 'autonomy.md', 'swarm.md', 'pipetest.md', 'fable.md']) {
    cmds.includes(c) ? ok(`command ${c.replace('.md', '')} present`) : bad(`missing command ${c}`);
  }
  const agents = await readdir(resolve(KIT, 'templates/claude/agents')).catch(() => []);
  agents.length >= 20 ? ok(`${agents.length} agent archetypes present`) : bad(`only ${agents.length} agents`);
  for (const a of ['qa-orchestrator.md', 'qa-unit.md', 'qa-integration.md', 'qa-fuzzer.md', 'qa-perf.md', 'qa-e2e.md', 'privacy-lgpd.md', 'ux-designer.md', 'ui-designer.md', 'accessibility.md', 'product-owner.md', 'devops.md', 'infra-security.md', 'code-security.md',
    'conversion-strategist.md', 'tracking-integrator.md',
    'forge-orchestrator.md', 'agent-architect.md', 'model-router.md', 'prompt-engineer.md', 'tool-designer.md', 'packager.md',
    'eval-designer.md', 'governance-officer.md', 'rag-designer.md']) {
    agents.includes(a) ? ok(`agent ${a.replace('.md', '')} present`) : bad(`missing agent ${a}`);
  }
  // ADR-0052 — every agent declares a cost-tier model ALIAS in frontmatter.
  // A versioned model ID (e.g. claude-haiku-4-5-20251001) would rot with model
  // generations; the dated capability matrix owns concrete IDs, so it fails here.
  let modelTierFailures = 0;
  for (const a of agents.filter((f) => f.endsWith('.md') && f !== '_TEMPLATE.md')) {
    const frontmatter = (await readFile(resolve(KIT, 'templates/claude/agents', a), 'utf-8')).split('\n---')[0];
    const modelLine = frontmatter.match(/^model:\s*(\S+)/m);
    if (!modelLine) { bad(`agent ${a} has no model: tier (ADR-0052)`); modelTierFailures++; continue; }
    if (!VALID_MODEL_ALIASES.has(modelLine[1])) { bad(`agent ${a} model "${modelLine[1]}" is not an alias (ADR-0052: haiku|sonnet|opus|inherit)`); modelTierFailures++; }
  }
  if (modelTierFailures === 0) ok(`all agents declare a valid model: tier alias (ADR-0052)`);
  existsSync(resolve(KIT, '.github/workflows/release.yml')) ? ok('release workflow present') : bad('missing release workflow');
  const scripts = await readdir(resolve(KIT, 'templates/contextkit/tools/scripts')).catch(() => []);
  for (const s of ['detect-stack.mjs', 'setup-complete.mjs', 'context-config.mjs', 'doctor.mjs', 'mark-simulation.mjs', 'predictions-review.mjs', 'tech-debt-scan.mjs', 'tech-debt-detectors.mjs', 'stats.mjs', 'contract-scan.mjs', 'pipeline.mjs', 'roadmap.mjs', 'claude-md.mjs', 'git.mjs', 'deps-audit.mjs', 'gh-alerts.mjs', 'pipeline-prioritize.mjs', 'pipeline-board.mjs', 'deep-analysis.mjs', 'squad.mjs', 'squad-meta.mjs', 'fleet.mjs', 'agent-tuning.mjs', 'playbook.mjs', 'token-report.mjs', 'token-attribution.mjs', 'memory-retrieve.mjs', 'visual-test.mjs', 'squad-pipeline.mjs', 'squad-pipeline-condition.mjs', 'pipeline-session.mjs', 'runs.mjs', 'pipeline-validate.mjs', 'resume.mjs', 'distill-detect.mjs', 'workflow.mjs', 'workflow-pack.mjs', 'project-map.mjs', 'project-map-core.mjs', 'project-map-render.mjs', 'project-map-deps.mjs', 'project-map-symbols.mjs', 'project-map-insights.mjs', 'project-map-rules.mjs', 'autonomy.mjs', 'autonomy-readiness.mjs', 'lp-scaffold.mjs', 'lp-build.mjs', 'swarm-plan.mjs', 'swarm-state.mjs']) {
    scripts.includes(s) ? ok(`script ${s} present`) : bad(`missing script ${s}`);
  }
  const ghTpl = await readdir(resolve(KIT, 'templates/github')).catch(() => []);
  ghTpl.includes('PULL_REQUEST_TEMPLATE.md') ? ok('GitHub PR template present') : bad('missing PR template');
  ghTpl.includes('dependabot.yml') ? ok('Dependabot config template present') : bad('missing dependabot.yml');
  existsSync(resolve(KIT, 'templates/github/workflows/security.yml')) ? ok('security workflow template present') : bad('missing security workflow template');
  existsSync(resolve(KIT, 'templates/github/workflows/quality.yml')) ? ok('quality workflow template present') : bad('missing quality workflow template');
  for (const f of [
    'templates/CLAUDE.md.tpl', 'templates/AGENTS.md.tpl', 'templates/cdx.mjs',
    'templates/docs/CHANGELOG.md.tpl', 'templates/contextkit/config.json',
    'templates/contextkit/instrucoes.md', 'templates/gitattributes', 'install.mjs',
    '.github/workflows/ci.yml', 'CHANGELOG.md', 'instrucoes.md', 'docs/ROADMAP.md',
    'templates/contextkit/runtime/hooks/concurrency-guard.mjs', 'templates/contextkit/runtime/git-hooks/pre-push.mjs',
    'templates/contextkit/runtime/hooks/safe-io.mjs', 'templates/contextkit/runtime/config/levels.mjs',
    'templates/contextkit/runtime/config/codex-hooks-compose.mjs',
    'templates/contextkit/runtime/codex/convert-all.mjs',
    'templates/contextkit/runtime/codex/convert-core.mjs',
    'templates/contextkit/runtime/statusline.mjs', 'templates/contextkit/runtime/config/presets.mjs',
    'templates/contextkit/best-practices.md', 'templates/contextkit/pipeline/devpipeline.md',
    'templates/contextkit/pipeline/working/.gitkeep',
    'templates/contextkit/runtime/state/state-io.mjs',
    'templates/contextkit/runtime/config/autonomy-eligibility.mjs',
    'templates/contextkit/detectors/README.md', 'templates/contextkit/detectors/example-detector.mjs.example',
    'templates/contextkit/memory/roadmap.md', 'templates/contextkit/CLAUDE.child.md.tpl',
    'templates/contextkit/squads/README.md', 'templates/contextkit/squads/_BRIEFING.md.tpl',
    'templates/contextkit/squads/agent-forge/README.md', 'templates/contextkit/squads/agent-forge/best-practices.md',
    'templates/contextkit/squads/agent-forge/ROADMAP.md',
    'templates/contextkit/squads/agent-forge/lib/yaml.mjs',
    'templates/contextkit/squads/agent-forge/lib/router.mjs',
    'templates/contextkit/squads/agent-forge/lib/architect.mjs',
    'templates/contextkit/squads/agent-forge/lib/prompt-gen.mjs',
    'templates/contextkit/squads/agent-forge/lib/tool-gen.mjs',
    'templates/contextkit/squads/agent-forge/lib/packager.mjs',
    'templates/contextkit/squads/agent-forge/router/capability-matrix.json',
    'templates/contextkit/squads/agent-forge/router/decision-rules.json',
    'templates/contextkit/squads/agent-forge/cli/forge-new.mjs',
    'templates/contextkit/squads/agent-forge/cli/forge-ops.mjs',
    'templates/contextkit/squads/agent-forge/cli/forge-eval-cli.mjs',
    'templates/contextkit/squads/agent-forge/cli/forge-admin.mjs',
    'templates/contextkit/squads/agent-forge/lib/package-ops.mjs',
    'templates/contextkit/squads/agent-forge/lib/eval-designer.mjs',
    'templates/contextkit/squads/agent-forge/lib/eval-runner.mjs',
    'templates/contextkit/squads/agent-forge/lib/governance-officer.mjs',
    'templates/contextkit/squads/agent-forge/lib/rag-designer.mjs',
    'templates/contextkit/squads/agent-forge/pipeline.yaml',
    'tools/selfcheck-agent-forge-ops.mjs',
    'templates/claude/commands/forge/forge-new.md',
    'templates/claude/commands/README.md',
    'docs/SQUADS/agent-forge.md', 'docs/AGENT-PACKAGE-FORMAT.md',
    'docs/SQUAD-PIPELINE-FORMAT.md',
    'templates/contextkit/squads/agent-forge/templates/agent-package/manifest.yaml',
    'templates/contextkit/squads/agent-forge/templates/agent-package/README.md',
    'templates/contextkit/squads/agent-forge/templates/agent-package/.agentforgerc',
    'templates/contextkit/squads/agent-forge/templates/agent-package/prompts/system.canonical.md',
    'templates/contextkit/squads/agent-forge/templates/agent-package/tools/schemas.canonical.json',
    'templates/contextkit/squads/agent-forge/templates/agent-package/evals/golden.jsonl',
    'templates/contextkit/squads/agent-forge/templates/agent-package/evals/thresholds.yaml',
    'templates/contextkit/squads/agent-forge/templates/agent-package/governance/cost.policy.yaml',
    'templates/contextkit/squads/agent-forge/templates/agent-package/governance/compliance.policy.yaml',
    'templates/contextkit/squads/agent-forge/templates/agent-package/governance/quality.policy.yaml',
    'templates/contextkit/squads/agent-forge/templates/agent-package/governance/audit.schema.json',
    'templates/contextkit/memory/business-rules/_TEMPLATE.md',
    'templates/contextkit/memory/predictions/.gitkeep',
    'templates/contextkit/memory/workflows/.gitkeep',
    'templates/contextkit/memory/workflows/_TEMPLATE/index.md',
    'templates/contextkit/memory/workflows/_TEMPLATE/prd.md',
    'templates/contextkit/memory/workflows/_TEMPLATE/spec.md',
    'templates/contextkit/memory/workflows/_TEMPLATE/decisions.md',
    'templates/contextkit/memory/workflows/_TEMPLATE/tasks.md',
    'templates/contextkit/memory/workflows/_TEMPLATE/memory.md',
    'templates/contextkit/memory/workflows/_TEMPLATE/reports/.gitkeep',
    'templates/contextkit/starters/landing/shell.html',
    'templates/contextkit/starters/landing/lp.config.json',
    'templates/contextkit/starters/landing/content/copy.json',
    'templates/contextkit/starters/landing/content/legal.json',
    'templates/contextkit/starters/landing/sections/01-hero.html',
    'templates/contextkit/starters/landing/sections/07-footer-cta.html',
    'templates/contextkit/starters/landing/partials/consent.html',
    'templates/contextkit/starters/landing/partials/gtm.html',
    'templates/contextkit/starters/landing/js/consent.js',
    'templates/contextkit/starters/landing/js/tracking-models.js',
    'templates/contextkit/starters/landing/legal/privacidade.html',
    'templates/contextkit/starters/landing/legal/termos.html',
    'templates/contextkit/squads/design-team/conversion-strategist.md',
    'templates/contextkit/squads/design-team/tracking-integrator.md',
  ]) {
    existsSync(resolve(KIT, f)) ? ok(f) : bad(`missing ${f}`);
  }
  const wf = await readdir(resolve(KIT, 'templates/contextkit/workflows')).catch(() => []);
  for (const f of ['README.md', 'L1-static-loading.md', 'L2-session-ledger.md', 'L3-multi-session.md', 'L4-squads.md', 'L5-proactive.md']) {
    wf.includes(f) ? ok(`workflow ${f} present`) : bad(`missing workflow ${f}`);
  }
  const playbooks = await readdir(resolve(KIT, 'templates/contextkit/workflows/playbooks')).catch(() => []);
  for (const f of ['tech-debt-sweep.md', 'simulate-impact.md', 'distillation-cycle.md', 'security-batch.md', 'landing-page.md', 'seo-aiso.md']) {
    playbooks.includes(f) ? ok(`playbook ${f} present`) : bad(`missing playbook ${f}`);
  }
  const codexAgents = await readdir(resolve(KIT, 'templates/codex/agents')).catch(() => []);
  codexAgents.filter((f) => f.endsWith('.toml')).length >= 20 ? ok('Codex subagent templates present') : bad('missing Codex subagent templates');
  const codexSkills = await readdir(resolve(KIT, 'templates/codex/skills')).catch(() => []);
  codexSkills.filter((f) => f.startsWith('source-command-')).length >= 35 ? ok('Codex source-command skill templates present') : bad('missing Codex source-command skill templates');
  // ── task 143: INSTRUCTIONS.md.tpl — no hardcoded artifact counts that drift, no ghost personas ──
  const instructions = await readFile(resolve(KIT, 'templates/INSTRUCTIONS.md.tpl'), 'utf-8').catch(() => null);
  if (instructions == null) { bad('templates/INSTRUCTIONS.md.tpl missing or unreadable'); return; }
  !/\b\d{2,}\s+(slash commands|skills|agents|playbooks)\b/i.test(instructions)
    ? ok('INSTRUCTIONS.md.tpl has no hardcoded artifact counts (task 143)')
    : bad('INSTRUCTIONS.md.tpl contains a hardcoded count that will drift (task 143)');
  !/\bengine-keeper\b/i.test(instructions)
    ? ok('INSTRUCTIONS.md.tpl does not name the engine-keeper ghost persona (task 143)')
    : bad('INSTRUCTIONS.md.tpl mentions engine-keeper which does not exist (task 143)');
}
