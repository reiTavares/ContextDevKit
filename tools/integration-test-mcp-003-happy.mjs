/**
 * integration-test-mcp-003-happy.mjs — AC#1: All renderers accept the manifest
 *
 * Happy-path tests: all four renderers produce valid ConfigArtifact arrays,
 * correct file paths per scope, expandSource format contracts, streamable-http
 * transport rendering, Codex TOML format correctness, and ConfigArtifact
 * required-field contract across all hosts.
 *
 * Covers: Suites 2, 3, 11, 12, 14, 15 from integration-test-mcp-003.mjs
 * Run:    node tools/integration-test-mcp-003-happy.mjs
 * Exits 0 on all-pass, non-zero on any failure.
 */

import { reporter } from './it-helpers.mjs';
import {
  FIXTURE_REGISTRY, FIXTURE_MANIFEST,
  check, loadRenderers,
} from './integration-test-mcp-003-helpers.mjs';

const rep = reporter();
const { renderClaude, renderCodex, renderCursor, renderAg, expandSource } =
  await loadRenderers();

// ---------------------------------------------------------------------------
// Suite 2: AC#1 — All four renderers accept the same fixture manifest
// ---------------------------------------------------------------------------

console.log('\n[Suite 2] AC#1 — All four renderers accept the same manifest\n');

{
  const claudeArtifacts = renderClaude(FIXTURE_MANIFEST, FIXTURE_REGISTRY);
  check(rep, Array.isArray(claudeArtifacts) && claudeArtifacts.length >= 1,
    'render-claude returns a non-empty array');
  check(rep, claudeArtifacts.every(a => a.host === 'claude-code'),
    'render-claude artifacts carry host=claude-code');
  check(rep, claudeArtifacts.every(a => typeof a.content === 'string' && a.content.length > 0),
    'render-claude artifacts have non-empty content');

  const codexArtifacts = renderCodex(FIXTURE_MANIFEST, FIXTURE_REGISTRY);
  check(rep, Array.isArray(codexArtifacts) && codexArtifacts.length >= 1,
    'render-codex returns a non-empty array');
  check(rep, codexArtifacts.every(a => a.host === 'codex'),
    'render-codex artifacts carry host=codex');

  const cursorArtifacts = renderCursor(FIXTURE_MANIFEST, FIXTURE_REGISTRY);
  check(rep, Array.isArray(cursorArtifacts) && cursorArtifacts.length === 1,
    'render-cursor returns exactly 1 artifact (workspace scope)');
  check(rep, cursorArtifacts[0].host === 'cursor',
    'render-cursor artifact carries host=cursor');

  const agArtifacts = renderAg(FIXTURE_MANIFEST, FIXTURE_REGISTRY);
  check(rep, Array.isArray(agArtifacts) && agArtifacts.length === 1,
    'render-antigravity returns exactly 1 artifact');
  check(rep, agArtifacts[0].host === 'antigravity',
    'render-antigravity artifact carries host=antigravity');
}

// ---------------------------------------------------------------------------
// Suite 3: AC#1 — Scope-specific file paths per host
// ---------------------------------------------------------------------------

console.log('\n[Suite 3] AC#1 — Correct file paths per host + scope\n');

{
  const claudeProject = renderClaude(FIXTURE_MANIFEST, FIXTURE_REGISTRY, { scopes: ['project'] })[0];
  check(rep, claudeProject.filePath === '.claude/settings.json',
    'claude project scope -> .claude/settings.json');

  const claudeUser = renderClaude(FIXTURE_MANIFEST, FIXTURE_REGISTRY, { scopes: ['user'] })[0];
  check(rep, claudeUser.filePath.includes('claude_mcp_settings.json'),
    'claude user scope -> claude_mcp_settings.json');

  const codexUser = renderCodex(FIXTURE_MANIFEST, FIXTURE_REGISTRY, { scopes: ['user'] })[0];
  check(rep, codexUser.filePath.includes('.codex/config.toml'),
    'codex user scope -> .codex/config.toml');
  check(rep, codexUser.format === 'toml', 'codex user scope format is toml');

  const codexProject = renderCodex(FIXTURE_MANIFEST, FIXTURE_REGISTRY, { scopes: ['project'] })[0];
  check(rep, codexProject.filePath === '.codex/mcp.json',
    'codex project scope -> .codex/mcp.json');
  check(rep, codexProject.format === 'json', 'codex project scope format is json');

  const cursorArtifact = renderCursor(FIXTURE_MANIFEST, FIXTURE_REGISTRY)[0];
  check(rep, cursorArtifact.filePath === '.cursor/mcp.json',
    'cursor -> .cursor/mcp.json');

  const agArtifact = renderAg(FIXTURE_MANIFEST, FIXTURE_REGISTRY)[0];
  check(rep, agArtifact.filePath === '.agents/mcp.json',
    'antigravity -> .agents/mcp.json');
}

