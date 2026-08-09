#!/usr/bin/env node
/**
 * CDK-062 self-check — normalize.mjs dispatch registry (PKG-06, multi-host telemetry).
 *
 * Verifies five invariants:
 *   (a) registeredHosts() includes both 'claude-code' and 'codex'.
 *   (b) adapterFor() returns a non-null module for each registered host
 *       and null for an unknown host key.
 *   (c) normalize() produces a valid UsageEvent (with closing buckets) when
 *       fed a minimal claude-code transcript entry with usage data.
 *   (d) normalize() returns null for a usage-less claude-code entry.
 *   (e) normalize() returns null for an entry with an unregistered host.
 *
 * Standalone runnable: node tools/selfcheck-pkg06-062.mjs
 * Exit 0 on all-pass, exit 1 on any failure.
 * Hermetic — reads no installed config, no filesystem side-effects.
 */
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Absolute URL for the dispatch registry under test. */
const NORMALIZE_URL = pathToFileURL(
  resolve(__dirname, '../templates/contextkit/tools/scripts/telemetry/normalize.mjs'),
).href;

/** Absolute URL for the EACP bucket helper (used to verify invariant). */
const BUCKETS_URL = pathToFileURL(
  resolve(__dirname, '../templates/contextkit/tools/scripts/economics/usage-buckets.mjs'),
).href;

let failures = 0;
const ok  = (msg) => console.log(`  ✓ ${msg}`);
const bad = (msg) => { console.error(`  ✗ ${msg}`); failures += 1; };

// ---------------------------------------------------------------------------
// Import modules under test
// ---------------------------------------------------------------------------
let adapterFor, registeredHosts, normalize;
try {
  ({ adapterFor, registeredHosts, normalize } = await import(NORMALIZE_URL));
} catch (err) {
  console.error(`FATAL: cannot import normalize.mjs: ${err?.message ?? err}`);
  process.exit(1);
}

