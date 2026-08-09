#!/usr/bin/env node
/**
 * Workflow Navigator (ADR-0057). Read-only assistant that shows the agent
 * exactly what the current workflow phase requires, what deliverables to
 * produce, and which commands to run next — saving tokens and preventing
 * skipped phases. Never mutates workflow state; mutations stay in
 * `workflow.mjs` / `workflow-pack.mjs`.
 *
 * Usage:
 *   workflow-assist.mjs <slug>           # human markdown
 *   workflow-assist.mjs <slug> --json    # machine JSON
 *   workflow-assist.mjs <slug> --pack    # markdown + context bundle
 */
import { readWorkflow, listWorkflows, PHASES } from './workflow-pack.mjs';

const ROOT = process.cwd();
const flag = (name) => process.argv.includes(name);
const positional = () => process.argv.slice(2).filter((arg) => !arg.startsWith('--'));

/**
 * Phase guide map — each phase maps to a structured guide with description,
 * deliverables, suggested commands, and gate criteria. This is the single
 * source the navigator renders; add new phase guidance here.
 * @type {Record<string, PhaseGuide>}
 */
export const PHASE_GUIDES = {
  intake: {
    description: 'Gather context before any design work.',
    deliverables: [
      'Read the context-pack output.',
      'Review relevant ADRs, sessions, and project-map.',
      'Scan the roadmap and pipeline digest for related work.',
    ],
    suggestedCommands: [
      'node contextkit/tools/scripts/context-pack.mjs',
      'node contextkit/tools/scripts/workflow.mjs status <slug>',
      'node contextkit/tools/scripts/project-map.mjs --for <relevant-module>',
    ],
    gateCriteria: 'No automated gate — advance when context is understood.',
  },
  prd: {
    description: 'Define the product WHAT/WHY in prd.md.',
    deliverables: [
      'Fill "## Problem" with a clear problem statement.',
      'Fill "## Goals" with measurable success criteria.',
      'Fill "## Users / Jobs", "## Non-goals", "## Success metrics".',
      'Document "## Open questions" for unresolved items.',
    ],
    suggestedCommands: [
      'Open and edit: contextkit/memory/workflows/<slug>/prd.md',
      'node contextkit/tools/scripts/workflow.mjs advance <slug> --ref "PRD complete"',
    ],
    gateCriteria: '"## Problem" and "## Goals" must be non-empty to advance.',
  },
  spec: {
    description: 'Define the technical HOW in spec.md.',
    deliverables: [
      'Fill "## Executive summary" with the approach.',
      'Fill "## Proposed design" with architecture details.',
      'Fill "## Interfaces / contracts" and "## Data flow".',
      'Fill "## Impact analysis" with blast-radius assessment.',
      'Fill "## Test plan" with the testing strategy.',
      'Fill "## Development sequence" with ordered steps.',
    ],
    suggestedCommands: [
      'Open and edit: contextkit/memory/workflows/<slug>/spec.md',
      'node contextkit/tools/scripts/workflow.mjs advance <slug> --ref "SPEC complete"',
    ],
    gateCriteria: '"## Proposed design" and "## Test plan" must be non-empty to advance.',
  },
  adr: {
    description: 'Record the architecture decision via /new-adr.',
    deliverables: [
      'Create an ADR with /new-adr capturing the decision and trade-offs.',
      'Link the ADR in decisions.md (the workflow pack file).',
    ],
    suggestedCommands: [
      'Run the /new-adr command or skill for the architecture decision.',
      'Link ADR in: contextkit/memory/workflows/<slug>/decisions.md',
      'node contextkit/tools/scripts/workflow.mjs advance <slug> --ref ADR-NNNN',
    ],
    gateCriteria: 'No automated gate — advance when the ADR is accepted.',
  },
  roadmap: {
    description: 'Add or link a roadmap item (P-ID) for new product capability.',
    deliverables: [
      'Add or link the P-ID in the roadmap for new capabilities.',
      'Skip if this is a bug/chore with no roadmap entry.',
    ],
    suggestedCommands: [
      'Run the /roadmap command or skill.',
      'node contextkit/tools/scripts/workflow.mjs advance <slug> --ref P-NNN',
    ],
    gateCriteria: 'No automated gate — advance when roadmap is linked or N/A.',
  },
  pipeline: {
    description: 'Create DevPipeline cards with --workflow and --spec references.',
    deliverables: [
      'Create pipeline tasks referencing this workflow.',
      'Link tasks in: contextkit/memory/workflows/<slug>/tasks.md',
    ],
    suggestedCommands: [
      'node contextkit/tools/scripts/pipeline.mjs add "<title>" --priority P1 --kind increment',
      'Link tasks in: contextkit/memory/workflows/<slug>/tasks.md',
      'node contextkit/tools/scripts/workflow.mjs advance <slug>',
    ],
    gateCriteria: 'No automated gate — advance when pipeline cards are created.',
  },
  ship: {
    description: 'Implement scoped cards via /ship.',
    deliverables: [
      'Implement the pipeline cards using the /ship command.',
      'Each card goes through the 9 ship stages (scope → report).',
    ],
    suggestedCommands: [
      'Run the /ship command or skill for each pipeline card.',
      'node contextkit/tools/scripts/ship-state.mjs current',
      'node contextkit/tools/scripts/workflow.mjs advance <slug>',
    ],
    gateCriteria: 'No automated gate — advance when implementation is done.',
  },
  testing: {
    description: 'Move implemented cards to testing with evidence.',
    deliverables: [
      'Run the test suite and record results.',
      'Use /pipetest to move cards from testing to conclusion.',
      'Write a daily report for audit trail.',
    ],
    suggestedCommands: [
      'npm test',
      'node contextkit/tools/scripts/workflow.mjs report <slug> --task <id>',
      'Run /pipetest to qa-approve or qa-reject.',
      'node contextkit/tools/scripts/workflow.mjs advance <slug>',
    ],
    gateCriteria: 'No automated gate — advance when tests pass and cards are approved.',
  },
  conclusion: {
    description: 'Close the workflow — final sign-off and session log.',
    deliverables: [
      'Verify all pipeline cards are in conclusion.',
      'Run /log-session to register the work.',
      'Advance the workflow to "done".',
    ],
    suggestedCommands: [
      'node contextkit/tools/scripts/pipeline.mjs board',
      'Run /log-session.',
      'node contextkit/tools/scripts/workflow.mjs advance <slug> --ref "Complete"',
    ],
    gateCriteria: 'No automated gate — advance to close the workflow.',
  },
};

