/**
 * DevPipeline task I/O — read-only frontmatter parsing + task listing.
 *
 * Extracted from `pipeline.mjs` (which had crossed the file-size budget) so the
 * CLI, the weekly planner (`plan-next.mjs`), and the dependency gate all
 * single-source *how a ticket is read off disk*. Pure reads — this module never
 * creates, moves, or mutates a file. The write paths stay in `pipeline.mjs`.
 *
 * See [ADR-0015 §B](../../memory/decisions/0015-pipeline-dsl-working-stage-and-multi-session-work-claims.md).
 */
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseInlineArray } from './pipeline-validate.mjs';

/** The four pipeline stages, in lifecycle order. */
export const STAGES = ['backlog', 'working', 'testing', 'conclusion'];

/**
 * Parses the leading `---` YAML frontmatter block into a flat key→string map.
 * Tolerant: a file with no frontmatter yields `{}`; values keep their raw text.
 *
 * @param {string} text — full file contents
 * @returns {Record<string, string>}
 */
export function parseFrontmatter(text) {
  const match = text.match(/^---\n([\s\S]*?)\n---/);
  const frontmatter = {};
  if (match) {
    for (const line of match[1].split('\n')) {
      const colon = line.indexOf(':');
      if (colon > 0) frontmatter[line.slice(0, colon).trim()] = line.slice(colon + 1).trim();
    }
  }
  return frontmatter;
}

/**
 * Reads every ticket across all four stages into a normalized task array.
 * Read-only: a missing stage directory is skipped silently (never created).
 * Sorted by `priority + id` so the order is stable across calls.
 *
 * @param {string} pipeDir — absolute path to `contextkit/pipeline/`
 * @returns {Array<object>} normalized tasks (stage, file, id, title, type, …)
 */
export function listTasks(pipeDir) {
  const tasks = [];
  for (const stage of STAGES) {
    let files = [];
    try {
      files = readdirSync(resolve(pipeDir, stage)).filter((f) => f.endsWith('.md'));
    } catch {
      /* stage dir absent — nothing to list */
    }
    for (const file of files) {
      const fm = parseFrontmatter(readFileSync(resolve(pipeDir, stage, file), 'utf-8'));
      tasks.push({
        stage,
        file,
        id: fm.id || file.split('-')[0],
        title: fm.title || file,
        type: fm.type || 'task',
        priority: fm.priority || 'P2',
        severity: fm.severity || '',
        wsjf: fm.wsjf || '',
        bugType: fm.bugType || '',
        sla: fm.sla || '',
        roadmap: fm.roadmap || '',
        workflow: fm.workflow || '',
        spec: fm.spec || '',
        implemented: fm.implemented || '',
        concluded: fm.concluded || '',
        source: fm.source || '',
        paths: fm.paths || '',
        created: fm.created || '',
        complexity: fm.complexity || '',
        dependencies: parseInlineArray(fm.dependencies),
      });
    }
  }
  return tasks.sort((a, b) => (a.priority + a.id).localeCompare(b.priority + b.id));
}
