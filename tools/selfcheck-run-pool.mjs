#!/usr/bin/env node
/**
 * Self-test for the run-suites execution strategies (TEA-008 / ADR-0114) —
 * STANDALONE entrypoint (exit 0/1).
 *
 * WHY: the bounded-concurrency pool is the risk surface of parallelism — it must
 * (a) never run more than `jobs` workers at once, (b) run every item exactly once
 * in input-order results, and (c) soft-cancel (start no NEW work after a failure
 * flag, letting in-flight drain). `shuffle` must be a true permutation (no lost or
 * duplicated suite) or the isolation proof would silently skip suites. Hermetic:
 * fake workers plus short child fixtures under a disposable temp directory.
 * Zero-dep, node:* only.
 */
import { shuffle, runPool } from './run-suites-pool.mjs';
import { runSuite } from './run-suites.mjs';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let failures = 0;
const ok = (msg) => console.log(`  ✓ ${msg}`);
const bad = (msg) => {
  console.error(`  ✗ ${msg}`);
  failures += 1;
};

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/** shuffle is a permutation: same multiset, deterministic under a seeded rng. */
function shuffleIsPermutation() {
  const input = Array.from({ length: 50 }, (_, i) => i);
  const out = shuffle(input);
  const sameSet = [...out].sort((a, b) => a - b).join(',') === input.join(',');
  sameSet ? ok('shuffle preserves the exact element set (no loss/dup)') : bad('shuffle lost or duplicated elements');
  out.length === input.length ? ok('shuffle preserves length') : bad(`shuffle length ${out.length} != ${input.length}`);
  // Seeded rng → deterministic order (reproducible proof).
  const seq = [0.9, 0.1, 0.5, 0.3, 0.7];
  let k = 0;
  const rng = () => seq[k++ % seq.length];
  const a = shuffle([1, 2, 3, 4, 5], rng); k = 0;
  const b = shuffle([1, 2, 3, 4, 5], rng);
  a.join(',') === b.join(',') ? ok('shuffle is deterministic under a seeded rng') : bad('seeded shuffle not reproducible');
  // Non-mutating.
  shuffle(input);
  input[0] === 0 && input[49] === 49 ? ok('shuffle does not mutate its input') : bad('shuffle mutated input');
}

/** runPool: every item runs once, results in input order, concurrency ≤ jobs. */
async function poolRunsAllBounded() {
  const items = Array.from({ length: 20 }, (_, i) => i);
  let active = 0;
  let maxActive = 0;
  const seen = new Set();
  const worker = async (item) => {
    active += 1; maxActive = Math.max(maxActive, active);
    await wait(2);
    active -= 1; seen.add(item);
    return item * 10;
  };
  const results = await runPool(items, 4, worker);
  seen.size === 20 ? ok('runPool ran every item exactly once') : bad(`runPool ran ${seen.size}/20 items`);
  results.length === 20 && results[5] === 50 && results[19] === 190
    ? ok('runPool returns results in INPUT order') : bad(`runPool result order wrong: [${results.slice(0, 3)}...]`);
  maxActive <= 4 ? ok(`runPool honored the concurrency cap (maxActive=${maxActive} ≤ 4)`) : bad(`runPool exceeded cap: maxActive=${maxActive}`);
}

/** runPool soft-cancel: once shouldStop flips, no NEW item starts. */
async function poolSoftCancel() {
  const items = Array.from({ length: 30 }, (_, i) => i);
  let started = 0;
  let stop = false;
  const worker = async (item) => {
    started += 1;
    await wait(1);
    if (item === 2) stop = true; // simulate a failure mid-flight
    return item;
  };
  await runPool(items, 2, worker, undefined, () => stop);
  started < 30 ? ok(`runPool soft-cancel stopped early (started ${started}/30, no new work after stop)`) : bad('runPool ignored shouldStop (ran all 30)');
}

/**
 * Prove the serial runner emits heartbeats, bounds hangs, and preserves failures.
 * @returns {Promise<void>}
 */
async function runnerTimeoutAndFailure() {
  const fixture = mkdtempSync(join(tmpdir(), 'ctxkit runner '));
  try {
    writeFileSync(join(fixture, 'hang.mjs'), 'setInterval(() => {}, 1000);\n');
    writeFileSync(join(fixture, 'fail.mjs'), "process.stderr.write('focused failure\\n'); process.exit(7);\n");
    let heartbeats = 0;
    const timed = await runSuite(
      { id: 'hang-fixture', file: 'hang.mjs', tier: 'smoke' },
      { kitRoot: fixture, timeoutMs: 120, heartbeatMs: 25, onHeartbeat: () => { heartbeats += 1; } },
    );
    timed.exitCode === 124 && timed.timedOut === true
      ? ok('runSuite terminates a hung suite with timeout exit 124')
      : bad(`runSuite timeout record mismatch: ${JSON.stringify(timed)}`);
    heartbeats >= 1
      ? ok(`runSuite emitted incremental heartbeat(s) before timeout (${heartbeats})`)
      : bad('runSuite emitted no heartbeat before timeout');

    const failed = await runSuite(
      { id: 'failure-fixture', file: 'fail.mjs', tier: 'smoke' },
      { kitRoot: fixture, timeoutMs: 2_000, heartbeatMs: 500, onHeartbeat: () => {} },
    );
    failed.exitCode === 7 && failed.stderr.includes('focused failure') && failed.timedOut === false
      ? ok('runSuite preserves a real failure code and captured diagnostic')
      : bad(`runSuite failure record mismatch: ${JSON.stringify(failed)}`);
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
}

async function main() {
  console.log('\n🌀 ContextDevKit run-suites pool self-test\n');
  shuffleIsPermutation();
  await poolRunsAllBounded();
  await poolSoftCancel();
  await runnerTimeoutAndFailure();
  console.log(failures === 0 ? '\n✅ pool self-test passed.\n' : `\n❌ ${failures} check(s) failed.\n`);
  process.exit(failures === 0 ? 0 : 1);
}

main();