let bucketsClose;
try {
  ({ bucketsClose } = await import(BUCKETS_URL));
} catch (err) {
  console.error(`FATAL: cannot import usage-buckets.mjs: ${err?.message ?? err}`);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// (a) registeredHosts() contains both expected hosts
// ---------------------------------------------------------------------------
console.log('\n(a) registeredHosts() inventory\n');

const hosts = registeredHosts();
Array.isArray(hosts)
  ? ok(`registeredHosts() returns an array (${hosts.length} hosts)`)
  : bad('registeredHosts() did not return an array');

hosts.includes('claude-code')
  ? ok("registered hosts include 'claude-code'")
  : bad("'claude-code' missing from registeredHosts()");

hosts.includes('codex')
  ? ok("registered hosts include 'codex'")
  : bad("'codex' missing from registeredHosts()");

// ---------------------------------------------------------------------------
// (b) adapterFor() lookup — known and unknown hosts
// ---------------------------------------------------------------------------
console.log('\n(b) adapterFor() — known and unknown host lookup\n');

const ccAdapter = adapterFor('claude-code');
ccAdapter !== null && ccAdapter !== undefined
  ? ok("adapterFor('claude-code') is non-null")
  : bad("adapterFor('claude-code') returned null — adapter not wired");

typeof ccAdapter?.adapt === 'function'
  ? ok("claude-code adapter exposes adapt() function")
  : bad("claude-code adapter is missing adapt()");

typeof ccAdapter?.declares === 'function'
  ? ok("claude-code adapter exposes declares() function")
  : bad("claude-code adapter is missing declares()");

const codexAdapter = adapterFor('codex');
codexAdapter !== null && codexAdapter !== undefined
  ? ok("adapterFor('codex') is non-null")
  : bad("adapterFor('codex') returned null — adapter not wired");

typeof codexAdapter?.adapt === 'function'
  ? ok("codex adapter exposes adapt() function")
  : bad("codex adapter is missing adapt()");

typeof codexAdapter?.declares === 'function'
  ? ok("codex adapter exposes declares() function")
  : bad("codex adapter is missing declares()");

const bogusAdapter = adapterFor('bogus-host-that-does-not-exist');
bogusAdapter === null
  ? ok("adapterFor('bogus-host-that-does-not-exist') = null  (unknown host)")
  : bad("adapterFor('bogus') should return null for unknown host");

// Also cover the non-string guard
adapterFor(null) === null
  ? ok("adapterFor(null) = null  (type guard)")
  : bad("adapterFor(null) should return null");

// ---------------------------------------------------------------------------
// (c) normalize() with a valid claude-code usage entry → UsageEvent
// ---------------------------------------------------------------------------
console.log('\n(c) normalize() produces a valid UsageEvent for a claude-code entry\n');

const minimalClaudeEntry = {
  host:      'claude-code',
  sessionId: 'test-session-001',
  message: {
    usage: {
      input_tokens:                10,
      output_tokens:               5,
      cache_read_input_tokens:     2,
      cache_creation_input_tokens: 1,
    },
    model: 'claude-sonnet-4-5',
  },
  timestamp: 1700000000000,
};

let event;
try {
  event = normalize(minimalClaudeEntry);
} catch (err) {
  bad(`normalize() threw instead of returning: ${err?.message ?? err}`);
  event = null;
}

event !== null
  ? ok('normalize() returned a non-null event for a claude-code usage entry')
  : bad('normalize() returned null for a valid claude-code entry');

if (event !== null) {
  event.schemaVersion
    ? ok(`event has schemaVersion: '${event.schemaVersion}'`)
    : bad('event is missing schemaVersion');

  event.host === 'claude-code'
    ? ok("event.host === 'claude-code'")
    : bad(`event.host should be 'claude-code', got '${event.host}'`);

  event.sessionId === 'test-session-001'
    ? ok("event.sessionId matches input")
    : bad(`event.sessionId should be 'test-session-001', got '${event.sessionId}'`);

  // Bucket values should reflect the mapped input
  const b = event.buckets;
  b?.freshInput === 10
    ? ok('event.buckets.freshInput === 10  (mapped from input_tokens)')
    : bad(`event.buckets.freshInput should be 10, got ${b?.freshInput}`);
  b?.output === 5
    ? ok('event.buckets.output === 5  (mapped from output_tokens)')
    : bad(`event.buckets.output should be 5, got ${b?.output}`);
  b?.cacheRead === 2
    ? ok('event.buckets.cacheRead === 2  (mapped from cache_read_input_tokens)')
    : bad(`event.buckets.cacheRead should be 2, got ${b?.cacheRead}`);
  b?.cacheWrite === 1
    ? ok('event.buckets.cacheWrite === 1  (mapped from cache_creation_input_tokens)')
    : bad(`event.buckets.cacheWrite should be 1, got ${b?.cacheWrite}`);

  // The key invariant: total === sum of all buckets
  bucketsClose(event)
    ? ok(`bucketsClose(event) = true  (total ${event.total} === sum of buckets — invariant holds)`)
    : bad(`bucketsClose(event) = false — total ${event.total} does not match bucket sum`);

  event.source?.adapter === 'claude-code'
    ? ok("event.source.adapter === 'claude-code'  (lineage traceable)")
    : bad(`event.source.adapter should be 'claude-code', got '${event.source?.adapter}'`);
}

// ---------------------------------------------------------------------------
// (d) normalize() returns null for a usage-less entry
// ---------------------------------------------------------------------------
console.log('\n(d) normalize() returns null for a usage-less claude-code entry\n');

const usagelessEntry = {
  host:      'claude-code',
  sessionId: 'test-session-002',
  message:   { role: 'human', content: 'Hello' }, // no usage field
};

let nullResult;
try {
  nullResult = normalize(usagelessEntry);
} catch (err) {
  bad(`normalize() threw on usage-less entry: ${err?.message ?? err}`);
  nullResult = 'threw';
}

nullResult === null
  ? ok('normalize() returned null for a usage-less claude-code entry  (fail-open)')
  : bad(`normalize() should return null for usage-less entry, got: ${JSON.stringify(nullResult)}`);

// ---------------------------------------------------------------------------
// (e) normalize() returns null for an unregistered host
// ---------------------------------------------------------------------------
console.log('\n(e) normalize() returns null for an unregistered host\n');

let unknownHostResult;
try {
  unknownHostResult = normalize({ host: 'vscode', message: { usage: { input_tokens: 5, output_tokens: 3 } } });
} catch (err) {
  bad(`normalize() threw for unknown host: ${err?.message ?? err}`);
  unknownHostResult = 'threw';
}

unknownHostResult === null
  ? ok("normalize({ host: 'vscode', ... }) = null  (unregistered host, fail-open)")
  : bad(`normalize() should return null for unknown host, got: ${JSON.stringify(unknownHostResult)}`);

// Guard: null rawEntry
normalize(null) === null
  ? ok('normalize(null) = null  (null guard)')
  : bad('normalize(null) should return null');

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------
console.log(
  failures === 0
    ? '\n  PASS — CDK-062 normalize.mjs self-check: all checks passed.\n'
    : `\n  FAIL — CDK-062 normalize.mjs self-check: ${failures} check(s) failed.\n`,
);
process.exit(failures === 0 ? 0 : 1);
