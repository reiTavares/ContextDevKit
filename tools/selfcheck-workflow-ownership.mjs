#!/usr/bin/env node
/**
 * Self-check — Workflow OWNERSHIP placement gate (WF-0057, BIZ-0001 ownership
 * rule 3: "one physical canonical owner").
 *
 * WHY this gate exists: an Operation/Business-owned workflow MUST live nested
 * under its parent context (`operations/<OP>/workflows/` or
 * `business/<BIZ>/workflows/`, incl. the `done/` archive), NEVER in the central
 * legacy `memory/workflows/` root. The protocol violation that motivated this
 * gate was an OP-0003-owned workflow created in central with legacy naming
 * because `createWaveWorkflow` ignored the owner. This selftest is the permanent
 * enforcement: it fails loudly (exit 1) if any owned workflow sits in central, or
 * if a context's `executed-by WF-####` relation is NOT physically nested under it.
 *
 * It reads the GENERATED workflow registry (`buildWorkflowRegistry`) — the same
 * `path` + `owner` rows every consumer sees — plus the on-disk operation.json /
 * business.json relations, so it catches both the row-level and the
 * relation-level expression of the same invariant.
 *
 * Standalone runnable: `node tools/selfcheck-workflow-ownership.mjs`
 * Exit 0 on all-pass, exit 1 on any failure. Zero runtime deps — node:* only.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const KIT = dirname(dirname(fileURLToPath(import.meta.url)));
const SCRIPTS = resolve(KIT, 'templates/contextkit/tools/scripts');

let failures = 0;
const ok = (msg) => console.log(`  ✓ ${msg}`);
const bad = (msg) => { console.error(`  ✗ ${msg}`); failures += 1; };
const urlFor = (abs) => pathToFileURL(abs).href;

/** Forward-slash a path so the assertions are spelling-stable on Windows. */
const fwd = (value) => String(value).split('\\').join('/');

/** Defensive JSON read (BOM-stripped); null when missing/unreadable. */
function readJsonSafe(path) {
  if (!existsSync(path)) return null;
  try { return JSON.parse(readFileSync(path, 'utf-8').replace(/^﻿/, '')); } catch { return null; }
}

/**
 * True when a registry `path` correctly nests an OWNED workflow under its parent.
 * The path is `memory`-relative (e.g. `operations/OP-0003-.../workflows/WF-...`
 * or `.../done/WF-...`). The done-sweep files a concluded owned workflow into the
 * owner's `done/` archive — still nested — so both `/workflows/` and `/done/` are
 * accepted, but the central `workflows/` root (no `operations|business` prefix) is
 * a violation.
 */
function nestsUnderOwner(relPath, owner) {
  const path = fwd(relPath);
  const parent = owner.startsWith('OP-') ? 'operations' : 'business';
  const reNested = new RegExp(`^${parent}/${owner}-[^/]+/(workflows|done)/`);
  return reNested.test(path);
}

// ---------------------------------------------------------------------------
// Resolve the LIVE tree this gate runs against. The selftest validates the
// installed dogfood tree (the real workflows) when present, falling back to the
// template tree for a clean checkout.
// ---------------------------------------------------------------------------
const LIVE_ROOTS = [KIT, resolve(KIT, 'templates')].filter((root) => existsSync(resolve(root, 'contextkit/memory')));
if (LIVE_ROOTS.length === 0) {
  bad('no contextkit/memory tree found to validate (neither dogfood nor template)');
}

const { buildWorkflowRegistry } = await import(urlFor(resolve(SCRIPTS, 'registry/workflow.mjs')));
const { pathsFor } = await import(urlFor(resolve(KIT, 'templates/contextkit/runtime/config/paths.mjs')));

for (const root of LIVE_ROOTS) {
  console.log(`\n[ownership] root: ${fwd(root)}\n`);

  // 1. Every OWNED registry row nests under its parent (no owned WF in central).
  const registry = buildWorkflowRegistry(root);
  const owned = registry.workflows.filter((row) => row.owner);
  if (owned.length === 0) {
    ok('no owned workflows in this tree (vacuously compliant)');
  }
  for (const row of owned) {
    nestsUnderOwner(row.path, row.owner)
      ? ok(`${row.id} (owner ${row.owner}) nests correctly → ${row.path}`)
      : bad(`${row.id} (owner ${row.owner}) is NOT nested under its owner — path "${row.path}" (central placement violates BIZ-0001 rule 3)`);
  }

  // 2. Inverse smell — every context's `executed-by WF-####` relation must point
  //    at a workflow PHYSICALLY nested under that same context.
  const paths = pathsFor(root);
  for (const [parentDir, manifest] of [[paths.operations, 'operation.json'], [paths.business, 'business.json']]) {
    if (!existsSync(parentDir)) continue;
    for (const entry of readdirSync(parentDir, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.name === '_TEMPLATE') continue;
      const contextDir = resolve(parentDir, entry.name);
      const meta = readJsonSafe(resolve(contextDir, manifest));
      if (!meta || !Array.isArray(meta.relations)) continue;
      const ownerId = String(meta.id || entry.name).match(/^((OP|BIZ)-\d{4})/)?.[1];
      if (!ownerId) continue;
      for (const rel of meta.relations) {
        if (rel?.type !== 'executed-by' || !/^WF-\d{4}$/.test(String(rel.ref || ''))) continue;
        const row = registry.workflows.find((candidate) => candidate.id === rel.ref);
        if (!row) { bad(`${ownerId} declares executed-by ${rel.ref} but no such workflow exists in the registry`); continue; }
        row.owner === ownerId && nestsUnderOwner(row.path, ownerId)
          ? ok(`${ownerId} executed-by ${rel.ref} is physically nested under it`)
          : bad(`${ownerId} executed-by ${rel.ref} is NOT nested under it (owner="${row.owner}", path="${row.path}")`);
      }
    }
  }
}

console.log(
  failures === 0
    ? '\n  PASS — workflow-ownership gate (WF-0057, BIZ-0001 rule 3): every owned workflow nests under its parent.\n'
    : `\n  FAIL — workflow-ownership gate: ${failures} placement violation(s).\n`,
);
process.exit(failures === 0 ? 0 : 1);
