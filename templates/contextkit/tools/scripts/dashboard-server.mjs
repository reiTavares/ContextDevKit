/**
 * Dashboard live server (`--watch` mode) — ticket 051.
 *
 * Spawns a tiny `node:http` server bound to 127.0.0.1 only. Two routes:
 *   GET /         → serves the dashboard HTML with the live-mode client
 *   GET /events   → text/event-stream that pushes the rebuilt data
 *                    object whenever a file in the platform dir changes
 *
 * Change detection: `fs.watch` on `contextkit/` recursive=true with a
 * 200 ms debouncer collapsing bursts (e.g. `pipeline.mjs sync`
 * rewriting indices). A 15 s heartbeat keeps the SSE connection alive
 * through reverse proxies (not that we proxy — we bind localhost — but
 * defensive).
 *
 * Zero deps. Defensive: any failure logs and continues (rule 2 — never
 * break the dev loop). Clean shutdown on SIGINT.
 */
import { createServer } from 'node:http';
import { watch as fsWatch } from 'node:fs';
import { resolve } from 'node:path';
import { PLATFORM_DIR } from '../../runtime/config/paths.mjs';
import { buildDashboardData } from './dashboard-data.mjs';
import { renderDashboardHTML } from './dashboard-html.mjs';

const HEARTBEAT_MS = 15_000;
const DEBOUNCE_MS = 200;
const DEFAULT_PORT = 4242;

/**
 * Resolve the port to bind to (CLI override > env > default).
 *
 * @param {string[]} argv  process.argv slice
 * @returns {number}
 */
export function resolvePort(argv = []) {
  const flag = argv.find((a) => a.startsWith('--port='));
  if (flag) {
    const n = Number(flag.slice('--port='.length));
    if (Number.isInteger(n) && n > 0 && n < 65536) return n;
  }
  const env = process.env.CONTEXTDEVKIT_DASHBOARD_PORT;
  if (env) {
    const n = Number(env);
    if (Number.isInteger(n) && n > 0 && n < 65536) return n;
  }
  return DEFAULT_PORT;
}

/**
 * Start the live dashboard server. Resolves once it is listening.
 *
 * @param {object} opts
 * @param {string} opts.root  project root (absolute)
 * @param {number} opts.port  port to bind on 127.0.0.1
 * @returns {Promise<{ close: () => void, port: number }>}
 */
export async function startDashboardServer({ root, port }) {
  const clients = new Set();
  let cachedData = buildDashboardData(root);
  let cachedHtml = renderDashboardHTML(cachedData, { live: true });
  let debounceHandle = null;
  let watcher = null;

  const broadcast = (payload) => {
    const line = `data: ${JSON.stringify(payload)}\n\n`;
    for (const res of clients) {
      try { res.write(line); } catch { /* socket dead — onClose will clean up */ }
    }
  };

  const rebuild = () => {
    try {
      cachedData = buildDashboardData(root);
      cachedHtml = renderDashboardHTML(cachedData, { live: true });
      broadcast(cachedData);
    } catch (err) {
      process.stderr.write(`dashboard: rebuild failed: ${err.message}\n`);
    }
  };

  const scheduleRebuild = () => {
    if (debounceHandle) clearTimeout(debounceHandle);
    debounceHandle = setTimeout(rebuild, DEBOUNCE_MS);
  };

  const server = createServer((req, res) => {
    if (req.url === '/events') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no',
      });
      res.write(`data: ${JSON.stringify(cachedData)}\n\n`);
      clients.add(res);
      const heartbeat = setInterval(() => {
        try { res.write(': hb\n\n'); } catch { /* dead */ }
      }, HEARTBEAT_MS);
      req.on('close', () => {
        clearInterval(heartbeat);
        clients.delete(res);
      });
      return;
    }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(cachedHtml);
  });

  try {
    watcher = fsWatch(resolve(root, PLATFORM_DIR), { recursive: true }, () => scheduleRebuild());
  } catch (err) {
    process.stderr.write(`dashboard: fs.watch failed (recursive may not be supported here): ${err.message}\n`);
  }

  await new Promise((res, rej) => {
    server.once('error', rej);
    server.listen(port, '127.0.0.1', res);
  });

  return {
    port: server.address().port,
    close: () => {
      try { watcher?.close(); } catch { /* defensive */ }
      for (const r of clients) { try { r.end(); } catch { /* defensive */ } }
      clients.clear();
      server.close();
    },
  };
}
