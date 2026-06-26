/**
 * integration-test-mcp-007-render.mjs — MCP-007 sub-suite: render integration tests.
 *
 * Covers:
 *   [Suite 9]  AC#5 — renderClaude: ${env:GITHUB_TOKEN}, no write tools, valid JSON,
 *                      read tools in artifact.servers allowedTools
 *   [Suite 10] AC#5 — renderCodex: secret by reference, no write tools
 *   [Suite 11] AC#5 — renderCursor: ${env:GITHUB_TOKEN}, no write tools, valid JSON
 *   [Suite 12] AC#5 — render fail-closed: literal PAT in manifest → TypeError
 *                      (claude + cursor renderers both throw)
 *
 * Run:  node tools/integration-test-mcp-007-render.mjs
 * Exits non-zero on any failure. Plain node:* — zero framework, zero deps.
 */

import { reporter } from './it-helpers.mjs';
import {
  loadFixtures,
  loadRuntimeModules,
  WRITE_ADMIN_TOOLS,
  READ_TOOLS,
  LITERAL_RE,
} from './integration-test-mcp-007-helpers.mjs';

const { ok, bad, finish } = reporter();

// ── Load JSON fixtures ────────────────────────────────────────────────────────

let profile, registry;

try {
  const fixtures = loadFixtures();
  profile  = fixtures.profile;
  registry = fixtures.registry;
} catch (err) {
  bad(`JSON load failed — ${err.message}`);
  finish('MCP-007/render (integration)');
}

const registryEntries = registry.entries ?? [];
const profileServer   = (profile.servers ?? []).find((s) => s.id === 'github');

// ── Load runtime modules ──────────────────────────────────────────────────────

const { renderClaude, renderCodex, renderCursor } =
  await loadRuntimeModules({ ok, bad });

// ── Shared render fixtures ───────────────────────────────────────────────────

/**
 * Use allowedHosts:['*'] so the renderer's filterForHost passes for all hosts.
 * The original registry restricts to api.github.com which would skip the entry
 * when rendered for 'claude-code' (not a GitHub host).
 */
const RENDER_REGISTRY = registryEntries.map((e) =>
  e.id === 'github' ? { ...e, allowedHosts: ['*'] } : e
);

const RENDER_MANIFEST = {
  servers: [{
    id: 'github',
    mode: 'read-only',
    referencedSecrets: ['GITHUB_TOKEN'],
    allowedTools: profileServer?.allowedTools ?? ['get_repo', 'list_pull_requests', 'get_issue'],
  }],
};

const LITERAL_PAT_MANIFEST = {
  servers: [{
    id: 'github',
    mode: 'read-only',
    referencedSecrets: ['ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ01234'],
    allowedTools: ['get_repo'],
  }],
};

// ────────────────────────────────────────────────────────────────────────────
// [Suite 9] AC#5 — renderClaude output shape
// ────────────────────────────────────────────────────────────────────────────

console.log('\n[Suite 9] AC#5 — render integration: claude host output shape\n');

if (renderClaude) {
  let claudeArtifacts;
  try {
    claudeArtifacts = renderClaude(RENDER_MANIFEST, RENDER_REGISTRY, { scopes: ['project'] });
    ok('AC#5 renderClaude: no throw on valid manifest');
  } catch (err) {
    bad(`AC#5 renderClaude threw unexpectedly: ${err.message}`);
  }

  if (claudeArtifacts) {
    const artifact = claudeArtifacts.find((a) => a.scope === 'project');
    artifact
      ? ok('AC#5 renderClaude: project-scope artifact returned')
      : bad('AC#5 renderClaude: no project-scope artifact found');

    const content = artifact?.content ?? '';

    content.includes('${env:GITHUB_TOKEN}')
      ? ok('AC#5 renderClaude: output contains ${env:GITHUB_TOKEN} (secret by reference)')
      : bad('AC#5 renderClaude: ${env:GITHUB_TOKEN} NOT found in output — secret not by reference');

    const literalInContent = LITERAL_RE.some((p) => p.test(content));
    !literalInContent
      ? ok('AC#5 renderClaude: no literal token value in rendered output')
      : bad('AC#5 renderClaude: literal token pattern found in rendered output');

    for (const tool of WRITE_ADMIN_TOOLS) {
      !content.includes(tool)
        ? ok(`AC#5 renderClaude: write tool '${tool}' absent from output`)
        : bad(`AC#5 renderClaude: write tool '${tool}' LEAKED into output`);
    }

    // Read tools check via artifact.servers (not the raw JSON string)
    const resolvedGithub = (artifact?.servers ?? []).find((s) => s.id === 'github');
    const resolvedTools  = resolvedGithub?.allowedTools ?? [];
    const hasReadTool    = READ_TOOLS.some((t) => resolvedTools.includes(t));
    hasReadTool
      ? ok('AC#5 renderClaude: at least one read tool present in artifact.servers allowedTools')
      : bad(`AC#5 renderClaude: no read tools in artifact.servers[github].allowedTools — got ${JSON.stringify(resolvedTools)}`);

    try {
      JSON.parse(content);
      ok('AC#5 renderClaude: output is valid JSON');
    } catch {
      bad('AC#5 renderClaude: output is not valid JSON');
    }
  }
} else {
  bad('Suite 9 skipped — render-claude.mjs unavailable');
}

