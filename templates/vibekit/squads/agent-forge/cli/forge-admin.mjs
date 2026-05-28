#!/usr/bin/env node
/**
 * forge-admin — the *mutating* maintenance CLI for forged Agent Packages.
 * Every subcommand here CHANGES state, so each is dry-run by default; pass
 * `--write` to actually apply.
 *
 * Subcommands:
 *   refresh-matrix     — bumps `router/capability-matrix.json` `updated` + reports drift
 *   killswitch <agent> [on|off] — toggles `kill_switch.enabled` in quality.policy.yaml
 *   deprecate <agent>  — stamps `metadata.deprecated_at` into manifest + writes an ADR stub
 *
 * All mutations are atomic (tmp-file + rename) per the kit's safe-io discipline.
 */
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { discoverPackages } from '../lib/package-ops.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const MATRIX_PATH = resolve(HERE, '..', 'router', 'capability-matrix.json');

function parseArgs(argv) {
  const args = { sub: argv[0], target: null, mode: null, root: 'agent-packages', write: false, json: false };
  for (let i = 1; i < argv.length; i++) {
    const flag = argv[i];
    if (flag === '--root') args.root = argv[++i];
    else if (flag === '--write') args.write = true;
    else if (flag === '--json') args.json = true;
    else if (!args.target) args.target = flag;
    else if (!args.mode) args.mode = flag;
  }
  return args;
}

function findOne(pkgs, target) {
  if (!target) throw new Error('this subcommand requires <agent> (or <agent>@<version>)');
  const [name, version] = target.includes('@') ? target.split('@') : [target, null];
  const match = pkgs.find((p) => p.name === name && (!version || p.version === version));
  if (!match) throw new Error(`no package matches "${target}"`);
  return match;
}

async function atomicWrite(path, body) {
  await mkdir(dirname(path), { recursive: true });
  const tmp = path + '.tmp-' + process.pid + '-' + Date.now();
  await writeFile(tmp, body);
  await rename(tmp, path);
}

async function cmdRefreshMatrix(args) {
  const raw = await readFile(MATRIX_PATH, 'utf-8');
  const matrix = JSON.parse(raw.replace(/^﻿/, ''));
  const today = new Date().toISOString().slice(0, 10);
  const previous = matrix.updated;
  matrix.updated = today;
  const body = JSON.stringify(matrix, null, 2) + '\n';
  if (args.json) return console.log(JSON.stringify({ previous, next: today, models: matrix.models.length, write: args.write }, null, 2));
  console.log(`# Refresh capability-matrix`);
  console.log(`previous : ${previous}`);
  console.log(`next     : ${today}`);
  console.log(`models   : ${matrix.models.length}`);
  if (!args.write) {
    console.log('\n(dry-run; pass --write to apply. Prices/strengths must be reviewed by hand under an ADR.)');
    return;
  }
  await atomicWrite(MATRIX_PATH, body);
  console.log('✅ matrix.updated stamped. Open an ADR before changing model entries.');
}

async function cmdKillSwitch(args) {
  if (!args.mode || !['on', 'off'].includes(args.mode)) throw new Error('killswitch: pass `on` or `off` after <agent>');
  const pkg = findOne(await discoverPackages(resolve(process.cwd(), args.root)), args.target);
  const path = join(pkg.path, 'governance/quality.policy.yaml');
  const text = await readFile(path, 'utf-8');
  const target = args.mode === 'on' ? 'true' : 'false';
  if (/kill_switch:\s*\n\s*enabled:\s*(true|false)/.test(text)) {
    var next = text.replace(/(kill_switch:\s*\n\s*enabled:\s*)(true|false)/, `$1${target}`);
  } else {
    next = text + `\n# auto-appended by /forge-killswitch\nkill_switch:\n  enabled: ${target}\n`;
  }
  if (args.json) return console.log(JSON.stringify({ pkg: pkg.name, mode: args.mode, write: args.write }, null, 2));
  console.log(`# Kill-switch — ${pkg.name}@${pkg.version} → ${args.mode}`);
  if (!args.write) {
    console.log('(dry-run; pass --write to apply.)');
    return;
  }
  await atomicWrite(path, next);
  console.log('✅ kill_switch.enabled = ' + target + ' in ' + path);
}

async function cmdDeprecate(args) {
  const pkg = findOne(await discoverPackages(resolve(process.cwd(), args.root)), args.target);
  const path = join(pkg.path, 'manifest.yaml');
  const text = await readFile(path, 'utf-8');
  const stamp = new Date().toISOString();
  const marker = `  deprecated_at: '${stamp}'\n`;
  const next = /deprecated_at:/.test(text)
    ? text.replace(/(\s*deprecated_at:\s*)['"]?[\d:.TZ+-]+['"]?\n/, `$1'${stamp}'\n`)
    : text.replace(/(metadata:\n)/, `$1${marker}`);
  if (args.json) return console.log(JSON.stringify({ pkg: pkg.name, stamp, write: args.write }, null, 2));
  console.log(`# Deprecate — ${pkg.name}@${pkg.version}`);
  console.log(`stamp : ${stamp}`);
  if (!args.write) {
    console.log('(dry-run; pass --write to apply. /new-adr is recommended to record WHY.)');
    return;
  }
  await atomicWrite(path, next);
  console.log('✅ metadata.deprecated_at stamped. Now run /new-adr to record the reason.');
}

const HANDLERS = { 'refresh-matrix': cmdRefreshMatrix, killswitch: cmdKillSwitch, deprecate: cmdDeprecate };

async function main(argv) {
  const args = parseArgs(argv);
  const handler = HANDLERS[args.sub];
  if (!handler) {
    console.error(`forge-admin: unknown subcommand "${args.sub}". Allowed: ${Object.keys(HANDLERS).join(', ')}`);
    process.exit(1);
  }
  await handler(args);
}

const HERE_URL = fileURLToPath(import.meta.url);
const ENTRY = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : '';
if (ENTRY === pathToFileURL(HERE_URL).href) {
  main(process.argv.slice(2)).catch((err) => {
    console.error('forge-admin: ' + (err?.message ?? err));
    process.exit(1);
  });
}

export { cmdRefreshMatrix, cmdKillSwitch, cmdDeprecate };