/**
 * Renders the navigator output for a single workflow.
 * @param {object} workflow - Parsed workflow from readWorkflow().
 * @returns {string} Markdown report.
 */
function renderGuide(workflow) {
  const { slug, currentPhase, phases } = workflow;
  const guide = PHASE_GUIDES[currentPhase];
  const completedPhases = Object.entries(phases)
    .filter(([, state]) => state.status === 'done')
    .map(([name]) => name);
  const remaining = PHASES.slice(PHASES.indexOf(currentPhase));

  const lines = [
    `# 🧭 Workflow Navigator — ${slug}`,
    '',
    `**Current phase**: \`${currentPhase}\`  `,
    `**Completed**: ${completedPhases.length ? completedPhases.join(' → ') : 'none'}  `,
    `**Remaining**: ${remaining.join(' → ')}`,
    '',
  ];

  if (!guide) {
    lines.push(`> Workflow is **${currentPhase}** — no further guidance available.`);
    return lines.join('\n');
  }

  lines.push(`## 📋 Phase: ${currentPhase}`, '', guide.description, '');
  lines.push('### Deliverables', '');
  for (const deliverable of guide.deliverables) lines.push(`- ${deliverable}`);
  lines.push('', '### Suggested commands', '');
  for (const cmd of guide.suggestedCommands) {
    const resolved = cmd.replace(/<slug>/g, slug);
    lines.push(`\`\`\`bash\n${resolved}\n\`\`\``);
  }
  lines.push('', `### Gate criteria`, '', `> ${guide.gateCriteria}`, '');
  return lines.join('\n');
}

/**
 * Renders the JSON output for machine consumption.
 * @param {object} workflow - Parsed workflow from readWorkflow().
 * @returns {object} Structured guide object.
 */
