/**
 * Media-provider adapter contract — ADR-0024.
 *
 * Each `*.mjs` file in this directory (except this one) is a concrete
 * adapter for image or video generation. The kit ships two seeds:
 *   - nano-banana.mjs  (image — Google AI Studio / Imagen)
 *   - veo.mjs          (video — Google AI Studio / Veo)
 *
 * Adapter shape (all required):
 *
 *   export const id = 'nano-banana' | 'veo';
 *   export const kind = 'image' | 'video';
 *   export const envVar = 'GOOGLE_AI_API_KEY';
 *   export const requiredEnv = ['GOOGLE_AI_API_KEY'];
 *   export async function generate({ prompt, options, outPath }) { ... }
 *
 * Five contract points (ADR-0024):
 *   1. No SDK dependency. Adapters use `node:fetch` against the REST
 *      endpoint.
 *   2. Refuse-on-missing-creds — `generate()` checks `requiredEnv` first
 *      and throws MediaProviderError('NO_CREDENTIALS', ...) before any
 *      network call.
 *   3. `generate()` returns
 *      `{ outPath, durationMs, costEstimateUsd, providerRequestId }`.
 *   4. Refuse-on-content-policy. Google's API rejects some prompts;
 *      the adapter throws MediaProviderError('CONTENT_POLICY', ...).
 *   5. Cost-cap guard — process-level tally via VIBEDEVKIT_MEDIA_MAX_USD.
 */

/** Stable error codes thrown by adapters. Kept narrow on purpose. */
export const MEDIA_ERROR_CODES = Object.freeze({
  NO_CREDENTIALS:   'NO_CREDENTIALS',
  CONTENT_POLICY:   'CONTENT_POLICY',
  COST_CAP_REACHED: 'COST_CAP_REACHED',
  RATE_LIMIT:       'RATE_LIMIT',
  PROVIDER_ERROR:   'PROVIDER_ERROR',
  BAD_INPUT:        'BAD_INPUT',
  IO:               'IO',
});

export class MediaProviderError extends Error {
  constructor(code, message, { providerRequestId } = {}) {
    super(message);
    this.name = 'MediaProviderError';
    this.code = code;
    if (providerRequestId) this.providerRequestId = providerRequestId;
  }
}

/**
 * Validate the shape of a media adapter module.
 *
 * @param {object} mod
 * @returns {{ ok: true } | { ok: false, reasons: string[] }}
 */
export function validateAdapter(mod) {
  const reasons = [];
  if (typeof mod.id !== 'string' || mod.id.length === 0) reasons.push('missing `id` export');
  if (mod.kind !== 'image' && mod.kind !== 'video') reasons.push('`kind` must be "image" or "video"');
  if (typeof mod.envVar !== 'string' || mod.envVar.length === 0) reasons.push('missing `envVar` export');
  if (!Array.isArray(mod.requiredEnv) || mod.requiredEnv.length === 0) reasons.push('`requiredEnv` must be a non-empty array');
  if (typeof mod.generate !== 'function') reasons.push('missing `generate(input)` export');
  return reasons.length ? { ok: false, reasons } : { ok: true };
}

/* ──────────────────────────────────────────────────────────────────────── */
/* Cost-cap guard — single shared tally for the lifetime of the process.    */
/* Adapters call `noteCostOrThrow(estimate)` BEFORE making the network call.*/
/* ──────────────────────────────────────────────────────────────────────── */

let _runningCostUsd = 0;

/** Reads the per-process USD cap from VIBEDEVKIT_MEDIA_MAX_USD; null = no cap. */
export function readCostCapUsd() {
  const raw = process.env.VIBEDEVKIT_MEDIA_MAX_USD;
  if (!raw) return null;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * Throws MediaProviderError('COST_CAP_REACHED') if adding `estimateUsd` to
 * the running tally would exceed the cap. Otherwise adds and returns the
 * new running total.
 *
 * @param {number} estimateUsd
 * @returns {number}  new running total
 */
export function noteCostOrThrow(estimateUsd) {
  const cap = readCostCapUsd();
  const next = _runningCostUsd + Math.max(0, estimateUsd);
  if (cap !== null && next > cap) {
    throw new MediaProviderError(
      MEDIA_ERROR_CODES.COST_CAP_REACHED,
      `cost cap reached: this call (~$${estimateUsd.toFixed(2)}) + running ($${_runningCostUsd.toFixed(2)}) would exceed VIBEDEVKIT_MEDIA_MAX_USD ($${cap.toFixed(2)})`,
    );
  }
  _runningCostUsd = next;
  return _runningCostUsd;
}

/** Test hook — resets the cost tally. NOT exposed to adapters. */
export function _resetCostTallyForTests() { _runningCostUsd = 0; }

/**
 * Asserts every required env var is present; throws NO_CREDENTIALS otherwise.
 * Adapters call this first thing in `generate()` (rule 8 — default-refuse).
 *
 * @param {string[]} requiredEnv
 * @param {string}   templatePath  hint for the error message
 */
export function assertCredentials(requiredEnv, templatePath = 'vibekit/.env.example') {
  const missing = requiredEnv.filter((name) => !process.env[name]);
  if (missing.length) {
    throw new MediaProviderError(
      MEDIA_ERROR_CODES.NO_CREDENTIALS,
      `missing env var(s): ${missing.join(', ')}. See ${templatePath} for the template and set them (e.g. run with \`node --env-file=vibekit/.env ...\` on Node 20.6+).`,
    );
  }
}
