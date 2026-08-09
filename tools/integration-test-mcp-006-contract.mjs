/**
 * integration-test-mcp-006-contract.mjs — MCP-006 zero hot-path imports (AC-5).
 *
 * Covers Suite 9 from the original monolith:
 *   - server.mjs / tools.read.mjs / resources.mjs: only node:* or relative imports
 *   - prompts.mjs: zero imports at all (pure builder)
 *   - Streamable HTTP seam: 'transport/http' appears only in a comment, never as an
 *     active case label in a switch statement
 *
 * Run:  node tools/integration-test-mcp-006-contract.mjs
 * Exits non-zero on any failure. Plain node:* — zero framework, zero deps.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { reporter } from './it-helpers.mjs';
import { MCP_SERVER_DIR, SERVER_PATH } from './integration-test-mcp-006-helpers.mjs';

const { ok, bad, finish } = reporter();

console.log('\n[Suite 9] Zero hot-path imports / read-only contract (AC-5)\n');

/**
 * Extracts the specifier string from every `from '...'` clause in source.
 * Works across multi-line imports because we scan the whole file text.
 * @param {string} src
 * @returns {string[]}
 */
function extractSpecifiers(src) {
  const specifiers = [];
  const re = /\bfrom\s+['"]([^'"]+)['"]/g;
  let m;
  while ((m = re.exec(src)) !== null) specifiers.push(m[1]);
  return specifiers;
}

/**
 * Asserts that every `from` specifier in src is either `node:*` or relative.
 * @param {string} label
 * @param {string} src
 */
function assertNoBareSpecifiers(label, src) {
  const forbidden = extractSpecifiers(src).filter(
    (s) => !s.startsWith('node:') && !s.startsWith('./') && !s.startsWith('../')
  );
  forbidden.length === 0
    ? ok(`${label}: all imports are node:* or relative — no npm deps on hot path`)
    : bad(`${label}: unexpected bare specifiers: ${forbidden.join(', ')}`);
}

const serverSrc = readFileSync(SERVER_PATH, 'utf-8');
assertNoBareSpecifiers('server.mjs', serverSrc);

const toolsSrc = readFileSync(resolve(MCP_SERVER_DIR, 'tools.read.mjs'), 'utf-8');
assertNoBareSpecifiers('tools.read.mjs', toolsSrc);

const resSrc = readFileSync(resolve(MCP_SERVER_DIR, 'resources.mjs'), 'utf-8');
assertNoBareSpecifiers('resources.mjs', resSrc);

// prompts.mjs is a pure builder — it must have zero imports at all.
const promptsSrc = readFileSync(resolve(MCP_SERVER_DIR, 'prompts.mjs'), 'utf-8');
const promptsSpecifiers = extractSpecifiers(promptsSrc);
promptsSpecifiers.length === 0
  ? ok('prompts.mjs: zero imports (pure builder)')
  : bad(`prompts.mjs: unexpected imports: ${promptsSpecifiers.join(', ')}`);

// Streamable HTTP seam: the case string 'transport/http' must appear only in a
// comment, never as an active case label in a switch statement.
const hasActiveTransportCase = /^\s*case\s+['"]transport\/http['"]\s*:/m.test(serverSrc);
!hasActiveTransportCase
  ? ok('server.mjs: streamable HTTP is a clean comment seam, not an active case handler')
  : bad('server.mjs: "transport/http" is wired as an active switch case — should be seam only');

// ─── Done ─────────────────────────────────────────────────────────────────────

finish('MCP-006 contract integration test');
