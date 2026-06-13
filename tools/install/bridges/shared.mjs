/**
 * shared.mjs — the common bridge installer (F8 / ADR-0068).
 *
 * Five of the six bridges (Copilot, Gemini, Windsurf, Aider, Continue) write the
 * shared context body straight into their target file via `marker-inject.mjs` —
 * no per-tool envelope. They re-export `simpleBridgeInstall` as `installBridge`
 * so the orchestrator's uniform `import('./<key>.mjs').installBridge` contract
 * holds. Cursor is the exception (it needs YAML frontmatter at line 1) and ships
 * its own installer.
 */
import { join } from 'node:path';
import { injectMarkedBlock } from '../lib/marker-inject.mjs';

/**
 * Idempotently writes `body` into the tool's target file (context only).
 * @param {string} target project root
 * @param {string} body shared context body (from render.mjs)
 * @param {{ targetFile: string }} host registry entry
 * @returns {Promise<{ file: string }>}
 */
export async function simpleBridgeInstall(target, body, host) {
  await injectMarkedBlock({ filePath: join(target, host.targetFile), body });
  return { file: host.targetFile };
}
