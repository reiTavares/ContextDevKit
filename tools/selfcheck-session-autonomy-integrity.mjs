/**
 * selfcheck-session-autonomy-integrity.mjs — wiring checks for the Session
 * Autonomy Receipt integrity + signing layer (spec §22).
 *
 * Exercises canonicalization determinism, hash stability, the Ed25519
 * sign→verify round-trip (with an in-MEMORY keypair generated only inside this
 * test — never written to disk), tamper detection, the hash-only fallback when
 * no key is configured, exclusion of the signature from the hashed payload, and
 * the guarantee that no private-key material leaks into the integrity block.
 *
 * Standalone: `node tools/selfcheck-session-autonomy-integrity.mjs`.
 */

import { generateKeyPairSync } from 'node:crypto';
import { pathToFileURL } from 'node:url';

const MODULE_REL = 'templates/contextkit/tools/scripts/economics/session-autonomy/receipt-integrity.mjs';

/** A representative receipt payload with nested objects + arrays. */
function samplePayload() {
  return {
    schema: 'cdk-autonomy-receipt/1',
    sessionId: 'abc-123',
    usage: { inputTokens: 100, outputTokens: 50, observedTokens: null },
    basis: ['project-map', 'qa-green'],
    autonomy: { multiplier: 1.4, gainPercent: 40 },
  };
}

/**
 * Runs the integrity checks against the provided ok/bad recorders.
 * @param {{ok:Function, bad:Function}} recorders
 * @param {{KIT:string}} ctx the kit root (where templates/ lives)
 * @returns {Promise<void>}
 */
