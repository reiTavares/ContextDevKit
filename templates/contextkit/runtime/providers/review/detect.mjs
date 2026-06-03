/**
 * Resolve which review-provider adapter to use for the current repo — ADR-0021.
 *
 * Order:
 *   1. `contextkit/config.json` → `providers.review` (if set, win).
 *   2. Auto-detect from `git remote get-url origin` by asking each adapter's
 *      `detectsRemote`. Records the resolution back to `config.json`.
 *   3. Refuse with a clear error if nothing matches. No silent fallback.
 *
 * Zero deps. The adapter modules themselves are zero-dep (they shell out to
 * the user's CLI).
 */
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { validateAdapter, ProviderError } from './_adapter.mjs';
import { PLATFORM_DIR } from '../../config/paths.mjs';

const here = dirname(fileURLToPath(import.meta.url));

function readOriginUrl(cwd) {
  const result = spawnSync('git', ['remote', 'get-url', 'origin'], {
    cwd,
    encoding: 'utf8',
    shell: false,
  });
  if (result.status !== 0) return null;
  return (result.stdout || '').trim() || null;
}

function loadAdapterModules() {
  const files = readdirSync(here)
    .filter(name => name.endsWith('.mjs'))
    .filter(name => !name.startsWith('_'))
    .filter(name => name !== 'detect.mjs');
  return Promise.all(
    files.map(async (file) => {
      const url = pathToFileURL(join(here, file)).href;
      const mod = await import(url);
      const verdict = validateAdapter(mod);
      if (!verdict.ok) {
        throw new ProviderError(
          'BAD_ADAPTER',
          `adapter ${file} failed contract validation: ${verdict.reasons.join('; ')}`,
        );
      }
      return { file, mod };
    }),
  );
}

function readConfig(configPath) {
  try {
    const raw = readFileSync(configPath, 'utf8').replace(/^﻿/, '');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function writeConfig(configPath, config) {
  try {
    writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n', 'utf8');
  } catch {
    /* best-effort — do not break the calling command on a config-write race */
  }
}

/**
 * Resolve the review-provider adapter for `cwd`.
 *
 * @param {object} [opts]
 * @param {string} [opts.cwd]         project root (defaults to process.cwd())
 * @param {string} [opts.configPath]  override path to contextkit/config.json
 * @returns {Promise<{ id: string, source: 'config' | 'detected', adapter: object }>}
 */
export async function resolveAdapter({ cwd = process.cwd(), configPath } = {}) {
  const resolvedConfigPath = configPath || join(cwd, PLATFORM_DIR, 'config.json');
  const config = readConfig(resolvedConfigPath) || {};
  const adapters = await loadAdapterModules();

  const fromConfig = config?.providers?.review;
  if (fromConfig) {
    const hit = adapters.find(a => a.mod.id === fromConfig);
    if (!hit) {
      throw new ProviderError(
        'CONFIGURED_ADAPTER_NOT_FOUND',
        `contextkit/config.json names review provider "${fromConfig}" but no matching adapter is installed`,
      );
    }
    return { id: hit.mod.id, source: 'config', adapter: hit.mod };
  }

  const originUrl = readOriginUrl(cwd);
  if (!originUrl) {
    throw new ProviderError(
      'NO_ORIGIN',
      'no `origin` remote configured — cannot auto-detect a review provider. Set `providers.review` in contextkit/config.json.',
    );
  }
  const detected = adapters.find(a => a.mod.detectsRemote(originUrl));
  if (!detected) {
    throw new ProviderError(
      'NO_MATCHING_ADAPTER',
      `no review adapter matched origin "${originUrl}". Set \`providers.review\` in contextkit/config.json or add an adapter to contextkit/runtime/providers/review/.`,
    );
  }

  config.providers = config.providers || {};
  config.providers.review = detected.mod.id;
  writeConfig(resolvedConfigPath, config);

  return { id: detected.mod.id, source: 'detected', adapter: detected.mod };
}
