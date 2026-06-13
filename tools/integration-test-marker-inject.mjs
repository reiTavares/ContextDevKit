/**
 * integration-test-marker-inject.mjs — F4 / ADR-0067.
 *
 * Verifies the marker-based idempotent injection utility: a NEW file gets the
 * marked block; re-inject with a different body updates ONLY the block; the same
 * body twice is byte-identical (idempotent); user content above AND below is
 * preserved; a markerless existing file is appended-to without clobbering; the
 * strip helper removes the block and keeps user content; malformed markers never
 * throw (rule 2 — never corrupt the user's file).
 */
import { mkdtempSync, readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { reporter } from './it-helpers.mjs';
import {
  injectMarkedBlock,
  stripMarkedBlock,
  stripMarkedBlockFile,
  START_MARKER,
  END_MARKER,
} from './install/lib/marker-inject.mjs';

const rep = reporter();
const dir = mkdtempSync(join(tmpdir(), 'contextkit-marker-it-'));
const read = (p) => readFileSync(p, 'utf-8');

try {
  // (a) NEW file → creates the marked block.
  const newFile = join(dir, 'new.md');
  const r1 = await injectMarkedBlock({ filePath: newFile, body: 'hello v1' });
  const c1 = read(newFile);
  r1.created && c1.includes(START_MARKER) && c1.includes(END_MARKER) && c1.includes('hello v1')
    ? rep.ok('a. new file creates marked block')
    : rep.bad(`a. new file wrong: ${JSON.stringify(r1)} / ${c1}`);

  // (c) idempotency — same body again → byte-identical, no update.
  const r1b = await injectMarkedBlock({ filePath: newFile, body: 'hello v1' });
  read(newFile) === c1 && !r1b.updated
    ? rep.ok('c. re-inject same body is byte-identical (idempotent)')
    : rep.bad(`c. idempotency broken: ${JSON.stringify(r1b)}`);

  // (b) re-inject DIFFERENT body → updates only the block.
  const r2 = await injectMarkedBlock({ filePath: newFile, body: 'hello v2' });
  const c2 = read(newFile);
  r2.updated && c2.includes('hello v2') && !c2.includes('hello v1')
    ? rep.ok('b. different body updates the block')
    : rep.bad(`b. update failed: ${JSON.stringify(r2)} / ${c2}`);

  // (d) user content ABOVE and BELOW preserved across updates.
  const wrapped = join(dir, 'wrapped.md');
  writeFileSync(wrapped, `# My Title\n\nintro prose\n\n${START_MARKER}\nold body\n${END_MARKER}\n\n## Footer\n\nuser footer\n`, 'utf-8');
  await injectMarkedBlock({ filePath: wrapped, body: 'fresh body' });
  const cw = read(wrapped);
  cw.includes('# My Title') && cw.includes('intro prose') && cw.includes('## Footer') && cw.includes('user footer') && cw.includes('fresh body') && !cw.includes('old body')
    ? rep.ok('d. content above and below the block preserved')
    : rep.bad(`d. surrounding content lost: ${cw}`);
  // ...and re-running keeps it byte-stable too.
  const cwSnapshot = read(wrapped);
  await injectMarkedBlock({ filePath: wrapped, body: 'fresh body' });
  read(wrapped) === cwSnapshot ? rep.ok('d2. wrapped file idempotent') : rep.bad('d2. wrapped not idempotent');

  // (e) existing file WITHOUT markers → appended, existing content kept.
  const plain = join(dir, 'plain.md');
  writeFileSync(plain, '# Existing\n\nimportant user notes\n', 'utf-8');
  const r3 = await injectMarkedBlock({ filePath: plain, body: 'appended body' });
  const cp = read(plain);
  r3.appended && cp.includes('important user notes') && cp.includes(START_MARKER) && cp.includes('appended body') && cp.indexOf('important user notes') < cp.indexOf(START_MARKER)
    ? rep.ok('e. markerless file appended without clobbering')
    : rep.bad(`e. append failed: ${JSON.stringify(r3)} / ${cp}`);
  // appending is idempotent once a block exists.
  const cpSnap = read(plain);
  await injectMarkedBlock({ filePath: plain, body: 'appended body' });
  read(plain) === cpSnap ? rep.ok('e2. post-append re-inject idempotent') : rep.bad('e2. append not idempotent');

  // (f) strip helper removes the block, preserves user content.
  const sres = await stripMarkedBlockFile(wrapped);
  const cs = existsSync(wrapped) ? read(wrapped) : '';
  sres.removed && !cs.includes(START_MARKER) && !cs.includes('fresh body') && cs.includes('# My Title') && cs.includes('user footer')
    ? rep.ok('f. strip removes block, keeps user content')
    : rep.bad(`f. strip failed: ${JSON.stringify(sres)} / ${cs}`);
  // pure string strip: block-only content → null (nothing user-owned).
  stripMarkedBlock(`${START_MARKER}\nonly ours\n${END_MARKER}\n`) === null
    ? rep.ok('f2. block-only content strips to null')
    : rep.bad('f2. block-only should strip to null');

  // (g) malformed markers do not throw (and are deterministic).
  try {
    const orphan = join(dir, 'orphan.md');
    // start WITHOUT end → treated as no valid block → append fresh.
    writeFileSync(orphan, `text\n${START_MARKER}\ndangling start\n`, 'utf-8');
    const rg = await injectMarkedBlock({ filePath: orphan, body: 'safe body' });
    // duplicate starts → strip must not throw.
    const dup = `${START_MARKER}\na\n${START_MARKER}\nb\n${END_MARKER}\n`;
    stripMarkedBlock(dup);
    // empty string strip → null, no throw.
    stripMarkedBlock('');
    rg.appended || rg.updated || rg.created
      ? rep.ok('g. malformed markers handled without throwing')
      : rep.bad(`g. unexpected malformed result: ${JSON.stringify(rg)}`);
  } catch (e) {
    rep.bad(`g. malformed markers threw: ${e.message}`);
  }
} finally {
  rmSync(dir, { recursive: true, force: true });
}

rep.finish('marker-inject (F4)');