function buildJsonGuide(workflow) {
  const { slug, currentPhase, kind, started, phases } = workflow;
  const guide = PHASE_GUIDES[currentPhase] || null;
  return {
    slug, kind, started, currentPhase,
    completedPhases: Object.entries(phases)
      .filter(([, state]) => state.status === 'done')
      .map(([name]) => name),
    remainingPhases: PHASES.slice(PHASES.indexOf(currentPhase)),
    guide: guide ? {
      ...guide,
      suggestedCommands: guide.suggestedCommands.map((cmd) => cmd.replace(/<slug>/g, slug)),
    } : null,
  };
}

function printUsage() {
  console.log('Usage: workflow-assist.mjs <slug> [--json] [--pack]');
  console.log('       workflow-assist.mjs --list');
  console.log('\nFlags:');
  console.log('  --json   Machine-readable JSON output.');
  console.log('  --pack   Append a bounded context bundle (recent ADRs, session, backlog).');
  console.log('  --list   Show navigator summary for all active workflows.');
}

async function appendContextPack() {
  try {
    const { digestLatestSession, extractUnreleased, readChangelog } = await import('../../runtime/hooks/boot-context-readers.mjs');
    const { ADR_FILENAME_RE, parseAdr, renderCatalogLine } = await import('./adr-digest-core.mjs');
    const { pathsFor } = await import('../../runtime/config/paths.mjs');
    const { readFile, readdir } = await import('node:fs/promises');

    const paths = pathsFor(ROOT);
    const readSafe = (absPath) => readFile(absPath, 'utf-8').catch(() => null);
    const [session, changelog] = await Promise.all([
      digestLatestSession(ROOT),
      readChangelog(ROOT),
    ]);
    const unreleased = extractUnreleased(changelog);

    let adrLines = [];
    try {
      const { resolve } = await import('node:path');
      const files = (await readdir(paths.decisions))
        .filter((fileName) => ADR_FILENAME_RE.test(fileName) && fileName !== '_TEMPLATE.md')
        .sort().reverse().slice(0, 5);
      for (const fileName of files) {
        const text = await readSafe(resolve(paths.decisions, fileName));
        if (text !== null) adrLines.push(renderCatalogLine(parseAdr(text, fileName)));
      }
    } catch { /* decisions dir missing — skip */ }

    const out = ['\n---\n', '## 📦 Context bundle\n'];
    const block = (title, body) => body?.trim() && out.push(`### ${title}`, '', body.trim(), '');
    block('Last session', session?.content);
    block('Unreleased (CHANGELOG)', unreleased);
    block('Recent ADRs', adrLines.length ? adrLines.join('\n') : null);
    return out.join('\n');
  } catch {
    return '\n\n> _Context bundle unavailable (missing boot-context-readers)._\n';
  }
}

async function run() {
  if (flag('--help') || flag('-h') || process.argv.length < 3) {
    printUsage();
    return;
  }

  if (flag('--list')) {
    const workflows = listWorkflows(ROOT).filter((wf) => !wf.malformed && wf.currentPhase !== 'done');
    if (workflows.length === 0) {
      console.log('No active workflows. Start one with: workflow.mjs new <slug>');
      return;
    }
    for (const workflow of workflows) {
      const guide = PHASE_GUIDES[workflow.currentPhase];
      console.log(`  ${workflow.slug.padEnd(30)} phase: ${workflow.currentPhase.padEnd(12)} ${guide?.description || ''}`);
    }
    return;
  }

  const [slug] = positional();
  if (!slug) { printUsage(); process.exit(1); }

  const workflow = readWorkflow(ROOT, slug);
  if (!workflow) {
    console.error(`Workflow "${slug}" not found. Run: workflow.mjs new ${slug}`);
    process.exit(1);
  }

  if (flag('--json')) {
    console.log(JSON.stringify(buildJsonGuide(workflow), null, 2));
    return;
  }

  let output = renderGuide(workflow);
  if (flag('--pack')) output += await appendContextPack();
  console.log(output);
}

run().catch((err) => {
  console.error(`workflow-assist: ${err?.message ?? err}`);
  process.exit(1);
});
