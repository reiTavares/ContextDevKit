/**
 * Veo — video generation via Google AI Studio's Veo API (ADR-0024).
 *
 * Authentication: same single API key as nano-banana — `GOOGLE_AI_API_KEY`.
 *
 * Pricing (dated 2026-06-02 — verify at https://ai.google.dev/pricing):
 *   Veo 3 generate:  ~$0.50 per second of video
 *   Typical 8 s clip: ~$4.00
 *   The adapter charges per requested duration; the real bill is on Google.
 *
 * Veo's generation is *long-running*: the initial POST returns an
 * operation name; the adapter polls until `done: true` then downloads
 * the resulting video.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import {
  MediaProviderError, MEDIA_ERROR_CODES,
  assertCredentials, noteCostOrThrow,
} from './_adapter.mjs';

export const id = 'veo';
export const kind = 'video';
export const envVar = 'GOOGLE_AI_API_KEY';
export const requiredEnv = ['GOOGLE_AI_API_KEY'];

const DEFAULT_MODEL = 'veo-3.0-generate-preview';
const COST_PER_SECOND_USD = 0.50;

/** Estimated USD cost for the requested clip length — used by the media cache to report savings on a hit. */
export function estimateCostUsd(options = {}) {
  return Math.max(1, Math.min(60, options.durationSeconds || 8)) * COST_PER_SECOND_USD;
}

const POLL_INTERVAL_MS = 5000;
const POLL_TIMEOUT_MS = 5 * 60 * 1000;
const PREDICT_ENDPOINT = (model) => `https://generativelanguage.googleapis.com/v1beta/models/${model}:predictLongRunning`;
const OPERATION_ENDPOINT = (op) => `https://generativelanguage.googleapis.com/v1beta/${op}`;

const sleep = (ms) => new Promise((res) => setTimeout(res, ms));

/**
 * Generate a video and write it to disk.
 *
 * @param {object} input
 * @param {string} input.prompt
 * @param {string} input.outPath
 * @param {object} [input.options]
 * @param {string} [input.options.model]          default DEFAULT_MODEL
 * @param {number} [input.options.durationSeconds]  default 8 (Veo's typical max)
 * @param {string} [input.options.aspectRatio]    "16:9" | "9:16"
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

  const duration = Math.max(1, Math.min(60, options.durationSeconds || 8));
  const estimate = duration * COST_PER_SECOND_USD;
  noteCostOrThrow(estimate);

  const model = options.model || DEFAULT_MODEL;
  const apiKey = encodeURIComponent(process.env[envVar]);
  const body = {
    instances: [{ prompt }],
    parameters: {
      durationSeconds: duration,
      ...(options.aspectRatio ? { aspectRatio: options.aspectRatio } : {}),
    },
  };

  const t0 = Date.now();
  let initResp;
  try {
    // Key in the header, never the URL (ticket 062 — avoids leaking it into logs).
    initResp = await fetch(PREDICT_ENDPOINT(model), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify(body),
    });
  } catch (err) {
    throw new MediaProviderError(MEDIA_ERROR_CODES.PROVIDER_ERROR, `network error calling Veo: ${err.message}`);
  }
  const initRaw = await initResp.text();
  let initPayload;
  try { initPayload = JSON.parse(initRaw); } catch { initPayload = null; }
  const providerRequestId = initResp.headers.get('x-request-id') || undefined;

  if (initResp.status === 429) {
    throw new MediaProviderError(MEDIA_ERROR_CODES.RATE_LIMIT, `Veo rate-limited: ${initRaw.slice(0, 200)}`, { providerRequestId });
  }
  if (initResp.status === 400 && /safety|policy/i.test(initRaw)) {
    throw new MediaProviderError(MEDIA_ERROR_CODES.CONTENT_POLICY, `Veo refused prompt for content policy: ${initRaw.slice(0, 200)}`, { providerRequestId });
  }
  if (!initResp.ok) {
    throw new MediaProviderError(MEDIA_ERROR_CODES.PROVIDER_ERROR, `Veo init returned ${initResp.status}: ${initRaw.slice(0, 200)}`, { providerRequestId });
  }

  const opName = initPayload?.name;
  if (!opName) {
    throw new MediaProviderError(MEDIA_ERROR_CODES.PROVIDER_ERROR, 'Veo response missing `name` (operation id)', { providerRequestId });
  }

  let opPayload = null;
  const deadline = Date.now() + POLL_TIMEOUT_MS;
  while (Date.now() < deadline) {
    await sleep(POLL_INTERVAL_MS);
    let pollResp;
    try {
      pollResp = await fetch(OPERATION_ENDPOINT(opName), { headers: { 'x-goog-api-key': apiKey } });
    } catch (err) {
      continue;
    }
    if (!pollResp.ok) continue;
    const pollRaw = await pollResp.text();
    try { opPayload = JSON.parse(pollRaw); } catch { continue; }
    if (opPayload?.done) break;
  }

  if (!opPayload?.done) {
    throw new MediaProviderError(MEDIA_ERROR_CODES.PROVIDER_ERROR, `Veo operation ${opName} did not complete within ${POLL_TIMEOUT_MS / 1000}s`, { providerRequestId });
  }

  if (opPayload.error) {
    throw new MediaProviderError(MEDIA_ERROR_CODES.PROVIDER_ERROR, `Veo operation failed: ${JSON.stringify(opPayload.error).slice(0, 300)}`, { providerRequestId });
  }

  // Veo's response shape: either bytesBase64Encoded inline, or a URI to fetch.
  const resp = opPayload?.response;
  const sample = resp?.generatedVideos?.[0] || resp?.videos?.[0] || resp?.predictions?.[0];
  const b64 = sample?.bytesBase64Encoded || sample?.video?.bytesBase64Encoded;
  const uri = sample?.uri || sample?.video?.uri;
  let bytes;
  if (b64) {
    bytes = Buffer.from(b64, 'base64');
  } else if (uri) {
    try {
      const dl = await fetch(uri, { headers: { 'x-goog-api-key': apiKey } });
      if (!dl.ok) {
        throw new MediaProviderError(MEDIA_ERROR_CODES.PROVIDER_ERROR, `Veo video download returned ${dl.status}`);
      }
      bytes = Buffer.from(await dl.arrayBuffer());
    } catch (err) {
      if (err instanceof MediaProviderError) throw err;
      throw new MediaProviderError(MEDIA_ERROR_CODES.PROVIDER_ERROR, `Veo video download error: ${err.message}`);
    }
  } else {
    throw new MediaProviderError(MEDIA_ERROR_CODES.PROVIDER_ERROR, 'Veo response missing video data (no bytesBase64Encoded or uri)');
  }

  try {
    mkdirSync(dirname(outPath), { recursive: true });
    writeFileSync(outPath, bytes);
  } catch (err) {
    throw new MediaProviderError(MEDIA_ERROR_CODES.IO, `failed to write video to ${outPath}: ${err.message}`);
  }

  return {
    outPath,
    durationMs: Date.now() - t0,
    costEstimateUsd: estimate,
    providerRequestId,
  };
}
