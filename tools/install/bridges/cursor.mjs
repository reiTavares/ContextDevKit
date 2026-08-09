/**
 * cursor.mjs — Cursor context bridge (F8 / ADR-0068).
 *
 * Context ONLY — no governance enforcement (that stays on the native hosts).
 *
 * Cursor reads `.cursor/rules/*.mdc`, which require YAML frontmatter at line 1
 * (`description` / `globs` / `alwaysApply`). marker-inject can't own line 1, so on
 * a NEW file we write the frontmatter first, then inject the kit block BELOW it;
 * the frontmatter is user-owned content above the marker and is preserved on
 * every re-install.
 */
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { injectMarkedBlock } from '../lib/marker-inject.mjs';

const FRONTMATTER = ['---', 'description: ContextDevKit project context (context-only, no enforcement)', 'globs:', 'alwaysApply: true', '---', ''].join('\n');

export async function installBridge(target, body, host) {
  const file = join(target, host.targetFile);
  if (!existsSync(file)) {
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, FRONTMATTER, 'utf-8'); // frontmatter must sit at line 1 for Cursor
  }
  await injectMarkedBlock({ filePath: file, body }); // appends/updates the marked block below
  return { file: host.targetFile };
}
