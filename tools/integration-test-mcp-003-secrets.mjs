/**
 * integration-test-mcp-003-secrets.mjs — AC#2: Secret handling
 *
 * Verifies that renderHost() is PURE with respect to secrets: all secret
 * values appear ONLY as ${env:NAME} references in artifact content, never
 * as literal values. Also tests the assertSecretName and buildEnvRefs guards
 * that enforce this at the boundary.
 *
 * Covers: Suites 4, 5, 6 from integration-test-mcp-003.mjs
 * Run:    node tools/integration-test-mcp-003-secrets.mjs
 * Exits 0 on all-pass, non-zero on any failure.
 */

import { reporter } from './it-helpers.mjs';
import {
  FIXTURE_REGISTRY, FIXTURE_MANIFEST,
  check, expectThrow, loadRenderers,
} from './integration-test-mcp-003-helpers.mjs';

const rep = reporter();
const { renderClaude, renderCodex, renderCursor, renderAg,
        buildEnvRefs, assertSecretName } = await loadRenderers();

// ---------------------------------------------------------------------------
// Suite 4: AC#2 — Secrets appear ONLY as ${env:NAME} references in content
// ---------------------------------------------------------------------------

console.log('\n[Suite 4] AC#2 — Secrets as env references; no literal values\n');

{
  const allArtifactPairs = [
    ['claude',      renderClaude(FIXTURE_MANIFEST, FIXTURE_REGISTRY)],
    ['codex',       renderCodex(FIXTURE_MANIFEST, FIXTURE_REGISTRY)],
    ['cursor',      renderCursor(FIXTURE_MANIFEST, FIXTURE_REGISTRY)],
    ['antigravity', renderAg(FIXTURE_MANIFEST, FIXTURE_REGISTRY)],
  ];

  for (const [hostLabel, artifacts] of allArtifactPairs) {
    for (const artifact of artifacts) {
      const hasHttpServer = artifact.servers.some(s => s.id === 'http-server');
      if (hasHttpServer) {
        check(rep,
          artifact.content.includes('${env:HTTP_API_KEY}'),
          `${hostLabel}: http-server secret emitted as \${env:HTTP_API_KEY}`
        );
      }

      check(rep,
        !artifact.content.match(/sk-[A-Za-z0-9]{20,}/),
        `${hostLabel}: no OpenAI-style literal key in artifact content`
      );

      check(rep,
        !artifact.content.match(/ghp_[A-Za-z0-9]{20,}/),
        `${hostLabel}: no GitHub PAT literal in artifact content`
      );
    }
  }

  // GITHUB_PERSONAL_ACCESS_TOKEN must appear as ref in claude + cursor (which include github)
  const claudeArtifact = renderClaude(FIXTURE_MANIFEST, FIXTURE_REGISTRY)[0];
  check(rep,
    claudeArtifact.content.includes('${env:GITHUB_PERSONAL_ACCESS_TOKEN}'),
    'claude: github secret emitted as ${env:GITHUB_PERSONAL_ACCESS_TOKEN}'
  );

  const cursorArtifact = renderCursor(FIXTURE_MANIFEST, FIXTURE_REGISTRY)[0];
  check(rep,
    cursorArtifact.content.includes('${env:GITHUB_PERSONAL_ACCESS_TOKEN}'),
    'cursor: github secret emitted as ${env:GITHUB_PERSONAL_ACCESS_TOKEN}'
  );
}

// ---------------------------------------------------------------------------
// Suite 5: AC#2 — assertSecretName rejects literal values
// ---------------------------------------------------------------------------

console.log('\n[Suite 5] AC#2 — assertSecretName rejects literal values\n');

{
  expectThrow(rep,
    'assertSecretName throws on GitHub PAT literal (ghp_...)',
    () => assertSecretName('ghp_ABCDEFGHIJKLMNOPQRSTUVWXabc', 'srv'),
  );

  expectThrow(rep,
    'assertSecretName throws on OpenAI key literal (sk-...)',
    () => assertSecretName('sk-ABCDEFGHIJKLMNOPQRSTUVWX1234', 'srv'),
  );

  expectThrow(rep,
    'assertSecretName throws on lowercase env name',
    () => assertSecretName('my_secret', 'srv'),
  );

  expectThrow(rep,
    'assertSecretName throws on non-string input',
    () => assertSecretName(42, 'srv'),
  );

  let noThrow = true;
  try { assertSecretName('GITHUB_PERSONAL_ACCESS_TOKEN', 'srv'); } catch { noThrow = false; }
  check(rep, noThrow, 'assertSecretName accepts valid ALL_CAPS env-var name');
}

// ---------------------------------------------------------------------------
// Suite 6: AC#2 — buildEnvRefs always emits ${env:NAME} shape
// ---------------------------------------------------------------------------

console.log('\n[Suite 6] AC#2 — buildEnvRefs env object shape\n');

{
  const envObj = buildEnvRefs(['GITHUB_TOKEN', 'API_KEY'], 'test-server');
  check(rep, envObj['GITHUB_TOKEN'] === '${env:GITHUB_TOKEN}',
    'buildEnvRefs: GITHUB_TOKEN -> ${env:GITHUB_TOKEN}');
  check(rep, envObj['API_KEY'] === '${env:API_KEY}',
    'buildEnvRefs: API_KEY -> ${env:API_KEY}');
  check(rep, Object.keys(envObj).length === 2,
    'buildEnvRefs: correct key count (2)');

  const emptyEnv = buildEnvRefs([], 'test-server');
  check(rep, Object.keys(emptyEnv).length === 0,
    'buildEnvRefs: empty secrets list yields empty env object');

  expectThrow(rep,
    'buildEnvRefs throws when secrets array contains a literal value',
    () => buildEnvRefs(['ghp_ABCDEFGHIJKLMNOPQRSTUVWXabc'], 'srv'),
  );
}

rep.finish('MCP-003 secrets');
