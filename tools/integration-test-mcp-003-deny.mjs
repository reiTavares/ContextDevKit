/**
 * integration-test-mcp-003-deny.mjs — AC#3: Host filtering & input validation
 *
 * Verifies the deny/skip logic: servers whose allowedHosts excludes the target
 * host land in skipped[], registry-absent servers are always skipped, disabled
 * servers are never rendered, and all renderers throw on invalid manifest/registry
 * inputs (fail-closed at the boundary).
 *
 * Covers: Suites 7, 8, 9, 13 from integration-test-mcp-003.mjs
 * Run:    node tools/integration-test-mcp-003-deny.mjs
 * Exits 0 on all-pass, non-zero on any failure.
 */

import { reporter } from './it-helpers.mjs';
import {
  FIXTURE_REGISTRY, FIXTURE_MANIFEST,
  check, expectThrow, loadRenderers,
} from './integration-test-mcp-003-helpers.mjs';

const rep = reporter();
const { renderClaude, renderCodex, renderCursor, renderAg } = await loadRenderers();

// ---------------------------------------------------------------------------
// Suite 7: AC#3 — allowedHosts filtering: restricted server lands in skipped[]
// ---------------------------------------------------------------------------

console.log('\n[Suite 7] AC#3 — allowedHosts filtering and skipped[] reporting\n');

{
  // github allowedHosts = ['claude-code','cursor'] — codex + antigravity must skip it
  const codexArtifacts = renderCodex(FIXTURE_MANIFEST, FIXTURE_REGISTRY);
  const codexMain = codexArtifacts[0];

  check(rep,
    !codexMain.servers.some(s => s.id === 'github'),
    'codex: github (allowedHosts excludes codex) not in rendered servers'
  );
  check(rep,
    codexMain.skipped.includes('github'),
    'codex: github appears in skipped[]'
  );

  const agArtifact = renderAg(FIXTURE_MANIFEST, FIXTURE_REGISTRY)[0];
  check(rep,
    !agArtifact.servers.some(s => s.id === 'github'),
    'antigravity: github (allowedHosts excludes antigravity) not in rendered servers'
  );
  check(rep,
    agArtifact.skipped.includes('github'),
    'antigravity: github appears in skipped[]'
  );

  // claude-code and cursor must include github
  const claudeArtifact = renderClaude(FIXTURE_MANIFEST, FIXTURE_REGISTRY)[0];
  check(rep,
    claudeArtifact.servers.some(s => s.id === 'github'),
    'claude-code: github in rendered servers (allowedHosts includes claude-code)'
  );

  const cursorArtifact = renderCursor(FIXTURE_MANIFEST, FIXTURE_REGISTRY)[0];
  check(rep,
    cursorArtifact.servers.some(s => s.id === 'github'),
    'cursor: github in rendered servers (allowedHosts includes cursor)'
  );
}

// ---------------------------------------------------------------------------
// Suite 8: AC#3 — Registry-absent server always lands in skipped[]
// ---------------------------------------------------------------------------

console.log('\n[Suite 8] AC#3 — Registry-absent server skipped across all hosts\n');

{
  const allRenderers = [
    ['claude',      renderClaude],
    ['codex',       renderCodex],
    ['cursor',      renderCursor],
    ['antigravity', renderAg],
  ];

  for (const [hostLabel, renderer] of allRenderers) {
    const firstArtifact = renderer(FIXTURE_MANIFEST, FIXTURE_REGISTRY)[0];
    check(rep,
      firstArtifact.skipped.includes('unknown-server'),
      `${hostLabel}: unknown-server (absent from registry) in skipped[]`
    );
    check(rep,
      !firstArtifact.servers.some(s => s.id === 'unknown-server'),
      `${hostLabel}: unknown-server not in rendered servers`
    );
  }
}

// ---------------------------------------------------------------------------
// Suite 9: AC#3 — Disabled servers skipped, never rendered
// ---------------------------------------------------------------------------

console.log('\n[Suite 9] AC#3 — Disabled servers skipped\n');

{
  const manifestWithDisabled = {
    version: 1,
    servers: [
      { id: 'contextdevkit', disabled: true, referencedSecrets: [], allowedTools: [] },
      { id: 'playwright',    mode: 'write',  referencedSecrets: [], allowedTools: [] },
    ],
  };

  const claudeResult = renderClaude(manifestWithDisabled, FIXTURE_REGISTRY)[0];
  check(rep,
    claudeResult.skipped.includes('contextdevkit'),
    'claude: disabled contextdevkit appears in skipped[]'
  );
  check(rep,
    !claudeResult.servers.some(s => s.id === 'contextdevkit'),
    'claude: disabled contextdevkit NOT in rendered servers'
  );
  check(rep,
    claudeResult.servers.some(s => s.id === 'playwright'),
    'claude: non-disabled playwright IS in rendered servers'
  );
}

// ---------------------------------------------------------------------------
// Suite 13: AC#2 — Input validation: renderers throw on bad manifest/registry
// ---------------------------------------------------------------------------

console.log('\n[Suite 13] AC#2 — Input validation at boundary\n');

{
  const allRenderers = [
    ['claude',      renderClaude],
    ['codex',       renderCodex],
    ['cursor',      renderCursor],
    ['antigravity', renderAg],
  ];

  for (const [hostLabel, renderer] of allRenderers) {
    expectThrow(rep,
      `${hostLabel}: throws on manifest without servers array`,
      () => renderer({ version: 1 }, FIXTURE_REGISTRY),
    );
    expectThrow(rep,
      `${hostLabel}: throws on null manifest`,
      () => renderer(null, FIXTURE_REGISTRY),
    );
    expectThrow(rep,
      `${hostLabel}: throws on null registry`,
      () => renderer(FIXTURE_MANIFEST, null),
    );
    expectThrow(rep,
      `${hostLabel}: throws on non-array registry`,
      () => renderer(FIXTURE_MANIFEST, 'not-an-array'),
    );
  }
}

rep.finish('MCP-003 deny');