export async function runSessionAutonomyIntegrityChecks({ ok, bad }, { KIT }) {
  const moduleUrl = pathToFileURL(`${KIT.replace(/\\/g, '/')}/${MODULE_REL}`).href;
  const integrity = await import(moduleUrl);
  const { canonicalize, hashPayload, resolveSigningKey, signReceipt, verifyReceipt } = integrity;

  // 1. Canonicalization is deterministic across shuffled key order.
  const ordered = { a: 1, b: { c: 2, d: [3, 1, 2] }, e: 'x' };
  const shuffled = { e: 'x', b: { d: [3, 1, 2], c: 2 }, a: 1 };
  if (canonicalize(ordered) === canonicalize(shuffled) && hashPayload(ordered) === hashPayload(shuffled)) {
    ok('integrity: canonicalization is order-independent (same hash for shuffled keys)');
  } else {
    bad('integrity: canonicalization NOT order-independent');
  }

  // 1b. Array order IS preserved (semantically significant).
  const arrA = hashPayload({ items: [1, 2, 3] });
  const arrB = hashPayload({ items: [3, 2, 1] });
  if (arrA !== arrB) ok('integrity: array order is preserved (distinct hashes)');
  else bad('integrity: array order incorrectly normalized');

  // 2. Hash is stable + correctly formatted.
  const h = hashPayload(samplePayload());
  if (/^sha256:[0-9a-f]{64}$/.test(h) && h === hashPayload(samplePayload())) {
    ok('integrity: payload hash is stable + sha256:<hex> formatted');
  } else {
    bad(`integrity: payload hash unstable or malformed (${h})`);
  }

  // Generate an in-MEMORY Ed25519 keypair — NEVER written to disk.
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const privateKeyPem = privateKey.export({ type: 'pkcs8', format: 'pem' });
  const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' });
  const key = resolveSigningKey(
    { economy: { sessionAutonomyReceipt: { signingKeyPem: privateKeyPem, signingKeyId: 'test-key' } } },
    {},
  );

  if (key.available && key.privateKeyPem && key.publicKeyId === 'test-key') {
    ok('integrity: resolveSigningKey reads an explicit inline PEM + records key id');
  } else {
    bad('integrity: resolveSigningKey did not resolve the configured inline key');
  }

  // 3. Sign → verify round-trips to 'signed'.
  const payload = samplePayload();
  const signedBlock = signReceipt(payload, key);
  const signedReceipt = { ...payload, integrity: signedBlock };
  const verdictSigned = verifyReceipt(signedReceipt, { publicKeyPem });
  if (signedBlock.status === 'signed' && verdictSigned.status === 'signed' && verdictSigned.signatureOk === true) {
    ok('integrity: Ed25519 sign → verify round-trips to "signed"');
  } else {
    bad(`integrity: sign/verify round-trip failed (block=${signedBlock.status} verdict=${verdictSigned.status})`);
  }

  // 4. A modified payload verifies 'invalid'.
  const tampered = { ...signedReceipt, sessionId: 'TAMPERED', integrity: signedBlock };
  const verdictTampered = verifyReceipt(tampered, { publicKeyPem });
  if (verdictTampered.status === 'invalid' && verdictTampered.hashOk === false) {
    ok('integrity: tampered payload verifies "invalid"');
  } else {
    bad(`integrity: tampered payload not detected (status=${verdictTampered.status})`);
  }

  // 4b. A forged signature (valid hash, wrong key) verifies 'invalid'.
  const { publicKey: otherPub } = generateKeyPairSync('ed25519');
  const otherPubPem = otherPub.export({ type: 'spki', format: 'pem' });
  const verdictWrongKey = verifyReceipt(signedReceipt, { publicKeyPem: otherPubPem });
  if (verdictWrongKey.status === 'invalid' && verdictWrongKey.signatureOk === false) {
    ok('integrity: signature checked against the wrong key verifies "invalid"');
  } else {
    bad(`integrity: wrong-key signature not rejected (status=${verdictWrongKey.status})`);
  }

  // 5. Missing key → 'hash-only'.
  const noKey = resolveSigningKey({}, {});
  const hashOnlyBlock = signReceipt(payload, noKey);
  const isHashOnly =
    noKey.available === false &&
    hashOnlyBlock.status === 'hash-only' &&
    hashOnlyBlock.signature === null &&
    hashOnlyBlock.signatureAlgorithm === null &&
    hashOnlyBlock.publicKeyId === null &&
    typeof hashOnlyBlock.payloadHash === 'string';
  if (isHashOnly) ok('integrity: no configured key → "hash-only" (payloadHash set, signature null)');
  else bad('integrity: missing key did not degrade to hash-only safely');

  // 5b. resolveSigningKey NEVER auto-generates a key.
  if (noKey.privateKeyPem === undefined) ok('integrity: resolveSigningKey never fabricates a private key');
  else bad('integrity: resolveSigningKey leaked/generated a private key when none configured');

  // 6. Signature is excluded from the hashed payload (re-hash matches).
  const reHash = hashPayload(signedReceipt); // includes integrity block on input
  if (reHash === signedBlock.payloadHash) {
    ok('integrity: signature + integrity block are excluded from the hashed payload');
  } else {
    bad('integrity: integrity block leaked into the canonical hash');
  }

  // 6b. canonicalize drops the integrity field entirely.
  if (!canonicalize(signedReceipt).includes('"integrity"') && !canonicalize(signedReceipt).includes('"signature"')) {
    ok('integrity: canonical form contains no integrity/signature fields');
  } else {
    bad('integrity: canonical form still contains integrity/signature fields');
  }

  // 7. No private-key string appears anywhere in the produced integrity block.
  const blockJson = JSON.stringify(signedBlock);
  const leaks =
    blockJson.includes('PRIVATE KEY') ||
    blockJson.includes(privateKeyPem.trim().slice(0, 40)) ||
    Object.prototype.hasOwnProperty.call(signedBlock, 'privateKeyPem');
  if (!leaks) ok('integrity: no private-key material appears in the integrity block');
  else bad('integrity: private-key material leaked into the integrity block');

  // 8. Produced blocks are frozen (tamper-resistant in memory).
  if (Object.isFrozen(signedBlock) && Object.isFrozen(hashOnlyBlock) && Object.isFrozen(verdictSigned)) {
    ok('integrity: integrity blocks + verdicts are frozen');
  } else {
    bad('integrity: integrity blocks/verdicts are not frozen');
  }
}

// ── Standalone runner ─────────────────────────────────────────────────────────
if (process.argv[1] && process.argv[1].endsWith('selfcheck-session-autonomy-integrity.mjs')) {
  const KIT = process.cwd();
  let failures = 0;
  const ok = (msg) => console.log(`  ok  ${msg}`);
  const bad = (msg) => {
    failures += 1;
    console.error(`  BAD ${msg}`);
  };
  runSessionAutonomyIntegrityChecks({ ok, bad }, { KIT })
    .then(() => {
      console.log(failures ? `\n${failures} check(s) FAILED` : '\nall integrity checks passed');
      process.exit(failures ? 1 : 0);
    })
    .catch((err) => {
      console.error(`  BAD runner threw: ${err && err.message}`);
      process.exit(1);
    });
}
