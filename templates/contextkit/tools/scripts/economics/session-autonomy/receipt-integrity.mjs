/**
 * receipt-integrity.mjs — Session Autonomy Receipt: integrity + signing (spec §22).
 *
 * Hashes and (optionally) signs a receipt payload so a stored receipt can be
 * tamper-evidenced later. Pure, deterministic, zero third-party deps — only
 * `node:crypto`. No Date.now()/Math.random()/new Date() anywhere on this path.
 *
 * ── Security guarantees ───────────────────────────────────────────────────────
 *  • The signature and payloadHash are NEVER part of the hashed payload. The
 *    canonical form excludes the entire top-level `integrity` block (and, for a
 *    flat object, the `signature`/`payloadHash` keys), so signing/verifying a
 *    receipt that already carries an integrity block reproduces the same hash.
 *  • Hashing is deterministic: object keys are recursively sorted, arrays keep
 *    their order. The same logical payload always yields the same hash string.
 *  • Crypto is vetted: SHA-256 for the payload hash, Ed25519 for signatures, both
 *    from `node:crypto`. No hand-rolled primitives.
 *  • Fail-open by design (invariant: hooks/receipts never break real work): with
 *    no configured signing key, or on ANY signing error, the integrity block
 *    degrades to `hash-only` — it never throws to the caller and never auto-
 *    generates a private key.
 *  • Private-key material stays local to the signing function's scope. It is
 *    never placed in a returned object, a receipt, a log line, or an error
 *    message. `resolveSigningKey` returns the PEM only so `signReceipt` can
 *    consume it directly; that object must never be serialized into a receipt.
 *
 * ── Where the signing key comes from (explicit, opt-in only) ──────────────────
 *  Resolution order (first hit wins); absence ⇒ { available:false } ⇒ hash-only:
 *   1. config.economy.sessionAutonomyReceipt.signingKeyPem   (inline PEM)
 *   2. config.economy.sessionAutonomyReceipt.signingKeyPath   (file path)
 *   3. env.CONTEXTKIT_RECEIPT_SIGNING_KEY                      (inline PEM)
 *   4. env.CONTEXTKIT_RECEIPT_SIGNING_KEY_PATH                (file path)
 *  The public key id (config/env `signingKeyId`, else a non-secret fingerprint)
 *  is recorded on the receipt; the private key never is. A private key is NEVER
 *  generated here and NEVER written to a version-controlled path.
 */

import {
  createHash,
  createPrivateKey,
  createPublicKey,
  sign as edSign,
  verify as edVerify,
} from 'node:crypto';
import { readFileSync } from 'node:fs';

import { INTEGRITY_STATES } from './receipt-schema.mjs';

/** Top-level keys excluded from the canonical hashed form (spec §22). */
const EXCLUDED_KEYS = Object.freeze(['integrity', 'signature', 'payloadHash']);

/** Signature algorithm label recorded on signed receipts. */
const SIGNATURE_ALGORITHM = 'ed25519';

/** Frozen integrity states (defensive — `invalid` must be a known state). */
const STATES = new Set(INTEGRITY_STATES);

/**
 * Recursively rebuilds a value with object keys sorted; arrays keep their order.
 * Used to make JSON serialization order-independent for hashing.
 * @param {*} value any JSON-serializable value
 * @returns {*} a structurally-equal value with sorted object keys
 */
function sortDeep(value) {
  if (Array.isArray(value)) return value.map(sortDeep);
  if (value && typeof value === 'object') {
    const sorted = {};
    for (const key of Object.keys(value).sort()) sorted[key] = sortDeep(value[key]);
    return sorted;
  }
  return value;
}

/**
 * Produces a canonical JSON string for a receipt payload: recursively sorted
 * object keys, arrays in order, with the integrity/signature/hash fields removed
 * so the signature is never part of what gets hashed.
 * @param {object} payload the receipt payload (with or without an integrity block)
 * @returns {string} deterministic JSON string
 */
export function canonicalize(payload) {
  const base = payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : {};
  const stripped = {};
  for (const key of Object.keys(base)) {
    if (EXCLUDED_KEYS.includes(key)) continue;
    stripped[key] = base[key];
  }
  return JSON.stringify(sortDeep(stripped));
}

/**
 * Computes the SHA-256 hash of a payload's canonical form.
 * @param {object} payload the receipt payload
 * @returns {string} 'sha256:<hex>'
 */
export function hashPayload(payload) {
  const digest = createHash('sha256').update(canonicalize(payload), 'utf8').digest('hex');
  return `sha256:${digest}`;
}

/** Reads a PEM from disk, returning null on any I/O error (fail-open). */
function readPemFile(filePath) {
  try {
    const pem = readFileSync(filePath, 'utf8');
    return typeof pem === 'string' && pem.includes('PRIVATE KEY') ? pem : null;
  } catch {
    return null;
  }
}

/**
 * Resolves a signing key from explicit config or env ONLY. Never generates a
 * key. The returned `privateKeyPem` (when present) must be consumed by
 * `signReceipt` and never serialized into a receipt.
 * @param {object} [config] the resolved ContextDevKit config
 * @param {object} [env=process.env] the environment
 * @returns {{available:boolean, privateKeyPem?:string, publicKeyId?:string}}
 */