// ---------------------------------------------------------------------------
// Suite 11: AC#1 — expandSource: source format -> command/args/url mapping
// ---------------------------------------------------------------------------

console.log('\n[Suite 11] AC#1 — expandSource format contracts\n');

{
  const npmResult = expandSource('npm:@modelcontextprotocol/server-github', 'stdio');
  check(rep, npmResult.command === 'npx',                              'expandSource npm: command=npx');
  check(rep, npmResult.args[0] === '-y',                              'expandSource npm: args[0]=-y');
  check(rep, npmResult.args[1] === '@modelcontextprotocol/server-github', 'expandSource npm: args[1]=pkg');
  check(rep, npmResult.url === '',                                    'expandSource npm: url=empty');

  const httpResult = expandSource('https://mcp.example.com/sse', 'streamable-http');
  check(rep, httpResult.command === '',                               'expandSource http: command=empty');
  check(rep, httpResult.url === 'https://mcp.example.com/sse',       'expandSource http: url preserved');
  check(rep, httpResult.args.length === 0,                            'expandSource http: args=[]');

  const cmdResult = expandSource('cmd:python -m mcp_server --port 8080', 'stdio');
  check(rep, cmdResult.command === 'python',    'expandSource cmd: first token=command');
  check(rep, cmdResult.args[0] === '-m',        'expandSource cmd: args[0]=-m');
  check(rep, cmdResult.args[1] === 'mcp_server', 'expandSource cmd: args[1]=mcp_server');

  const rawResult = expandSource('/usr/local/bin/mcp-server', 'stdio');
  check(rep, rawResult.command === '/usr/local/bin/mcp-server', 'expandSource raw: command=path');
  check(rep, rawResult.args.length === 0, 'expandSource raw: args=[]');
}

// ---------------------------------------------------------------------------
// Suite 12: AC#1 — streamable-http server rendered with url, not command
// ---------------------------------------------------------------------------

console.log('\n[Suite 12] AC#1 — streamable-http rendered with url field\n');

{
  const httpManifest = {
    version: 1,
    servers: [
      { id: 'http-server', referencedSecrets: ['HTTP_API_KEY'], allowedTools: ['fetch'] },
    ],
  };

  const claudeHttpArtifact = renderClaude(httpManifest, FIXTURE_REGISTRY)[0];
  const claudeParsed = JSON.parse(claudeHttpArtifact.content);
  const claudeHttpEntry = claudeParsed.mcpServers['http-server'];
  check(rep, claudeHttpEntry && typeof claudeHttpEntry.url === 'string' && claudeHttpEntry.url.length > 0,
    'claude: http-server has url field');
  check(rep, !claudeHttpEntry.command,
    'claude: http-server has no command field (http transport)');

  const codexArtifacts = renderCodex(httpManifest, FIXTURE_REGISTRY);
  const tomlArtifact = codexArtifacts.find(a => a.format === 'toml');
  check(rep, !!tomlArtifact, 'codex: produces toml artifact for http-server');
  if (tomlArtifact) {
    check(rep,
      tomlArtifact.content.includes('url = "https://mcp.example.com/sse"'),
      'codex toml: http-server has url field'
    );
    check(rep,
      !tomlArtifact.content.includes('command = '),
      'codex toml: http-server has no command line'
    );
  }

  const cursorHttpArtifact = renderCursor(httpManifest, FIXTURE_REGISTRY)[0];
  const cursorParsed = JSON.parse(cursorHttpArtifact.content);
  const cursorHttpEntry = cursorParsed.mcpServers['http-server'];
  check(rep, cursorHttpEntry && typeof cursorHttpEntry.url === 'string',
    'cursor: http-server has url field');
  check(rep, !cursorHttpEntry.command,
    'cursor: http-server has no command field');

  const agHttpArtifact = renderAg(httpManifest, FIXTURE_REGISTRY)[0];
  const agParsed = JSON.parse(agHttpArtifact.content);
  const agHttpEntry = agParsed.mcpServers['http-server'];
  check(rep, agHttpEntry && typeof agHttpEntry.url === 'string',
    'antigravity: http-server has url field');
  check(rep, !agHttpEntry.command,
    'antigravity: http-server has no command field');
}

