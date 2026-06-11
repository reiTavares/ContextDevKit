#!/usr/bin/env node
/**
 * ContextDevKit integration test — /project-map (structural map + active fitness).
 *
 * Split from `integration-test-tooling.mjs` (own fixture) when the project-map
 * coverage grew past that file's line budget — one suite, one concern. Covers
 * classification, dependency edges, the deterministic fingerprint (no churn /
 * stale-on-edit), insights (cycles), the architectural-fitness gate
 * (`--check --strict` → exit 1), opt-in enforcement, and the `--for` subgraph.
 * [ADR-0038/0039/0040/0046]
 *
 * Run:  node tools/integration-test-project-map.mjs   (exit 0 = healthy)
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { reporter, installFixture } from './it-helpers.mjs';

const rep = reporter();
const { ok, bad } = rep;
console.log('\n🌀 ContextDevKit integration test — project-map\n');
const fx = installFixture(rep);
const { proj, script } = fx;

try {
  // A frontend (.tsx) module that imports a backend (.ts) module → a cross-module edge.
  mkdirSync(join(proj, 'apps', 'web', 'src'), { recursive: true });
  mkdirSync(join(proj, 'apps', 'api', 'src'), { recursive: true });
  writeFileSync(join(proj, 'apps', 'web', 'src', 'App.tsx'), "import { startServer } from '../../api/src/server';\nexport function App() { return startServer; }\n");
  writeFileSync(join(proj, 'apps', 'api', 'src', 'server.ts'), 'export function startServer() {}\n');
  const pmIndex = join(proj, 'contextkit', 'memory', 'project-map', '00-index.md');
  const pmManifest = join(proj, 'contextkit', 'memory', 'project-map', 'manifest.json');
  const pmDir = join(proj, 'contextkit', 'memory', 'project-map');
  const pmGen = script('project-map.mjs');
  existsSync(pmIndex) && existsSync(pmManifest)
    ? ok('project-map generates the index + manifest under memory/project-map/')
    : bad(`project-map did not write its artifacts: ${pmGen.stdout || pmGen.stderr}`);
  (() => { try { const idx = readFileSync(pmIndex, 'utf-8'); return /🎨 frontend/.test(idx) && /⚙️ backend/.test(idx) && idx.includes('apps/web') && idx.includes('apps/api'); } catch { return false; } })()
    ? ok('project-map classifies frontend (.tsx) and backend (.ts) modules')
    : bad('project-map did not classify the frontend/backend split');
  (() => { try { const idx = readFileSync(pmIndex, 'utf-8'); return /## Module dependencies/.test(idx) && /`apps\/web\/`\s*→[^\n]*`apps\/api\/`/.test(idx); } catch { return false; } })()
    ? ok('project-map resolves a cross-module import into a dependency edge (ADR-0040)')
    : bad('project-map did not render the apps/web → apps/api edge');
  script('project-map.mjs', '--check').stdout.includes('fresh')
    ? ok('project-map --check reports a fresh map right after generation')
    : bad('project-map --check did not report fresh');
  // ADR-0039 — deterministic fingerprint: regenerating an unchanged tree is byte-identical.
  const pmBefore = readFileSync(pmIndex, 'utf-8');
  script('project-map.mjs');
  readFileSync(pmIndex, 'utf-8') === pmBefore
    ? ok('project-map regenerates byte-identical docs when nothing changed (no churn, ADR-0039)')
    : bad('project-map docs churned on a no-op regenerate');
  script('project-map.mjs', '--check').stdout.includes('STALE') === false
    ? ok('project-map --check is fresh before any edit (ADR-0039)')
    : bad('project-map --check reported stale on an unchanged tree');

  // ── ADR-0046 — active architectural-fitness substrate ──
  // apps/api imports apps/web back → a dependency cycle the insights must catch.
  writeFileSync(join(proj, 'apps', 'api', 'src', 'server.ts'), "import { App } from '../../web/src/App';\nexport function startServer() { return App; }\n");
  script('project-map.mjs');
  (() => { try { return (JSON.parse(readFileSync(pmManifest, 'utf-8')).insights?.cycles || []).length >= 1; } catch { return false; } })()
    ? ok('project-map detects a dependency cycle in insights (ADR-0046)')
    : bad('project-map did not detect the apps/web ↔ apps/api cycle');
  // Fitness gate: a forbidden edge fails --check --strict (the CI gate, exit 1).
  writeFileSync(join(pmDir, 'rules.json'), JSON.stringify({ forbidden: [{ from: 'apps/web', to: 'apps/api', reason: 'test layering' }] }));
  script('project-map.mjs');
  script('project-map.mjs', '--check', '--strict').status === 1
    ? ok('project-map --check --strict fails on a forbidden-edge violation (ADR-0046)')
    : bad('project-map fitness gate did not fail on a violation');
  // Opt-in: removing rules.json turns enforcement off again.
  rmSync(join(pmDir, 'rules.json'), { force: true });
  script('project-map.mjs');
  script('project-map.mjs', '--check', '--strict').status === 0
    ? ok('project-map --check --strict passes once rules are removed (opt-in, ADR-0046)')
    : bad('project-map gate still failed without rules.json');
  // Focused subgraph for the ADR-0044 retriever.
  script('project-map.mjs', '--for', 'apps/web').stdout.includes('apps/api')
    ? ok('project-map --for returns the focused subgraph (ADR-0046)')
    : bad('project-map --for did not return the subgraph');
} catch (err) {
  bad(`crashed: ${err?.stack || err}`);
} finally {
  fx.cleanup();
}

rep.finish('Integration (project-map)');
