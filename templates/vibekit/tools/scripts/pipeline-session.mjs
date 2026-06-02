/**
 * Session-aware DevPipeline transitions — `start` / `stop`.
 *
 * Separates a distinct responsibility from `pipeline.mjs` (pure CRUD on task
 * files): these two transitions couple a task to a **session** via the
 * workspace record (`claim.mjs`), and are the only places where a task move
 * also writes session-level state. The CLI dispatch in `pipeline.mjs`
 * delegates here.
 *
 * Cohesion: both halves share the same `findTaskFile` helper + the same
 * stage-transition shape (rename + status rewrite + sync). Keeping them in one
 * file makes start/stop symmetrical and lets the next maintainer read the full
 * lifecycle in one place. See [ADR-0015 §B](../../memory/decisions/0015-pipeline-dsl-working-stage-and-multi-session-work-claims.md).
 */
import { existsSync, readFileSync, readdirSync, renameSync } from 'node:fs';
import { resolve } from 'node:path';
import { writeFileAtomicSync } from '../../runtime/hooks/safe-io.mjs';
import { attachTask, detachTask } from './claim.mjs';

/**
 * Resolves a task id (with or without zero-padding) to its current stage + file
 * path. Returns `null` when the task isn't found — caller decides how to fail.
 *
 * @param {string} pipeDir — repo-relative pipeline dir (`vibekit/pipeline/`)
 * @param {string} rawId
 * @returns {{ stage: string, file: string } | null}
 */
function findTaskFile(pipeDir, rawId) {
  const id = String(rawId).padStart(3, '0');
  for (const stage of ['backlog', 'working', 'testing', 'conclusion']) {
    const dir = resolve(pipeDir, stage);
    if (!existsSync(dir)) continue;
    const file = readdirSync(dir).find((f) => f.startsWith(`${id}-`) && f.endsWith('.md'));
    if (file) return { stage, file };
  }
  return null;
}

function moveStage(pipeDir, from, to, file, statusValue) {
  const fromPath = resolve(pipeDir, from, file);
  const toPath = resolve(pipeDir, to, file);
  const text = readFileSync(fromPath, 'utf-8').replace(/^(status:).*$/m, `status: ${statusValue}`);
  writeFileAtomicSync(fromPath, text);
  renameSync(fromPath, toPath);
}

/**
 * `/pipeline start <id>` — moves a backlog task to `working/` AND attaches it
 * to the current session's workspace record. Refuses when the task isn't in
 * `backlog/` so a working/testing task can't be silently re-stamped.
 *
 * @param {string} pipeDir
 * @param {string} rawId
 * @param {(all: Array<object>) => void} sync — caller's sync function (renders board)
 */
export async function startTask(pipeDir, rawId, sync) {
  const found = findTaskFile(pipeDir, rawId);
  if (!found) throw new Error(`No task with id ${rawId}.`);
  if (found.stage !== 'backlog') throw new Error(`Task ${rawId} is in '${found.stage}', not backlog — refusing to start.`);
  moveStage(pipeDir, 'backlog', 'working', found.file, 'working');
  sync();
  await attachTask(rawId);
  return { id: String(rawId).padStart(3, '0'), stage: 'working' };
}

/**
 * `/pipeline stop <id>` — moves a `working/` task BACK to `backlog/` (NOT
 * testing/ — testing/ is "code done, awaiting QA", reached via explicit `move`)
 * and detaches it from the session. Mirror of start.
 */
export async function stopTask(pipeDir, rawId, sync) {
  const found = findTaskFile(pipeDir, rawId);
  if (!found) throw new Error(`No task with id ${rawId}.`);
  if (found.stage !== 'working') throw new Error(`Task ${rawId} is in '${found.stage}', not working — nothing to stop.`);
  moveStage(pipeDir, 'working', 'backlog', found.file, 'backlog');
  sync();
  await detachTask(rawId);
  return { id: String(rawId).padStart(3, '0'), stage: 'backlog' };
}
