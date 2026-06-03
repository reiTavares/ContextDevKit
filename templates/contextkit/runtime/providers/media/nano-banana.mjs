/**
 * Nano Banana — image generation via Google AI Studio's Imagen API
 * (ADR-0024).
 *
 * Authentication: a single API key in `GOOGLE_AI_API_KEY` (get one at
 * https://aistudio.google.com/apikey). The adapter shells out to
 * `node:fetch` — no Google SDK.
 *
 * Pricing (dated 2026-06-02 — verify at https://ai.google.dev/pricing):
 *   Imagen 3 fast:     ~$0.020 per image
 *   Imagen 3 standard: ~$0.040 per image
 *   The adapter charges the standard floor; the real bill is on Google.
 *
 * Model id is configurable via `options.model`; default is the most
 * capable image model at write time.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import {
  MediaProviderError, MEDIA_ERROR_CODES,
  assertCredentials, noteCostOrThrow,
} from './_adapter.mjs';

export const id = 'nano-banana';
export const kind = 'image';
export const envVar = 'GOOGLE_AI_API_KEY';
export const requiredEnv = ['GOOGLE_AI_API_KEY'];

const DEFAULT_MODEL = 'imagen-3.0-generate-002';
const COST_ESTIMATE_USD = 0.04;
const ENDPOINT = (model) => `https://generativelanguage.googleapis.com/v1beta/models/${model}:predict`;

/**
 * Generate an image and write it to disk.
 *
 * @param {object} input
 * @param {string} input.prompt           required
 * @param {string} input.outPath          required — absolute or cwd-relative
 * @param {object} [input.options]
 * @param {string} [input.options.model]          default DEFAULT_MODEL
 * @param {string} [input.options.aspectRatio]    "1:1" | "16:9" | "9:16" | "3:4" | "4:3"
 * @param {number} [input.options.sampleCount]    1..4 — only the first is written
 * @returns {Promise<{ outPath, durationMs, costEstimateUsd, providerRequestId }>}
 */
export async function generate({ prompt, outPath, options = {} }) {
  if (!prompt || typeof prompt !== 'string') {
    throw new MediaProviderError(MEDIA_ERROR_CODES.BAD_INPUT, 'generate(): `prompt` is required');
  }
  if (!outPath || typeof outPath !== 'string') {
    throw new MediaProviderError(MEDIA_ERROR_CODES.BAD_INPUT, 'generate(): `outPath` is required');
  }
  assertCredentials(requiredEnv);
  noteCostOrThrow(COST_ESTIMATE_USD);

  const model = options.model || DEFAULT_MODEL;
  const body = {
    instances: [{ prompt }],
    parameters: {
      sampleCount: Math.max(1, Math.min(4, options.sampleCount || 1)),
      ...(options.aspectRatio ? { aspectRatio: options.aspectRatio } : {}),
    },
  };

  const t0 = Date.now();
  let resp;
  try {
    resp = await fetch(`${ENDPOINT(model)}?key=${encodeURIComponent(process.env[envVar])}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch (err) {
    throw new MediaProviderError(MEDIA_ERROR_CODES.PROVIDER_ERROR, `network error calling Imagen: ${err.message}`);
  }
  const providerRequestId = resp.headers.get('x-request-id') || undefined;

  const raw = await resp.text();
  let payload;
  try { payload = JSON.parse(raw); } catch { payload = null; }

  if (resp.status === 429) {
    throw new MediaProviderError(MEDIA_ERROR_CODES.RATE_LIMIT, `Imagen rate-limited: ${raw.slice(0, 200)}`, { providerRequestId });
  }
  if (resp.status === 400 && /safety|policy/i.test(raw)) {
    throw new MediaProviderError(MEDIA_ERROR_CODES.CONTENT_POLICY, `Imagen refused prompt for content policy: ${raw.slice(0, 200)}`, { providerRequestId });
  }
  if (!resp.ok) {
    throw new MediaProviderError(MEDIA_ERROR_CODES.PROVIDER_ERROR, `Imagen returned ${resp.status}: ${raw.slice(0, 200)}`, { providerRequestId });
  }

  const pred = payload?.predictions?.[0];
  const b64 = pred?.bytesBase64Encoded;
  if (!b64) {
    throw new MediaProviderError(MEDIA_ERROR_CODES.PROVIDER_ERROR, 'Imagen response missing predictions[0].bytesBase64Encoded', { providerRequestId });
  }

  try {
    mkdirSync(dirname(outPath), { recursive: true });
    writeFileSync(outPath, Buffer.from(b64, 'base64'));
  } catch (err) {
    throw new MediaProviderError(MEDIA_ERROR_CODES.IO, `failed to write image to ${outPath}: ${err.message}`);
  }

  return {
    outPath,
    durationMs: Date.now() - t0,
    costEstimateUsd: COST_ESTIMATE_USD,
    providerRequestId,
  };
}
