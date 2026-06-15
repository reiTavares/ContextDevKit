/**
 * integration-test-indirect-write.mjs — end-to-end tests for the
 * indirect-write-reconcile PostToolUse hook (CDK-034, ADR-0072).
 *
 * Coverage:
 *   IW1. reconcileIndirectWrites pure: indirect detection (direct edit excluded).
 *   IW2. reconcileIndirectWrites pure: outOfContract detection.
 *   IW3. reconcileIndirectWrites pure: empty contractPaths -> outOfContract=[].
 *   IW4. classifyOrigin: full mapping table.
 *   IW5. Hook records directEdits in ledger when tool is Edit.
 *   IW6. Hook records indirectWrites in ledger when Bash changes a file.
 *
 * IW5/IW6 use a hermetic tmp git repo so git status --porcelain returns
 * predictable output. The hook is imported directly for the pure-helper cases
 * and spawned as a subprocess for the ledger-interaction cases.
 * Config lives at contextkit/config.json (PLATFORM_DIR = 'contextkit').
 */
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { reporter } from './it-helpers.mjs';

const KIT = dirname(dirname(fileURLToPath(import.meta.url)));
const rep = reporter();
const node = process.execPath;
const tmp = () => mkdtempSync(join(tmpdir(), 'ck-it-iw-'));
const clean = (r) => rmSync(r, { recursive: true, force: true });
const git = (args, cwd) => spawnSync('git', args, { cwd, encoding: 'utf-8' });

// ---------------------------------------------------------------------------
// Import pure helpers
// ---------------------------------------------------------------------------

const HOOK_PATH = resolve(KIT, 'templates/contextkit/runtime/hooks/indirect-write-reconcile.mjs');
let reconcileIndirectWrites, classifyOrigin;

try {
  const mod = await import('file://' + HOOK_PATH.replaceAll('\\', '/'));
  ({ reconcileIndirectWrites, classifyOrigin } = mod);
} catch (err) {
  rep.bad(`Module import failed: ${err?.message ?? err}`);
  rep.finish('indirect-write-reconcile (CDK-034)');
}

// ---------------------------------------------------------------------------
// IW1. Pure: indirect detection
// ---------------------------------------------------------------------------
console.log('\nIW1. Pure: indirect detection...');
{
  const r = reconcileIndirectWrites({
    changedFiles: ['src/foo.ts', 'src/bar.ts'],
    directEdits: ['src/foo.ts'],
    contractPaths: ['src/foo.ts', 'src/bar.ts'],
  });
  r.indirect.includes('src/bar.ts') && !r.indirect.includes('src/foo.ts')
    ? rep.ok('IW1. direct edit excluded from indirect list')
    : rep.bad(`IW1. indirect: ${JSON.stringify(r.indirect)}`);
  r.outOfContract.length === 0
    ? rep.ok('IW1. in-contract indirect not flagged as outOfContract')
    : rep.bad(`IW1. outOfContract should be empty: ${JSON.stringify(r.outOfContract)}`);
}

// ---------------------------------------------------------------------------
// IW2. Pure: outOfContract detection
// ---------------------------------------------------------------------------
console.log('\nIW2. Pure: outOfContract detection...');
{
  const r = reconcileIndirectWrites({
    changedFiles: ['src/foo.ts', 'scripts/gen.ts'],
    directEdits: [],
    contractPaths: ['src/foo.ts'],
  });
  r.outOfContract.length === 1 && r.outOfContract[0] === 'scripts/gen.ts'
    ? rep.ok('IW2. file outside contractPaths detected as outOfContract')
    : rep.bad(`IW2. outOfContract wrong: ${JSON.stringify(r.outOfContract)}`);
  r.indirect.length === 2
    ? rep.ok('IW2. both files in indirect (no directEdits)')
    : rep.bad(`IW2. indirect count wrong: ${r.indirect.length}`);
}

// ---------------------------------------------------------------------------
// IW3. Pure: empty contractPaths -> outOfContract always empty
// ---------------------------------------------------------------------------
console.log('\nIW3. Pure: empty contractPaths...');
{
  const r = reconcileIndirectWrites({
    changedFiles: ['anything.ts', 'other.ts'],
    directEdits: [],
    contractPaths: [],
  });
  r.outOfContract.length === 0
    ? rep.ok('IW3. empty contractPaths -> outOfContract=[] (no false positives)')
    : rep.bad(`IW3. should be empty, got: ${JSON.stringify(r.outOfContract)}`);
  r.indirect.length === 2
    ? rep.ok('IW3. indirect still populated when contractPaths empty')
    : rep.bad(`IW3. indirect wrong: ${r.indirect.length}`);
}

