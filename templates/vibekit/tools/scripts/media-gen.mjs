#!/usr/bin/env node
/**
 * /media-gen — CLI entry for the media-provider adapters (ADR-0024).
 *
 *   node vibekit/tools/scripts/media-gen.mjs image --prompt "..." --out path.png
 *   node vibekit/tools/scripts/media-gen.mjs video --prompt "..." --out path.mp4
 *   node vibekit/tools/scripts/media-gen.mjs image --prompt "..." --out path.png --dry-run
 *
 * Reads credentials from process.env (recommended: run via
 * `node --env-file=vibekit/.env vibekit/tools/scripts/media-gen.mjs ...`
 * on Node 20.6+). Refuses cleanly with NO_CREDENTIALS pointing at
 * vibekit/.env.example when keys are absent.
 *
 * Defensive (rule 2). Zero deps.
 */
import { readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { validateAdapter, MediaProviderError, MEDIA_ERROR_CODES, readCostCapUsd } from '../../runtime/providers/media/_adapter.mjs';

const ADAPTERS_DIR = resolve(fileURLToPath(import.meta.url), '..', '..', '..', 'runtime', 'providers', 'media');

const help = `Usage:
  media-gen.mjs <image|video> --prompt "..." --out PATH [options]

Common options:
  --prompt "..."         what to generate (required)
  --out PATH             where to write the file (required unless --dry-run)
  --provider ID          force a specific adapter id (e.g. nano-banana, veo)
  --aspect-ratio R       16:9 | 9:16 | 1:1 | 3:4 | 4:3 (provider-dependent)
  --duration N           seconds (video only; default 8)
  --model ID             override the adapter's default model
  --sample-count N       image only; 1..4 (only the first is written)
  --dry-run              show what would be called; make no network request
  --help                 this message

Env:
  GOOGLE_AI_API_KEY              required for nano-banana + veo
  VIBEDEVKIT_MEDIA_MAX_USD       optional per-process spend cap (USD)

See vibekit/.env.example for the template.
`;

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry-run') args.dryRun = true;
    else if (a === '--help' || a === '-h') args.help = true;
    else if (a.startsWith('--')) {
      const name = a.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith('--')) { args[camel(name)] = next; i++; }
      else args[camel(name)] = true;
    } else {
      args._.push(a);
    }
  }
  return args;
}
const camel = (s) => s.replace(/-([a-z])/g, (_, c) => c.toUpperCase());

async function loadAdapters() {
  const files = readdirSync(ADAPTERS_DIR)
    .filter((f) => f.endsWith('.mjs') && !f.startsWith('_'));
  const out = [];
  for (const file of files) {
    const url = pathToFileURL(resolve(ADAPTERS_DIR, file)).href;
    const mod = await import(url);
    const verdict = validateAdapter(mod);
    if (verdict.ok) out.push(mod);
    else process.stderr.write(`media-gen: skipping ${file} — invalid adapter: ${verdict.reasons.join('; ')}\n`);
  }
  return out;
}

function pickAdapter(adapters, args) {
  const kind = args._[0]; // 'image' | 'video'
  if (!kind || (kind !== 'image' && kind !== 'video')) {
    throw new Error(`first positional arg must be "image" or "video"; got: ${kind || '(nothing)'}`);
  }
  const wantId = args.provider;
  const pool = adapters.filter((a) => a.kind === kind);
  if (!pool.length) throw new Error(`no media adapter of kind="${kind}" is installed`);
  if (wantId) {
    const hit = pool.find((a) => a.id === wantId);
    if (!hit) throw new Error(`no adapter with id="${wantId}" of kind="${kind}". Available: ${pool.map((a) => a.id).join(', ')}`);
    return hit;
  }
  return pool[0];
}

function buildOptions(args) {
  const o = {};
  if (args.aspectRatio) o.aspectRatio = args.aspectRatio;
  if (args.model) o.model = args.model;
  if (args.duration) o.durationSeconds = Number(args.duration);
  if (args.sampleCount) o.sampleCount = Number(args.sampleCount);
  return o;
}

const isMain = (() => {
  try {
    const here = new URL(import.meta.url).pathname.toLowerCase();
    const entry = process.argv[1]
      ? new URL('file://' + process.argv[1].replace(/\\/g, '/')).pathname.toLowerCase()
      : '';
    return here === entry;
  } catch { return false; }
})();

if (isMain) {
  (async () => {
    const args = parseArgs(process.argv.slice(2));
    if (args.help || process.argv.length <= 2) {
      process.stdout.write(help);
      process.exit(0);
    }
    const adapters = await loadAdapters();
    let adapter;
    try { adapter = pickAdapter(adapters, args); }
    catch (err) { process.stderr.write(`media-gen: ${err.message}\n`); process.exit(2); }

    if (!args.prompt) { process.stderr.write('media-gen: --prompt is required\n'); process.exit(2); }
    if (!args.out && !args.dryRun) { process.stderr.write('media-gen: --out PATH is required (or pass --dry-run)\n'); process.exit(2); }

    const options = buildOptions(args);
    const cap = readCostCapUsd();
    const capLine = cap !== null ? ` · cost cap $${cap.toFixed(2)}` : '';

    if (args.dryRun) {
      process.stdout.write(`🎬 dry-run · ${adapter.id} (${adapter.kind})${capLine}\n`);
      process.stdout.write(`   prompt: ${args.prompt}\n`);
      process.stdout.write(`   out:    ${args.out || '(none)'}\n`);
      process.stdout.write(`   options: ${JSON.stringify(options)}\n`);
      process.stdout.write(`   env required: ${adapter.requiredEnv.join(', ')}${adapter.requiredEnv.every((n) => process.env[n]) ? ' ✓ set' : ' ✗ missing'}\n`);
      process.exit(0);
    }

    try {
      const r = await adapter.generate({ prompt: args.prompt, outPath: resolve(args.out), options });
      process.stdout.write(`✅ ${adapter.id}: wrote ${r.outPath}\n`);
      process.stdout.write(`   duration: ${r.durationMs} ms · est. cost: $${r.costEstimateUsd.toFixed(2)}${r.providerRequestId ? ` · req: ${r.providerRequestId}` : ''}\n`);
      process.exit(0);
    } catch (err) {
      if (err instanceof MediaProviderError) {
        process.stderr.write(`✗ ${err.code}: ${err.message}\n`);
        process.exit(err.code === MEDIA_ERROR_CODES.NO_CREDENTIALS ? 3 : 1);
      }
      process.stderr.write(`media-gen: ${err.message}\n`);
      process.exit(1);
    }
  })();
}
