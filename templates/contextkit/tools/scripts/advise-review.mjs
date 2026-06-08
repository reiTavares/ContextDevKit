#!/usr/bin/env node
/**
 * `advise-review` — close the `/advise` → `/retro` loop (ADR-0032).
 *
 * `/advise` files findings into the DevPipeline tagged `source: advise:<lane>`, but
 * nothing read the OUTCOME back — so `/retro` and `/tune-agents` tuned on prose, not
 * on whether the advice actually landed. This joins `advise:<lane>` tasks against the
 * pipeline stages and reports a per-lane **hit-rate** (reached `conclusion/` vs still
 * open). A lane with many open + low hit-rate is either noisy (tune the agent down)
 * or under-served (do the work) — now visible instead of guessed.
 *
 * Read-only; zero-dep; defensive. Feeds `/retro` + `/tune-agents`.
 *
 * Usage:
 *   node contextkit/tools/scripts/advise-review.mjs
 *   node contextkit/tools/scripts/advise-review.mjs --json
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathsFor } from '../../runtime/config/paths.mjs';

const OPEN_STAGES = ['backlog', 'working', 'testing'];
const DONE_STAGE = 'conclusion';

function sourceOf(text) {
  const m = text.match(/^source:\s*(.+)$/m);
  return m ? m[1].trim() : '';
}

/**
 * Tallies advisor-sourced tasks per lane across the pipeline stages.
 * @param {string} [root] project root
 * @returns {{ rows: Array<{lane,open,done,total,hitRatePct}>, totals: {open,done,total}, hitRatePct: number }}
 */
export function reviewAdvice(root = process.cwd()) {
  const pipe = pathsFor(root).pipeline;
  const lanes = {};
  const scan = (stage, bucket) => {
    const dir = resolve(pipe, stage);
    if (!existsSync(dir)) return;
    for (const f of readdirSync(dir)) {
      if (!f.endsWith('.md')) continue;
      const src = sourceOf(readFileSync(resolve(dir, f), 'utf-8').replace(/^﻿/, ''));
      const m = src.match(/^advise:([a-z-]+)/i);
      if (!m) continue;
      const lane = m[1].toLowerCase();
      (lanes[lane] ||= { open: 0, done: 0 })[bucket] += 1;
    }
  };
  for (const s of OPEN_STAGES) scan(s, 'open');
  scan(DONE_STAGE, 'done');

  const rows = Object.entries(lanes)
    .map(([lane, c]) => {
      const total = c.open + c.done;
      return { lane, open: c.open, done: c.done, total, hitRatePct: total ? Math.round((100 * c.done) / total) : 0 };
    })
    .sort((a, b) => b.total - a.total);
  const totals = rows.reduce((acc, r) => ({ open: acc.open + r.open, done: acc.done + r.done, total: acc.total + r.total }), { open: 0, done: 0, total: 0 });
  return { rows, totals, hitRatePct: totals.total ? Math.round((100 * totals.done) / totals.total) : 0 };
}

function render(r) {
  if (!r.rows.length) return 'ℹ️  No advisor-sourced tasks (advise:<lane>) found yet — run /advise to seed, then re-check after work lands.';
  const lines = ['🔁 Advisor outcome review (advise:<lane> → conclusion/)', '─'.repeat(56), '  lane            done/total   hit-rate'];
  for (const row of r.rows) lines.push(`  ${row.lane.padEnd(15)} ${`${row.done}/${row.total}`.padEnd(11)} ${row.hitRatePct}%`);
  lines.push('─'.repeat(56), `  overall: ${r.totals.done}/${r.totals.total} acted on (${r.hitRatePct}%) · ${r.totals.open} still open`);
  lines.push('', '  Many-open + low-hit-rate ⇒ noisy lane (tune the owner down) or under-served (do the work). Feed into /retro + /tune-agents.');
  return lines.join('\n');
}

if (process.argv[1]?.endsWith('advise-review.mjs')) {
  const r = reviewAdvice(process.cwd());
  console.log(process.argv.includes('--json') ? JSON.stringify(r, null, 2) : render(r));
}
