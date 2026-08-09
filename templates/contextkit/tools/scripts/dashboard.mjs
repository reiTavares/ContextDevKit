#!/usr/bin/env node
/**
 * `/dashboard` entry — ticket 051.
 *
 * Two modes, one binary:
 *   node contextkit/tools/scripts/dashboard.mjs                  # snapshot → dashboard.html
 *   node contextkit/tools/scripts/dashboard.mjs --watch          # live server on :4242
 *   node contextkit/tools/scripts/dashboard.mjs --watch --port=N # override port
 *   node contextkit/tools/scripts/dashboard.mjs --out=path.html  # custom snapshot output
 *
 * Snapshot mode is offline-friendly: the resulting file is self-contained
 * (inline CSS + JS, no external assets) and can be opened by double-click.
 * Live mode binds 127.0.0.1 only — never accessible from the network.
 *
 * Zero deps. Defensive (rule 2 — never break the dev loop).
 */
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildDashboardData } from './dashboard-data.mjs';
import { renderDashboardHTML } from './dashboard-html.mjs';

const argv = process.argv.slice(2);
const flag = (name) => argv.includes(`--${name}`) || argv.includes(`-${name[0]}`);
const valueFlag = (name) => {
  const hit = argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : null;
};

const WANT_HELP = flag('help') || argv.includes('-h');
const WANT_WATCH = flag('watch');
const OUT = valueFlag('out') || 'dashboard.html';

const help = () => process.stdout.write(`Usage: dashboard.mjs [--watch] [--port=N] [--out=PATH]

Snapshot mode (default):
  Writes a self-contained HTML file (default: ./dashboard.html) and exits.
  Open it in a browser. The file shows the state at the moment of generation.

Live mode (--watch):
  Spawns a tiny HTTP server on 127.0.0.1:4242 (override with --port=N or
  $CONTEXTDEVKIT_DASHBOARD_PORT). The page reconnects automatically via SSE
  and re-renders when files in the platform dir change.

Examples:
  node contextkit/tools/scripts/dashboard.mjs
  node contextkit/tools/scripts/dashboard.mjs --watch
  node contextkit/tools/scripts/dashboard.mjs --watch --port=8080
  node contextkit/tools/scripts/dashboard.mjs --out=tmp/state.html
`);

async function runSnapshot(root) {
  const data = buildDashboardData(root);
  const html = renderDashboardHTML(data, { live: false });
  const outPath = resolve(root, OUT);
  writeFileSync(outPath, html, 'utf-8');
  process.stdout.write(`📊 dashboard snapshot → ${outPath}\n`);
  process.stdout.write(`   Open with your file:// viewer or just double-click.\n`);
}

async function runLive(root) {
  const { startDashboardServer, resolvePort } = await import('./dashboard-server.mjs');
  const port = resolvePort(argv);
  let server;
  try {
    server = await startDashboardServer({ root, port });
  } catch (err) {
    if (err.code === 'EADDRINUSE') {
      process.stderr.write(`dashboard: port ${port} is in use — try --port=N or stop the conflicting process.\n`);
    } else {
      process.stderr.write(`dashboard: failed to start on port ${port}: ${err.message}\n`);
    }
    process.exit(1);
    return;
  }
  const url = `http://127.0.0.1:${server.port}`;
  process.stdout.write(`📊 dashboard live → ${url}\n`);
  process.stdout.write(`   Watching ${root}/contextkit/ — Ctrl+C to stop.\n`);
  const shutdown = () => {
    process.stdout.write(`\n   dashboard stopped.\n`);
    server.close();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
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
  if (WANT_HELP) {
    help();
    process.exit(0);
  }
  const root = process.cwd();
  (WANT_WATCH ? runLive(root) : runSnapshot(root)).catch((err) => {
    process.stderr.write(`dashboard: ${err.message}\n`);
    process.exit(1);
  });
}
