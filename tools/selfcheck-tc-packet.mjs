/**
 * Self-check — Task-Compiler work-packet (WF0022 / ADR-0087..0090).
 *
 * Verifies the deterministic compiler surface exported by
 * `templates/contextkit/tools/scripts/economy/tc-packet.mjs`:
 *   1. WORK_PACKET_SCHEMA_VERSION constant value.
 *   2. symbolRange — finds a function declaration in Go-ish source text.
 *   3. symbolRange — returns null for a missing symbol.
 *   4. symbolRange — brace-balanced span (multi-line body).
 *   5. symbolRange — Python-style indent-based span.
 *   6. compilePacket — skipped path (symbol not in index).
 *   7. compilePacket — happy path (writes tmp fixture, asserts all fields).
 *   8. compilePacket — claim and cost are null.
 *   9. compilePacket — frozen output (cannot mutate).
 *  10. compilePacket — confidence='derived' when exactly one file owns the symbol.
 *  11. presentPacket — happy-path string contains key fields.
 *  12. presentPacket — skipped marker string.
 *  13. Zero hot-path dep invariant (no non-node:/* or non-relative imports).
 *
 * ADR-0087. Zero runtime dependencies — node:* only.
 */
import { readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { resolve, join }                   from 'node:path';
import { tmpdir }                          from 'node:os';
import { pathToFileURL }                   from 'node:url';

/**
 * Checks that a module file imports only node:/* and relative paths.
 * @private
 */
async function checkModuleZeroDep(modPath) {
  let content = '';
  try { content = await readFile(modPath, 'utf-8'); } catch (err) {
    return { error: `could not read: ${err?.message ?? err}` };
  }
  const importRegex = /^import\s+(?:[^"'`]*\s+)?from\s+['"`]([^'"`]+)['"`]/gm;
  let match;
  while ((match = importRegex.exec(content)) !== null) {
    const spec = match[1];
    if (!spec.startsWith('.') && !spec.startsWith('node:')) {
      return { error: `imports from "${spec}"` };
    }
  }
  return { error: null };
}

/**
 * Runs Task-Compiler work-packet self-checks.
 * @param {{ ok: (m: string) => void, bad: (m: string) => void }} reporter
 * @param {{ KIT: string }} ctx - repo root
 */
export async function runTcPacketChecks({ ok, bad }, { KIT }) {
  console.log('Checking Task-Compiler work-packet (WF0022)...');

  const modPath = resolve(KIT, 'templates/contextkit/tools/scripts/economy/tc-packet.mjs');
  let lib;
  try {
    lib = await import(pathToFileURL(modPath).href);
    ok('tc-packet.mjs imports cleanly');
  } catch (err) {
    bad(`tc-packet.mjs import failed: ${err?.message ?? err}`);
    return;
  }

  const { WORK_PACKET_SCHEMA_VERSION, symbolRange, compilePacket, presentPacket } = lib;

  // ── 1. Schema version constant ────────────────────────────────────────────
  WORK_PACKET_SCHEMA_VERSION === 'cdk-work-packet/1'
    ? ok(`schema version is "cdk-work-packet/1"`)
    : bad(`schema version wrong: ${WORK_PACKET_SCHEMA_VERSION}`);

  // ── 2. symbolRange — finds a func declaration (Go-ish text) ──────────────
  const goSample = [
    'package main',
    '',
    'func Foo() {',
    '  return 42',
    '}',
    '',
    'func Bar() {}',
  ].join('\n');

  const fooRange = symbolRange(goSample, 'Foo');
  fooRange !== null && fooRange.start === 3 && fooRange.end === 5
    ? ok(`symbolRange finds "Foo" at lines 3–5`)
    : bad(`symbolRange("Foo") wrong: ${JSON.stringify(fooRange)}`);

  // ── 3. symbolRange — null for missing symbol ──────────────────────────────
  symbolRange(goSample, 'NotHere') === null
    ? ok('symbolRange returns null for unknown symbol')
    : bad('symbolRange should return null for unknown symbol');

  // ── 4. symbolRange — brace span covers multi-line body ───────────────────
  const barRange = symbolRange(goSample, 'Bar');
  barRange !== null && barRange.start === 7 && barRange.end === 7
    ? ok('symbolRange handles single-line brace body (Bar → line 7)')
    : bad(`symbolRange("Bar") wrong: ${JSON.stringify(barRange)}`);

  // ── 5. symbolRange — Python-style indent block ────────────────────────────
  const pySample = [
    'def greet(name):',
    '    msg = "hello " + name',
    '    return msg',
    '',
    'def other():',
    '    pass',
  ].join('\n');

  const greetRange = symbolRange(pySample, 'greet');
  greetRange !== null && greetRange.start === 1 && greetRange.end === 3
    ? ok('symbolRange handles Python-style indent block (greet → 1–3)')
    : bad(`symbolRange("greet") indent block wrong: ${JSON.stringify(greetRange)}`);

  // ── 6. compilePacket — skipped when symbol not in index ──────────────────
  const tmpDir = join(tmpdir(), `tc-packet-selfcheck-${process.pid}`);
  try {
    await mkdir(tmpDir, { recursive: true });
    // Write a tiny Go file with one exported symbol.
    await writeFile(
      join(tmpDir, 'main.go'),
      'package main\n\nfunc Foo() {\n  return\n}\n',
      'utf-8'
    );

    const skippedResult = compilePacket({
      objective: 'test skipped path',
      symbol:    'MissingSymbol',
      pkgPath:   tmpDir,
      root:      tmpDir,
      acceptance: [],
    });
    skippedResult?.status === 'skipped'
      ? ok('compilePacket returns skipped for unknown symbol')
      : bad(`compilePacket should return skipped: got ${JSON.stringify(skippedResult?.status)}`);

    // ── 7. compilePacket — happy path ─────────────────────────────────────
    const packet = compilePacket({
      objective:  'fix the Foo function',
      symbol:     'Foo',
      pkgPath:    tmpDir,
      root:       tmpDir,
      acceptance: ['all tests green'],
    }, { now: null });

    packet?.status !== 'skipped' && packet?.schemaVersion === 'cdk-work-packet/1'
      ? ok('compilePacket happy path: schemaVersion correct')
      : bad(`compilePacket happy path failed: ${JSON.stringify(packet?.status ?? packet?.schemaVersion)}`);

    packet?.files?.[0]?.symbols?.[0] === 'Foo'
      ? ok('compilePacket: files[0].symbols[0] === "Foo"')
      : bad(`compilePacket: wrong symbol in files[0]: ${JSON.stringify(packet?.files?.[0])}`);

    // ── 8. claim and cost are null ────────────────────────────────────────
    packet?.claim === null && packet?.cost === null
      ? ok('compilePacket: claim and cost are null')
      : bad(`compilePacket: claim=${packet?.claim} cost=${packet?.cost}`);

    // ── 9. frozen output ──────────────────────────────────────────────────
    let mutationThrew = false;
    try {
      packet.schemaVersion = 'tampered';
    } catch {
      mutationThrew = true;
    }
    mutationThrew || packet?.schemaVersion === 'cdk-work-packet/1'
      ? ok('compilePacket: returned packet is frozen (immutable)')
      : bad('compilePacket: packet is not frozen — mutation succeeded');

    // ── 10. confidence='derived' for single-file symbol ──────────────────
    packet?.confidence === 'derived'
      ? ok('compilePacket: confidence="derived" when symbol resolved to exactly one file')
      : bad(`compilePacket: confidence should be "derived", got "${packet?.confidence}"`);

  } finally {
    await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }

  // ── 11. presentPacket — happy-path string ────────────────────────────────
  const samplePacket = Object.freeze({
    schemaVersion:      'cdk-work-packet/1',
    objective:          'do the thing',
    taskClass:          'bugfix',
    files: Object.freeze([
      Object.freeze({ path: 'src/foo.go', symbols: Object.freeze(['Foo']), lines: Object.freeze([3, 5]) }),
    ]),
    acceptanceCriteria: Object.freeze([]),
    verification:       Object.freeze([]),
    outputContract:     Object.freeze({ artifactFirst: true }),
    confidence:         'derived',
    coverage:           'symbol',
    closure:            true,
    capturedAt:         null,
    claim:              null,
    cost:               null,
  });

  const rendered = presentPacket(samplePacket);
  const hasAllKeys = rendered.includes('cdk-work-packet/1')
    && rendered.includes('src/foo.go')
    && rendered.includes('Foo')
    && rendered.includes('3');
  hasAllKeys
    ? ok('presentPacket: rendered string contains schemaVersion, file, symbol, and start line')
    : bad(`presentPacket: missing expected fields in output:\n${rendered}`);

  // ── 12. presentPacket — skipped marker ───────────────────────────────────
  const skippedStr = presentPacket(Object.freeze({ status: 'skipped', reason: 'no file' }));
  skippedStr.startsWith('work-packet: skipped')
    ? ok('presentPacket: skipped marker renders correctly')
    : bad(`presentPacket: skipped render wrong: "${skippedStr}"`);

  // ── 13. Zero hot-path dep invariant ──────────────────────────────────────
  const depResult = await checkModuleZeroDep(modPath);
  depResult.error === null
    ? ok('zero-dep invariant: tc-packet.mjs imports only node:/* or relative paths')
    : bad(`zero-dep invariant: tc-packet.mjs ${depResult.error}`);
}
