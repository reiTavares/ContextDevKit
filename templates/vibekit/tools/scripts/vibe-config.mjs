#!/usr/bin/env node
/**
 * Inspect or edit `vibekit/config.json` reliably (backs the `/vibe-config`
 * command). Zero-dependency; uses optional zod validation if installed.
 *
 * Usage:
 *   node vibekit/tools/scripts/vibe-config.mjs show [dotted.path]
 *   node vibekit/tools/scripts/vibe-config.mjs set <dotted.path> <value>
 *
 * Values are coerced to the existing leaf type: numbers, booleans, and JSON
 * arrays/objects parse; everything else stays a string. Writing always
 * pretty-prints with 2-space indent and validates structure first.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { pathsFor } from '../../runtime/config/paths.mjs';

const ROOT = process.cwd();
const CONFIG = pathsFor(ROOT).config;

function load() {
  if (!existsSync(CONFIG)) return {};
  return JSON.parse(readFileSync(CONFIG, 'utf-8').replace(/^﻿/, ''));
}

function getAt(obj, path) {
  return path.split('.').reduce((cur, k) => (cur == null ? undefined : cur[k]), obj);
}

function setAt(obj, path, value) {
  const segs = path.split('.');
  let cur = obj;
  for (let i = 0; i < segs.length - 1; i++) {
    if (cur[segs[i]] == null || typeof cur[segs[i]] !== 'object') cur[segs[i]] = {};
    cur = cur[segs[i]];
  }
  cur[segs[segs.length - 1]] = value;
  return obj;
}

function coerce(existing, raw) {
  if (typeof existing === 'number') {
    const n = Number(raw);
    if (Number.isNaN(n)) throw new Error(`expected a number, got "${raw}"`);
    return n;
  }
  if (typeof existing === 'boolean') {
    if (raw === 'true') return true;
    if (raw === 'false') return false;
    throw new Error(`expected true/false, got "${raw}"`);
  }
  if (Array.isArray(existing) || raw.trim().startsWith('[') || raw.trim().startsWith('{')) {
    return JSON.parse(raw);
  }
  return raw;
}

async function maybeValidate(cfg) {
  try {
    const { validateConfig, formatZodError } = await import('../../runtime/config/schema.mjs');
    const res = validateConfig(cfg);
    if (!res.ok) {
      console.error('Refusing to write — schema validation failed:\n' + formatZodError(res.error));
      process.exit(1);
    }
    return true;
  } catch {
    return false; // zod not installed — skip strict validation
  }
}

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  const cfg = load();

  if (!cmd || cmd === 'show') {
    const path = rest[0];
    const value = path ? getAt(cfg, path) : cfg;
    console.log(JSON.stringify(value, null, 2));
    return;
  }

  if (cmd === 'set') {
    const [path, ...valParts] = rest;
    const raw = valParts.join(' ');
    if (!path || raw === '') {
      console.error('Usage: vibe-config.mjs set <dotted.path> <value>');
      process.exit(1);
    }
    const existing = getAt(cfg, path);
    let value;
    try {
      value = coerce(existing, raw);
    } catch (err) {
      console.error(`Bad value: ${err.message}`);
      process.exit(1);
    }
    setAt(cfg, path, value);
    const validated = await maybeValidate(cfg);
    writeFileSync(CONFIG, JSON.stringify(cfg, null, 2) + '\n', 'utf-8');
    console.log(`✅ set ${path} = ${JSON.stringify(value)}${validated ? ' (zod-validated)' : ''}`);
    return;
  }

  console.error(`Unknown command "${cmd}". Use: show [path] | set <path> <value>`);
  process.exit(1);
}

main().catch((err) => {
  console.error('vibe-config failed:', err.message);
  process.exit(1);
});