export function resolveSigningKey(config, env = process.env) {
  const scoped = config?.economy?.sessionAutonomyReceipt ?? {};
  const safeEnv = env ?? {};
  const inlinePem = scoped.signingKeyPem ?? safeEnv.CONTEXTKIT_RECEIPT_SIGNING_KEY ?? null;
  const keyPath = scoped.signingKeyPath ?? safeEnv.CONTEXTKIT_RECEIPT_SIGNING_KEY_PATH ?? null;
  const privateKeyPem = inlinePem || (keyPath ? readPemFile(keyPath) : null);
  if (!privateKeyPem) return Object.freeze({ available: false });
  const configuredId = scoped.signingKeyId ?? safeEnv.CONTEXTKIT_RECEIPT_SIGNING_KEY_ID ?? null;
  const publicKeyId = configuredId || fingerprintPublicKey(privateKeyPem) || 'unknown';
  return Object.freeze({ available: true, privateKeyPem, publicKeyId });
}

/**
 * Derives a NON-SECRET public-key fingerprint (SHA-256 of the DER public key,
 * first 16 hex chars). Returns null if the PEM cannot be parsed.
 * @param {string} privateKeyPem
 * @returns {string|null}
 */
function fingerprintPublicKey(privateKeyPem) {
  try {
    const publicDer = createPublicKey(createPrivateKey(privateKeyPem)).export({
      type: 'spki',
      format: 'der',
    });
    const hex = createHash('sha256').update(publicDer).digest('hex');
    return `ed25519:${hex.slice(0, 16)}`;
  } catch {
    return null;
  }
}

/**
 * Builds the integrity block for a payload. Signs with Ed25519 when a valid key
 * is available; otherwise (or on ANY error) returns a `hash-only` block. Never
 * throws, never leaks private-key material.
 * @param {object} payload the receipt payload to be hashed (and maybe signed)
 * @param {{available:boolean, privateKeyPem?:string, publicKeyId?:string}} [key]
 * @returns {Readonly<object>} frozen integrity block (no private key inside)
 */
export function signReceipt(payload, key) {
  const payloadHash = hashPayload(payload);
  const hashOnly = Object.freeze({
    status: 'hash-only',
    payloadHash,
    signatureAlgorithm: null,
    signature: null,
    publicKeyId: null,
  });
  if (!key || !key.available || !key.privateKeyPem) return hashOnly;
  try {
    const privateKeyObject = createPrivateKey(key.privateKeyPem);
    const signature = edSign(null, Buffer.from(payloadHash, 'utf8'), privateKeyObject);
    return Object.freeze({
      status: 'signed',
      payloadHash,
      signatureAlgorithm: SIGNATURE_ALGORITHM,
      signature: signature.toString('base64'),
      publicKeyId: key.publicKeyId ?? null,
    });
  } catch {
    return hashOnly; // fail-open: refuse-to-hash-only, never refuse-to-false-pass
  }
}

/**
 * Resolves the integrity block carried on a receipt, tolerating both a top-level
 * `integrity` object and a flat receipt.
 * @param {object} receipt
 * @returns {object} the integrity-bearing object (possibly the receipt itself)
 */
function readIntegrity(receipt) {
  if (receipt && typeof receipt.integrity === 'object' && receipt.integrity) return receipt.integrity;
  return receipt ?? {};
}

/**
 * Verifies a stored receipt: recomputes the payload hash over the receipt minus
 * its integrity block, compares, and (when a signature + public key are present)
 * verifies the Ed25519 signature. Pure; never throws.
 * @param {object} receipt a receipt carrying an integrity block
 * @param {{publicKeyPem?:string}} [trust] optional verifying public key (PEM)
 * @returns {{status:string, hashOk:boolean, signatureOk:(boolean|null), reason?:string}}
 */
export function verifyReceipt(receipt, trust = {}) {
  const integrity = readIntegrity(receipt);
  const expectedHash = hashPayload(receipt);
  const hashOk = typeof integrity.payloadHash === 'string' && integrity.payloadHash === expectedHash;
  if (!hashOk) {
    return Object.freeze({ status: 'invalid', hashOk: false, signatureOk: null, reason: 'hash-mismatch' });
  }
  const hasSignature = typeof integrity.signature === 'string' && integrity.signature.length > 0;
  if (!hasSignature) {
    return Object.freeze({ status: 'hash-only', hashOk: true, signatureOk: null });
  }
  const signatureOk = verifyEd25519(integrity, expectedHash, trust.publicKeyPem);
  if (signatureOk === null) {
    // Signature present but no public key to check it against — hash is intact.
    return Object.freeze({ status: 'hash-only', hashOk: true, signatureOk: null, reason: 'no-public-key' });
  }
  if (!signatureOk) {
    return Object.freeze({ status: 'invalid', hashOk: true, signatureOk: false, reason: 'signature-failed' });
  }
  return Object.freeze({ status: 'signed', hashOk: true, signatureOk: true });
}

/**
 * Verifies the Ed25519 signature over the payloadHash string.
 * @param {object} integrity integrity block with `signature` (base64)
 * @param {string} payloadHash the 'sha256:<hex>' string that was signed
 * @param {string} [publicKeyPem] a PEM public key to verify against
 * @returns {boolean|null} null when no public key is available to verify with
 */
function verifyEd25519(integrity, payloadHash, publicKeyPem) {
  if (!publicKeyPem || typeof publicKeyPem !== 'string') return null;
  try {
    const publicKeyObject = createPublicKey(publicKeyPem);
    return edVerify(
      null,
      Buffer.from(payloadHash, 'utf8'),
      publicKeyObject,
      Buffer.from(integrity.signature, 'base64'),
    );
  } catch {
    return false;
  }
}

/** Closed set of valid integrity statuses, re-exported for consumers. */
export const ALLOWED_INTEGRITY_STATES = INTEGRITY_STATES;
export { STATES as INTEGRITY_STATE_SET };
