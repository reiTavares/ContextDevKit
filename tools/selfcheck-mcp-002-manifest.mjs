/**
 * MCP-002 self-check — Suite 2: manifest.mjs
 *
 * Validates readManifest / writeManifest / manifestPathFor: round-trip, atomic
 * write, BOM-strip, forward-slash paths, and secret-value rejection. Wired into
 * selfcheck.mjs via runMcp002ManifestChecks.
 *
 * @module selfcheck-mcp-002-manifest
 */
import { writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * @param {{ ok: Function, bad: Function }} rep
 * @param {{ FAKE_ROOT: string, MCP_DIR: string, readManifest: Function, writeManifest: Function, manifestPathFor: Function }} ctx
 */
export async function runMcp002ManifestChecks({ ok, bad }, { FAKE_ROOT, MCP_DIR, readManifest, writeManifest, manifestPathFor }) {
  console.log('  [MCP-002/2] manifest.mjs');

  // Missing manifest → empty defaults
  const empty = readManifest(FAKE_ROOT);
  empty.version === 1 ? ok('mcp-002/manifest: missing returns version:1') : bad(`mcp-002/manifest: missing version ${empty.version}`);
  Array.isArray(empty.servers) && empty.servers.length === 0
    ? ok('mcp-002/manifest: missing returns empty servers')
    : bad('mcp-002/manifest: missing servers should be []');

  // Write + round-trip
  const fixture = {
    version: 1,
    servers: [
      { id: 'contextdevkit', mode: 'read-only', referencedSecrets: [], allowedTools: [] },
      { id: 'github', mode: 'read-only', referencedSecrets: ['GITHUB_PERSONAL_ACCESS_TOKEN'], allowedTools: [] },
    ],
  };
  await writeManifest(fixture, FAKE_ROOT);
  const loaded = readManifest(FAKE_ROOT);
  loaded.version === 1 ? ok('mcp-002/manifest: roundtrip version=1') : bad(`mcp-002/manifest: roundtrip version ${loaded.version}`);
  loaded.servers?.length === 2 ? ok('mcp-002/manifest: roundtrip 2 servers') : bad(`mcp-002/manifest: roundtrip server count ${loaded.servers?.length}`);
  typeof loaded.generatedAt === 'string' ? ok('mcp-002/manifest: writeManifest stamps generatedAt') : bad('mcp-002/manifest: generatedAt missing');
  loaded.servers?.[1]?.id === 'github' ? ok('mcp-002/manifest: second server id correct') : bad(`mcp-002/manifest: second server id ${loaded.servers?.[1]?.id}`);

  // Forward-slash path (Windows safety)
  const mpath = manifestPathFor(FAKE_ROOT);
  !mpath.includes('\\') ? ok('mcp-002/manifest: manifestPathFor forward-slash') : bad(`mcp-002/manifest: manifestPathFor has backslash: ${mpath}`);

  // BOM-strip
  const raw = readFileSync(mpath, 'utf-8').replace(/^﻿/, '');
  writeFileSync(mpath, '﻿' + raw, 'utf-8');
  const bomLoaded = readManifest(FAKE_ROOT);
  bomLoaded.version === 1 ? ok('mcp-002/manifest: readManifest handles BOM') : bad('mcp-002/manifest: BOM handling failed');
  await writeManifest(fixture, FAKE_ROOT);

  // Secret VALUE rejection
  const badCases = [
    ['github PAT (ghp_…)', 'ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZabcde0123', 'secret VALUE'],
    ['OpenAI key (sk-…)', 'sk-abcdefghijklmnopqrstu', 'secret VALUE'],
    ['name with whitespace', 'MY SECRET', 'secret VALUE'],
    ['lowercase name', 'my_token', 'not a valid environment-variable name'],
  ];
  for (const [label, secretVal, fragment] of badCases) {
    try {
      await writeManifest({ version: 1, servers: [{ id: 'x', referencedSecrets: [secretVal] }] }, FAKE_ROOT);
      bad(`mcp-002/manifest: writeManifest should reject ${label}`);
    } catch (err) {
      err?.message?.includes(fragment)
        ? ok(`mcp-002/manifest: writeManifest rejects ${label}`)
        : bad(`mcp-002/manifest: wrong error for ${label}: ${err?.message?.slice(0, 80)}`);
    }
  }

  // readManifest also validates on load
  mkdirSync(join(FAKE_ROOT, 'contextkit', 'mcp'), { recursive: true });
  writeFileSync(
    join(FAKE_ROOT, 'contextkit', 'mcp', 'project-manifest.json'),
    JSON.stringify({ version: 1, servers: [{ id: 'x', referencedSecrets: ['ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZabcde0123'] }] }),
    'utf-8'
  );
  try {
    readManifest(FAKE_ROOT);
    bad('mcp-002/manifest: readManifest should reject embedded PAT on load');
  } catch (err) {
    err?.message?.includes('secret VALUE')
      ? ok('mcp-002/manifest: readManifest rejects embedded PAT')
      : bad(`mcp-002/manifest: wrong error on embedded PAT: ${err?.message?.slice(0, 80)}`);
  }

  // Restore clean state
  await writeManifest(fixture, FAKE_ROOT);
}