// ---------------------------------------------------------------------------
// Suite 14: AC#1 — Codex TOML format correctness
// ---------------------------------------------------------------------------

console.log('\n[Suite 14] AC#1 — Codex TOML format\n');

{
  const codexArtifacts = renderCodex(FIXTURE_MANIFEST, FIXTURE_REGISTRY);
  const tomlArtifact = codexArtifacts.find(a => a.format === 'toml');
  check(rep, !!tomlArtifact, 'render-codex produces a TOML artifact');

  if (tomlArtifact) {
    check(rep, tomlArtifact.content.includes('[[mcp.servers]]'),
      'TOML: contains [[mcp.servers]] section header');
    check(rep, tomlArtifact.content.includes('id = "contextdevkit"'),
      'TOML: contains contextdevkit id entry');
    check(rep, tomlArtifact.content.includes('command = "npx"'),
      'TOML: contains command = "npx"');
    check(rep, tomlArtifact.content.includes('args = ["-y"'),
      'TOML: args array starts with -y');
    check(rep, tomlArtifact.content.includes('[mcp.servers.env]'),
      'TOML: contains [mcp.servers.env] section for secrets');
    check(rep, tomlArtifact.content.includes('${env:HTTP_API_KEY}'),
      'TOML: env section references secret as ${env:HTTP_API_KEY}');
  }

  const jsonArtifact = codexArtifacts.find(a => a.format === 'json');
  check(rep, !!jsonArtifact, 'render-codex also produces a JSON artifact');
  if (jsonArtifact) {
    const parsed = JSON.parse(jsonArtifact.content);
    check(rep, !!parsed.mcpServers, 'codex JSON: has mcpServers root key');
  }
}

// ---------------------------------------------------------------------------
// Suite 15: AC#4 — ConfigArtifact required-field contract (all hosts)
// ---------------------------------------------------------------------------

console.log('\n[Suite 15] AC#4 — ConfigArtifact required-field contract\n');

{
  const allRenderers = [
    ['claude',      renderClaude],
    ['codex',       renderCodex],
    ['cursor',      renderCursor],
    ['antigravity', renderAg],
  ];

  for (const [hostLabel, renderer] of allRenderers) {
    const artifacts = renderer(FIXTURE_MANIFEST, FIXTURE_REGISTRY);
    for (const artifact of artifacts) {
      check(rep, typeof artifact.filePath === 'string' && artifact.filePath.length > 0,
        `${hostLabel}[${artifact.scope}]: artifact.filePath is a non-empty string`);
      check(rep, artifact.format === 'json' || artifact.format === 'toml',
        `${hostLabel}[${artifact.scope}]: artifact.format is json or toml`);
      check(rep, typeof artifact.content === 'string' && artifact.content.length > 0,
        `${hostLabel}[${artifact.scope}]: artifact.content is non-empty`);
      check(rep, Array.isArray(artifact.servers),
        `${hostLabel}[${artifact.scope}]: artifact.servers is an array`);
      check(rep, Array.isArray(artifact.skipped),
        `${hostLabel}[${artifact.scope}]: artifact.skipped is an array`);
      check(rep, typeof artifact.host === 'string' && artifact.host.length > 0,
        `${hostLabel}[${artifact.scope}]: artifact.host is non-empty string`);
    }
  }
}

rep.finish('MCP-003 happy-path');