// ---------------------------------------------------------------------------
// IW4. classifyOrigin mapping table.
// Note: 'npm run codegen' matches allowed-generator because \bcodegen\b appears
// in the command string — this is the correct hook behavior.
// ---------------------------------------------------------------------------
console.log('\nIW4. classifyOrigin mapping...');
{
  const cases = [
    ['Edit', '', 'direct-edit'],
    ['Write', '', 'direct-edit'],
    ['MultiEdit', '', 'direct-edit'],
    ['Bash', 'prettier --write .', 'allowed-formatter'],
    ['Bash', 'eslint --fix src/', 'allowed-formatter'],
    ['Bash', 'node generate.mjs schema', 'allowed-generator'],
    ['Bash', 'npm run codegen', 'allowed-generator'],
    ['Bash', 'npm test', 'shell'],
    ['Bash', 'ls -la', 'shell'],
    ['mcp__drive__create_file', '', 'mcp'],
    ['mcp__gmail__send', '', 'mcp'],
    ['SomeTool', '', 'external'],
    [null, '', 'external'],
  ];
  const wrong = cases.filter(([tool, cmd, want]) => classifyOrigin(tool, cmd) !== want);
  wrong.length === 0
    ? rep.ok(`IW4. classifyOrigin: all ${cases.length} cases correct`)
    : rep.bad(`IW4. classifyOrigin wrong cases: ${wrong.map(([t, c, w]) => `${t}/"${c}"->expected ${w} got ${classifyOrigin(t, c)}`).join('; ')}`);
}

// ---------------------------------------------------------------------------
// IW5. Hook subprocess: Edit payload -> directEdits recorded in ledger.
// Config at contextkit/config.json (PLATFORM_DIR/config.json).
// ---------------------------------------------------------------------------
console.log('\nIW5. Hook subprocess: Edit -> directEdits recorded in ledger...');
{
  const root = tmp();
  try {
    git(['init', '-b', 'main'], root);
    git(['config', 'user.email', 'it@test.com'], root);
    git(['config', 'user.name', 'IT'], root);

    const ckDir = join(root, 'contextkit');
    const sessDir = join(root, '.claude', '.sessions');
    mkdirSync(ckDir, { recursive: true });
    mkdirSync(sessDir, { recursive: true });
    writeFileSync(join(ckDir, 'config.json'), JSON.stringify({ level: 5 }));

    const sessionId = 'test-iw-edit-001';
    const ledgerPath = join(sessDir, sessionId + '.json');

    const editPayload = {
      session_id: sessionId,
      tool_name: 'Edit',
      tool_input: { file_path: join(root, 'src', 'auth.ts') },
    };

    const result = spawnSync(node, [HOOK_PATH], {
      cwd: root,
      input: JSON.stringify(editPayload),
      encoding: 'utf-8',
    });

    result.status === 0
      ? rep.ok('IW5. hook exited 0 for Edit payload')
      : rep.bad(`IW5. hook non-zero exit: ${result.status} stderr=${result.stderr}`);

    if (existsSync(ledgerPath)) {
      const ledger = JSON.parse(readFileSync(ledgerPath, 'utf-8'));
      Array.isArray(ledger.directEdits) && ledger.directEdits.length > 0
        ? rep.ok(`IW5. directEdits recorded in ledger: ${ledger.directEdits[0]}`)
        : rep.bad(`IW5. directEdits not in ledger: ${JSON.stringify(ledger)}`);
    } else {
      rep.bad('IW5. ledger file not created');
    }
  } finally {
    clean(root);
  }
}

// ---------------------------------------------------------------------------
// IW6. Hook subprocess: Bash payload with a git-tracked changed file.
// ---------------------------------------------------------------------------
console.log('\nIW6. Hook subprocess: Bash -> indirectWrites recorded in ledger...');
{
  const root = tmp();
  try {
    git(['init', '-b', 'main'], root);
    git(['config', 'user.email', 'it@test.com'], root);
    git(['config', 'user.name', 'IT'], root);

    const ckDir = join(root, 'contextkit');
    const sessDir = join(root, '.claude', '.sessions');
    mkdirSync(ckDir, { recursive: true });
    mkdirSync(sessDir, { recursive: true });
    writeFileSync(join(ckDir, 'config.json'), JSON.stringify({ level: 5 }));

    const srcDir = join(root, 'src');
    mkdirSync(srcDir, { recursive: true });
    const genFile = join(srcDir, 'generated.ts');
    writeFileSync(genFile, '// original\n');
    git(['add', '.'], root);
    git(['commit', '-m', 'init'], root);
    writeFileSync(genFile, '// generated by codegen\n');

    const sessionId = 'test-iw-bash-002';
    const ledgerPath = join(sessDir, sessionId + '.json');
    writeFileSync(ledgerPath, JSON.stringify({
      sessionId,
      directEdits: [],
      modifications: [],
      registered: false,
      startedAt: Date.now(),
    }));

    const bashPayload = {
      session_id: sessionId,
      tool_name: 'Bash',
      tool_input: { command: 'node codegen.mjs' },
    };

    const result = spawnSync(node, [HOOK_PATH], {
      cwd: root,
      input: JSON.stringify(bashPayload),
      encoding: 'utf-8',
    });

    result.status === 0
      ? rep.ok('IW6. hook exited 0 for Bash payload')
      : rep.bad(`IW6. hook non-zero exit: ${result.status} stderr=${result.stderr}`);

    if (existsSync(ledgerPath)) {
      const ledger = JSON.parse(readFileSync(ledgerPath, 'utf-8'));
      Array.isArray(ledger.indirectWrites) && ledger.indirectWrites.length > 0
        ? rep.ok(`IW6. indirectWrites recorded: ${JSON.stringify(ledger.indirectWrites[0].files)}`)
        : rep.bad(`IW6. indirectWrites not in ledger: ${JSON.stringify(ledger)}`);
    } else {
      rep.bad('IW6. ledger file not created after Bash payload');
    }
  } finally {
    clean(root);
  }
}

rep.finish('indirect-write-reconcile (CDK-034)');