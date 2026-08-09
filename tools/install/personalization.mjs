/**
 * Installs one update-safe personalization reference across native host roots.
 * User instructions remain in memory files; only this bounded pointer block is
 * kit-owned and refreshable.
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { PLATFORM_DIR } from '../../templates/contextkit/runtime/config/paths.mjs';
import { injectMarkedBlock } from './lib/marker-inject.mjs';

export const PERSONALIZATION_START_MARKER = '<!-- contextdevkit:personalization:start -->';
export const PERSONALIZATION_END_MARKER = '<!-- contextdevkit:personalization:end -->';
export const PERSONALIZATION_MARKDOWN_RELATIVE_PATH = `${PLATFORM_DIR}/memory/preferences/personalization.md`;
export const OWNER_PREFERENCES_RELATIVE_PATH = `${PLATFORM_DIR}/memory/preferences/owner-preferences.json`;

const NATIVE_HOST_ENTRYPOINTS = Object.freeze([
  'CLAUDE.md',
  'AGENTS.md',
  'INSTRUCTIONS.md',
]);

/**
 * Render the shared host guidance without copying personalized content into a
 * generated file.
 * @returns {string} marker body shared by every native host
 */
export function renderPersonalizationReference() {
  return [
    '## Project personalization',
    '',
    'Before relevant project work, consult these user-owned, update-preserved files:',
    '',
    `- \`${PERSONALIZATION_MARKDOWN_RELATIVE_PATH}\` — explicit project-specific instructions.`,
    `- \`${OWNER_PREFERENCES_RELATIVE_PATH}\` — structured recommendation-only owner preferences.`,
    '',
    'Current system, developer, and user instructions and platform safety boundaries',
    'take precedence. The JSON store guides recommendations; it never authorizes work.',
    'Do not edit either personalization file unless the user explicitly requests it.',
  ].join('\n');
}

/**
 * Inject one dedicated atomic block into each existing native host entrypoint.
 * Content outside the markers remains user-owned and byte-preserved.
 *
 * @param {string} target project root
 * @param {string[]} report installer report collector
 * @returns {Promise<{wired:string[],missing:string[]}>} host wiring receipt
 */
export async function installProjectPersonalization(target, report) {
  const wired = [];
  const missing = [];
  const body = renderPersonalizationReference();
  for (const filename of NATIVE_HOST_ENTRYPOINTS) {
    const filePath = join(target, filename);
    if (!existsSync(filePath)) {
      missing.push(filename);
      continue;
    }
    await injectMarkedBlock({
      filePath,
      body,
      startMarker: PERSONALIZATION_START_MARKER,
      endMarker: PERSONALIZATION_END_MARKER,
    });
    wired.push(filename);
  }
  report.push(`✓ project personalization referenced by ${wired.join(', ') || 'no native host entrypoints'}`);
  if (missing.length > 0) report.push(`WARN personalization reference skipped missing host file(s): ${missing.join(', ')}`);
  return { wired, missing };
}
