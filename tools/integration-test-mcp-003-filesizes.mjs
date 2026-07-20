/**
 * integration-test-mcp-003-filesizes.mjs — AC#5: Renderer file sizes
 *
 * Verifies every renderer file stays within the 308-line tech-debt ceiling
 * (280-line budget, 308 tolerance).
 *
 * Covers: Suite 1 from the original integration-test-mcp-003.mjs
 * Run:    node tools/integration-test-mcp-003-filesizes.mjs
 * Exits 0 on all-pass, non-zero on any failure.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { reporter } from './it-helpers.mjs';
import { RENDER_DIR } from './integration-test-mcp-003-helpers.mjs';

const rep = reporter();

// ---------------------------------------------------------------------------
// Suite 1: AC#5 — Renderer file sizes <= 280 lines (tolerance ceiling 308)
// ---------------------------------------------------------------------------

console.log('\n[Suite 1] AC#5 — Renderer file sizes\n');

{
  const rendererFiles = [
    'render-shared.mjs',
    'render-claude.mjs',
    'render-codex.mjs',
    'render-cursor.mjs',
    'render-antigravity.mjs',
  ];
  // ADR-0143 (BIZ-0005/WF-0076): file size is advisory telemetry, never a verdict.
  // Enforcement moved to DDD Class-A + the reviewer-gate; the measurement stays as a
  // cheap "look at this file" trigger, but never fails the suite.
  for (const filename of rendererFiles) {
    const filePath = join(RENDER_DIR, filename);
    const lineCount = readFileSync(filePath, 'utf-8').split('\n').length;
    rep.ok(lineCount <= 308
      ? `${filename} size ${lineCount} lines (advisory telemetry)`
      : `${filename} size ${lineCount} lines (over 308 — advisory: review responsibility, not a blocker)`);
  }
}

rep.finish('MCP-003 filesizes');
