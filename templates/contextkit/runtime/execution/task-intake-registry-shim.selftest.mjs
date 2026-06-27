#!/usr/bin/env node
/**
 * task-intake-registry-shim.selftest.mjs — OP-0005 / ADR-0125 Wave 4.
 *
 * Verifies the §22/§33 decision-registry read-shim: `resolveDecisionRegistryPath`
 * prefers a `decisions/`-nested cache when present and falls back to the canonical
 * memory-root cache otherwise. Hermetic (tmp root) and byte-stable. Zero deps.
 */
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { resolveDecisionRegistryPath } from './task-intake.mjs';
import { pathsFor } from '../config/paths.mjs';

let failures = 0;
const ok = (m) => console.log(`  ok   ${m}`);
const bad = (m) => { console.log(`  BAD  ${m}`); failures += 1; };

const root = mkdtempSync(join(tmpdir(), 'ck-registry-shim-'));
try {
  const canonical = pathsFor(root).decisionRegistry;
  const nested = canonical.replace(/decision-registry\.json$/, 'decisions/decision-registry.json');

  // Case A — neither cache exists → canonical path is returned (fallback).
  resolveDecisionRegistryPath(root) === canonical
    ? ok('A. no cache present → falls back to the canonical memory-root path')
    : bad(`A. expected canonical, got ${resolveDecisionRegistryPath(root)}`);

  // Case B — only the nested cache exists → nested path is preferred.
  mkdirSync(dirname(nested), { recursive: true });
  writeFileSync(nested, JSON.stringify({ decisions: [] }));
  resolveDecisionRegistryPath(root) === nested
    ? ok('B. nested decisions/ cache present → preferred over canonical')
    : bad(`B. expected nested, got ${resolveDecisionRegistryPath(root)}`);

  // Case C — both exist → nested still wins (decisions/ is the §22/§33 location).
  mkdirSync(dirname(canonical), { recursive: true });
  writeFileSync(canonical, JSON.stringify({ decisions: [] }));
  resolveDecisionRegistryPath(root) === nested
    ? ok('C. both present → nested decisions/ still preferred')
    : bad(`C. expected nested, got ${resolveDecisionRegistryPath(root)}`);
} finally {
  rmSync(root, { recursive: true, force: true });
}

console.log(failures === 0 ? '\nPASSED' : `\nFAILED (${failures})`);
process.exit(failures === 0 ? 0 : 1);
