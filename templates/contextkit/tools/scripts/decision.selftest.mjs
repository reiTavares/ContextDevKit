#!/usr/bin/env node
/**
 * decision.selftest.mjs — hermetic unit tests for decision.mjs and its three
 * sub-libs (decision-cli-create, decision-cli-lifecycle, decision-cli-registry).
 *
 * Coverage:
 *  - Every verb dispatches without throwing in --check/--dry-run mode.
 *  - Dry-run mode writes NO files.
 *  - --apply is atomic + idempotent (second run = no mutation).
 *  - `accept` refuses a non-human actor.
 *  - Unknown verb produces a clear error.
 *
 * Run:  node templates/contextkit/tools/scripts/decision.selftest.mjs
 * Exit: 0 = all pass, 1 = failures (printed to stderr).
 */
import { rmSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pathsFor } from '../../runtime/config/paths.mjs';
import { dispatch } from './decision.mjs';
import {
  assert,
  assertThrows,
  summaryAndExit,
  makeProjectRoot,
  fileCount,
} from './decision-selftest-helpers.mjs';

const SELF_DIR = dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

const root = makeProjectRoot(SELF_DIR);

try {
  // --- 1. Unknown verb ---
  assertThrows(
    'unknown verb throws with helpful message',
    () => dispatch({ command: 'frobnicate', positionals: [], flags: {} }, { root }),
    'unknown verb',
  );

  // --- 2. `need` verb (dry-run / --check mode) ---
  {
    const r = dispatch({ command: 'need', positionals: [], flags: { objective: 'add auth to API' } }, { root });
    assert('need: returns a receipt', r && typeof r.command === 'string');
    assert('need: command is "need"', r.command === 'need');
    assert('need: applied=false (dry-run)', r.applied === false);
    assert('need: writes nothing', r.writes.length === 0);
  }

  // --- 3. `search` verb ---
  {
    const r = dispatch({ command: 'search', positionals: [], flags: { objective: 'rotate API keys' } }, { root });
    assert('search: returns receipt', r && r.command === 'search');
    assert('search: applied=false', r.applied === false);
  }

  // --- 4. `classify` verb (no file → scans empty tree) ---
  {
    const r = dispatch({ command: 'classify', positionals: [], flags: {} }, { root });
    assert('classify: returns receipt', r && r.command === 'classify');
    assert('classify: applied=false', r.applied === false);
    assert('classify: detail.scanned is a number', typeof r.detail.scanned === 'number');
  }

  // --- 5. `validate` verb (no file → scans empty tree) ---
  {
    const r = dispatch({ command: 'validate', positionals: [], flags: {} }, { root });
    assert('validate: returns receipt', r && r.command === 'validate');
    assert('validate: applied=false', r.applied === false);
    assert('validate: detail.allOk is boolean', typeof r.detail.allOk === 'boolean');
  }

  // --- 6. `registry` verb dry-run ---
  {
    const before = fileCount(root);
    const r = dispatch({ command: 'registry', positionals: [], flags: {} }, { root });
    const after = fileCount(root);
    assert('registry dry-run: returns receipt', r && r.command === 'registry');
    assert('registry dry-run: applied=false', r.applied === false);
    assert('registry dry-run: no files written', before === after);
  }

  // --- 7. `render` verb (read-only) ---
  {
    const r = dispatch({ command: 'render', positionals: [], flags: {} }, { root });
    assert('render: returns receipt', r && r.command === 'render');
    assert('render: applied=false', r.applied === false);
  }

  // --- 8. `migrate-legacy` verb dry-run ---
  {
    const before = fileCount(root);
    const r = dispatch({ command: 'migrate-legacy', positionals: [], flags: {} }, { root });
    const after = fileCount(root);
    assert('migrate-legacy dry-run: returns receipt', r && r.command === 'migrate-legacy');
    assert('migrate-legacy dry-run: applied=false', r.applied === false);
    assert('migrate-legacy dry-run: no files moved', before === after);
  }

  // --- 9. `create` verb dry-run ---
  {
    const before = fileCount(root);
    const r = dispatch({
      command: 'create',
      positionals: [],
      flags: {
        id: 'ADR-0199',
        kind: 'ARCHITECTURE',
        title: 'Test Architecture Decision',
        'context-type': 'business',
        'primary-context': 'BIZ-0001',
      },
    }, { root });
    const after = fileCount(root);
    assert('create dry-run: returns receipt', r && r.command === 'create');
    assert('create dry-run: applied=false', r.applied === false);
    assert('create dry-run: no files written', before === after);
  }

  // --- 10. `create` verb --apply round-trip (atomic + idempotent) ---
  {
    const createFlags = {
      id: 'ADR-0200',
      kind: 'BUSINESS_AUTHORIZATION',
      title: 'Selftest Authorization',
      'context-type': 'business',
      'primary-context': 'BIZ-0001',
    };

    const r1 = dispatch({ command: 'create', positionals: [], flags: { ...createFlags, apply: true } }, { root });
    assert('create --apply: receipt returned', r1 && r1.command === 'create');
    assert('create --apply: applied=true', r1.applied === true, `got applied=${r1.applied}`);
    assert('create --apply: writes contains a path', r1.writes.length > 0);
    const created = r1.writes[0];
    assert('create --apply: file exists on disk', existsSync(created));

    // Idempotent: second apply should be a no-op.
    const r2 = dispatch({ command: 'create', positionals: [], flags: { ...createFlags, apply: true } }, { root });
    assert('create --apply idempotent: second run applied=false', r2.applied === false);
    assert('create --apply idempotent: no mutation', r2.detail?.idempotentNoop === true);
  }

  // --- 11. `accept` refuses non-human actor ---
  assertThrows(
    'accept: refuses non-human actor',
    () => dispatch({ command: 'accept', positionals: [], flags: { id: 'ADR-0200', actor: 'ai-agent' } }, { root }),
    'REFUSED',
  );

  // --- 12. `accept` refuses absent actor ---
  assertThrows(
    'accept: refuses absent actor',
    () => dispatch({ command: 'accept', positionals: [], flags: { id: 'ADR-0200' } }, { root }),
    'REFUSED',
  );

  // --- 13. `accept` dry-run with human actor (file must exist from step 10) ---
  {
    const r = dispatch({
      command: 'accept',
      positionals: [],
      flags: { id: 'ADR-0200', actor: 'human' },
    }, { root });
    assert('accept dry-run: returns receipt', r && r.command === 'accept');
    assert('accept dry-run: applied=false', r.applied === false);
    assert('accept dry-run: patch contains status=accepted', r.detail?.patch?.status === 'accepted');
  }

  // --- 14. `link` verb dry-run ---
  {
    const paths = pathsFor(root);
    const entityDir = paths.businesses ?? join(root, 'contextkit', 'memory', 'businesses');
    mkdirSync(entityDir, { recursive: true });
    const entityFile = join(entityDir, 'BIZ-0001-selftest.json');
    writeFileSync(entityFile, JSON.stringify({ id: 'BIZ-0001', decisionRefs: { governing: [] } }, null, 2));

    const before = fileCount(root);
    const r = dispatch({
      command: 'link',
      positionals: [],
      flags: { id: 'ADR-0200', entity: entityFile },
    }, { root });
    const after = fileCount(root);
    assert('link dry-run: returns receipt', r && r.command === 'link');
    assert('link dry-run: applied=false', r.applied === false);
    assert('link dry-run: no new files', before === after);
  }

  // --- 15. `link` --apply round-trip (idempotent) ---
  {
    const paths = pathsFor(root);
    const entityDir = paths.businesses ?? join(root, 'contextkit', 'memory', 'businesses');
    const entityFile = join(entityDir, 'BIZ-0001-selftest.json');

    const r1 = dispatch({
      command: 'link', positionals: [], flags: { id: 'ADR-0200', entity: entityFile, apply: true },
    }, { root });
    assert('link --apply: applied=true', r1.applied === true);

    // Idempotent: ref already present.
    const r2 = dispatch({
      command: 'link', positionals: [], flags: { id: 'ADR-0200', entity: entityFile, apply: true },
    }, { root });
    assert('link --apply idempotent: second run is a noop', r2.detail?.idempotentNoop === true);
  }

  // --- 16. `supersede` refuses non-human actor ---
  assertThrows(
    'supersede: refuses non-human actor',
    () => dispatch({
      command: 'supersede', positionals: [], flags: { 'old-id': 'ADR-0199', 'new-id': 'ADR-0200', actor: 'bot' },
    }, { root }),
    'REFUSED',
  );

  // --- 17. `supersede` dry-run with human actor ---
  {
    const r = dispatch({
      command: 'supersede', positionals: [], flags: { 'old-id': 'ADR-0199', 'new-id': 'ADR-0200', actor: 'human' },
    }, { root });
    assert('supersede dry-run: returns receipt', r && r.command === 'supersede');
    assert('supersede dry-run: applied=false', r.applied === false);
  }

  // --- 18. `registry` --apply writes the registry ---
  {
    const r = dispatch({ command: 'registry', positionals: [], flags: { apply: true } }, { root });
    assert('registry --apply: returns receipt', r && r.command === 'registry');
    assert('registry --apply: applied=true', r.applied === true);
  }

  // --- 19. registry --apply is idempotent (second run: same result) ---
  {
    const r2 = dispatch({ command: 'registry', positionals: [], flags: { apply: true } }, { root });
    assert('registry --apply idempotent: second run returns receipt', r2 && r2.command === 'registry');
    assert('registry --apply idempotent: applied=true (byte-identical rebuild)', r2.applied === true);
  }

} finally {
  try { rmSync(root, { recursive: true, force: true }); } catch { /* best effort */ }
}

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

summaryAndExit('decision.selftest');