// ────────────────────────────────────────────────────────────────────────────
// [Suite 10] AC#5 — renderCodex output shape
// ────────────────────────────────────────────────────────────────────────────

console.log('\n[Suite 10] AC#5 — render integration: codex host output shape\n');

if (renderCodex) {
  let codexArtifacts;
  try {
    codexArtifacts = renderCodex(RENDER_MANIFEST, RENDER_REGISTRY);
    ok('AC#5 renderCodex: no throw on valid manifest');
  } catch (err) {
    bad(`AC#5 renderCodex threw unexpectedly: ${err.message}`);
  }

  if (codexArtifacts) {
    for (const artifact of codexArtifacts) {
      const content = artifact?.content ?? '';

      content.includes('GITHUB_TOKEN')
        ? ok(`AC#5 renderCodex (${artifact.scope}): GITHUB_TOKEN referenced in output`)
        : bad(`AC#5 renderCodex (${artifact.scope}): GITHUB_TOKEN not found in output`);

      content.includes('${env:GITHUB_TOKEN}')
        ? ok(`AC#5 renderCodex (${artifact.scope}): uses \${env:GITHUB_TOKEN} reference`)
        : bad(`AC#5 renderCodex (${artifact.scope}): \${env:GITHUB_TOKEN} NOT found — literal risk`);

      const literalInCodex = LITERAL_RE.some((p) => p.test(content));
      !literalInCodex
        ? ok(`AC#5 renderCodex (${artifact.scope}): no literal token pattern`)
        : bad(`AC#5 renderCodex (${artifact.scope}): literal token found`);

      for (const tool of WRITE_ADMIN_TOOLS) {
        !content.includes(tool)
          ? ok(`AC#5 renderCodex (${artifact.scope}): write tool '${tool}' absent`)
          : bad(`AC#5 renderCodex (${artifact.scope}): write tool '${tool}' LEAKED`);
      }
    }
  }
} else {
  bad('Suite 10 skipped — render-codex.mjs unavailable');
}

// ────────────────────────────────────────────────────────────────────────────
// [Suite 11] AC#5 — renderCursor output shape
// ────────────────────────────────────────────────────────────────────────────

console.log('\n[Suite 11] AC#5 — render integration: cursor host output shape\n');

if (renderCursor) {
  let cursorArtifacts;
  try {
    cursorArtifacts = renderCursor(RENDER_MANIFEST, RENDER_REGISTRY);
    ok('AC#5 renderCursor: no throw on valid manifest');
  } catch (err) {
    bad(`AC#5 renderCursor threw unexpectedly: ${err.message}`);
  }

  if (cursorArtifacts) {
    for (const artifact of cursorArtifacts) {
      const content = artifact?.content ?? '';

      content.includes('${env:GITHUB_TOKEN}')
        ? ok(`AC#5 renderCursor: \${env:GITHUB_TOKEN} present in output`)
        : bad(`AC#5 renderCursor: \${env:GITHUB_TOKEN} NOT found in output`);

      const literalInCursor = LITERAL_RE.some((p) => p.test(content));
      !literalInCursor
        ? ok('AC#5 renderCursor: no literal token in output')
        : bad('AC#5 renderCursor: literal token pattern found in output');

      for (const tool of WRITE_ADMIN_TOOLS) {
        !content.includes(tool)
          ? ok(`AC#5 renderCursor: write tool '${tool}' absent from output`)
          : bad(`AC#5 renderCursor: write tool '${tool}' LEAKED into output`);
      }

      try {
        JSON.parse(content);
        ok('AC#5 renderCursor: output is valid JSON');
      } catch {
        bad('AC#5 renderCursor: output is not valid JSON');
      }
    }
  }
} else {
  bad('Suite 11 skipped — render-cursor.mjs unavailable');
}

// ────────────────────────────────────────────────────────────────────────────
// [Suite 12] AC#5 — render fail-closed: literal PAT in manifest → TypeError
// ────────────────────────────────────────────────────────────────────────────

console.log('\n[Suite 12] AC#5 — render fail-closed: literal PAT in manifest throws\n');

if (renderClaude) {
  let claudeLiteralThrew = false;
  try {
    renderClaude(LITERAL_PAT_MANIFEST, RENDER_REGISTRY, { scopes: ['project'] });
  } catch (err) {
    if (err instanceof TypeError) claudeLiteralThrew = true;
  }
  claudeLiteralThrew
    ? ok('AC#5 renderClaude throws TypeError when manifest contains a literal PAT')
    : bad('AC#5 renderClaude must throw TypeError for literal PAT — did not throw');
} else {
  bad('Suite 12 (claude) skipped — render-claude.mjs unavailable');
}

if (renderCursor) {
  let cursorLiteralThrew = false;
  try {
    renderCursor(LITERAL_PAT_MANIFEST, RENDER_REGISTRY);
  } catch (err) {
    if (err instanceof TypeError) cursorLiteralThrew = true;
  }
  cursorLiteralThrew
    ? ok('AC#5 renderCursor throws TypeError when manifest contains a literal PAT')
    : bad('AC#5 renderCursor must throw TypeError for literal PAT — did not throw');
} else {
  bad('Suite 12 (cursor) skipped — render-cursor.mjs unavailable');
}

// ────────────────────────────────────────────────────────────────────────────
finish('MCP-007/render (integration)');
