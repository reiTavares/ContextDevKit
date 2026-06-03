/**
 * Dashboard HTML renderer — turns a data object from `dashboard-data.mjs`
 * into a single self-contained HTML string (ticket 051).
 *
 * Single string output, no streaming. Inline CSS + inline JS, no
 * external assets. Works opened directly from the file system AND when
 * served by `dashboard-server.mjs` (the live `--watch` mode appends a
 * tiny SSE-reconnecting client at the bottom).
 *
 * The renderer is **purely functional** — same input gives the same
 * HTML. Reads no files; mutates no globals. Easy to unit-test.
 */

const TYPE_COLORS = {
  bug: '#e3413c', chore: '#7a8497', increment: '#3b6ef0',
  spike: '#8b5cf6', docs: '#10b981',
};
const PRI_COLORS = {
  P1: '#e3413c', P2: '#f59e0b', P3: '#facc15', P4: '#9ca3af',
};
const ADR_STATUS_COLORS = {
  Accepted: '#10b981', Proposed: '#f59e0b', Superseded: '#9ca3af',
};

const escapeHtml = (s) => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const fmtTime = (ms) => {
  const d = new Date(ms);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
};

const renderBadge = (text, color) =>
  `<span class="badge" style="background:${color}">${escapeHtml(text)}</span>`;

const renderCard = (t) => {
  const typeBadge = t.type ? renderBadge(t.type, TYPE_COLORS[t.type] || '#7a8497') : '';
  const priBadge = t.priority ? renderBadge(t.priority, PRI_COLORS[t.priority] || '#9ca3af') : '';
  const sla = t.sla ? `<span class="sla" title="SLA">⏰ ${escapeHtml(t.sla)}</span>` : '';
  const src = t.source ? `<span class="src" title="source">↳ ${escapeHtml(t.source)}</span>` : '';
  return `<article class="card" data-id="${escapeHtml(t.id)}">
    <header><span class="tid">#${escapeHtml(t.id)}</span>${typeBadge}${priBadge}</header>
    <h3>${escapeHtml(t.title)}</h3>
    <footer>${sla}${src}</footer>
  </article>`;
};

const LANE_META = {
  backlog:    { title: 'Backlog',    icon: '📋', tone: 'lane-backlog' },
  working:    { title: 'Working',    icon: '🔵', tone: 'lane-working' },
  testing:    { title: 'Testing',    icon: '🟡', tone: 'lane-testing' },
  conclusion: { title: 'Concluded',  icon: '✅', tone: 'lane-conclusion' },
};

const renderLane = (lane, tickets) => {
  const meta = LANE_META[lane];
  const items = tickets.length
    ? tickets.map(renderCard).join('')
    : `<div class="empty">— empty —</div>`;
  return `<section class="lane ${meta.tone}">
    <header><span class="lane-icon">${meta.icon}</span><h2>${meta.title}</h2><span class="lane-count">${tickets.length}</span></header>
    <div class="lane-body">${items}</div>
  </section>`;
};

const renderAdrs = (adrs) => {
  if (!adrs.length) return '<p class="empty">No ADRs yet.</p>';
  return adrs.slice(0, 12).map((a) => {
    const statusColor = ADR_STATUS_COLORS[a.status?.split(/[\s(]/)[0]] || '#9ca3af';
    return `<article class="adr"><header>
      <span class="adr-num">ADR-${escapeHtml(a.number)}</span>
      ${renderBadge(a.status?.split('(')[0].trim() || '?', statusColor)}
      <span class="adr-date">${escapeHtml(a.date)}</span>
    </header><h4>${escapeHtml(a.title)}</h4></article>`;
  }).join('');
};

const renderSessions = (sessions) => {
  if (!sessions.length) return '<p class="empty">No sessions logged yet.</p>';
  return sessions.map((s) => `<article class="session">
    <header><span class="sess-num">Session ${escapeHtml(s.number)}</span><span class="sess-date">${escapeHtml(s.date)}</span></header>
    <h4>${escapeHtml(s.title)}</h4>
    <footer>${s.branch ? `<code>${escapeHtml(s.branch)}</code>` : ''}</footer>
  </article>`).join('');
};

const renderMarkdownLight = (md) => {
  if (!md) return '';
  return escapeHtml(md)
    .replace(/^### (.+)$/gm, '<h4>$1</h4>')
    .replace(/^## (.+)$/gm, '<h3>$1</h3>')
    .replace(/^# (.+)$/gm, '<h2>$1</h2>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/^- (.+)$/gm, '<li>$1</li>')
    .replace(/(<li>.*?<\/li>\n?)+/gs, (m) => `<ul>${m}</ul>`)
    .replace(/\n\n/g, '</p><p>')
    .replace(/^(?!<)/gm, '');
};

/**
 * Render the full HTML document for a dashboard data object.
 *
 * @param {object} data         from buildDashboardData()
 * @param {object} [opts]
 * @param {boolean} [opts.live] when true, append the SSE client script
 * @returns {string}            self-contained HTML
 */
export function renderDashboardHTML(data, opts = {}) {
  const live = !!opts.live;
  const indicator = live
    ? `<span class="live-pill" id="live-pill"><span class="dot"></span>live</span>`
    : `<span class="snap-pill">snapshot · ${fmtTime(data.meta.generatedAt)}</span>`;
  const liveScript = live ? `<script>${CLIENT_JS}</script>` : '';
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(data.meta.project)} — ContextDevKit dashboard</title>
<style>${CSS}</style>
</head><body>
<header class="topbar">
  <div class="brand"><strong>${escapeHtml(data.meta.project)}</strong><span class="muted">·</span><code>${escapeHtml(data.meta.branch || '?')}</code><span class="muted">·</span>L${data.meta.level ?? '?'}</div>
  ${indicator}
</header>
<main>
  <section class="counts">
    ${Object.entries(data.counts).map(([k, v]) => `<div class="count ${LANE_META[k].tone}"><span class="n">${v}</span><span class="l">${LANE_META[k].title}</span></div>`).join('')}
  </section>
  <section class="pipeline" id="pipeline">
    ${['backlog', 'working', 'testing', 'conclusion'].map((l) => renderLane(l, data.pipeline[l])).join('')}
  </section>
  <section class="two-col">
    <div><h2>Recent ADRs</h2><div class="adrs" id="adrs">${renderAdrs(data.adrs)}</div></div>
    <div><h2>Recent sessions</h2><div class="sessions" id="sessions">${renderSessions(data.sessions)}</div></div>
  </section>
  <details class="block"><summary><h2>CHANGELOG · [Unreleased]</h2></summary><div class="md" id="changelog">${renderMarkdownLight(data.changelogUnreleased)}</div></details>
  ${data.roadmap.exists ? `<details class="block"><summary><h2>Roadmap</h2></summary><div class="md" id="roadmap">${renderMarkdownLight(data.roadmap.markdown)}</div></details>` : ''}
</main>
<footer class="footnote">ContextDevKit · ${escapeHtml(data.meta.platformDir)}/ · generated ${fmtTime(data.meta.generatedAt)}</footer>
${liveScript}
</body></html>`;
}

const CSS = `
:root { color-scheme: light dark; --bg:#fff; --fg:#1f2328; --muted:#7a8497; --card:#f6f7f9; --border:#e1e4e8; --accent:#5046e5; }
@media (prefers-color-scheme: dark) { :root { --bg:#0c0c10; --fg:#e4e6eb; --muted:#9ca3af; --card:#16161c; --border:#2a2a33; } }
* { box-sizing: border-box; } body { margin:0; font:14px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif; background:var(--bg); color:var(--fg); }
.topbar { display:flex; align-items:center; justify-content:space-between; padding:14px 24px; border-bottom:1px solid var(--border); position:sticky; top:0; background:var(--bg); z-index:10; }
.brand { display:flex; gap:8px; align-items:center; } .brand code { font:12px/1 ui-monospace,Menlo,monospace; padding:3px 6px; border:1px solid var(--border); border-radius:4px; }
.muted { color:var(--muted); } .live-pill { display:inline-flex; align-items:center; gap:6px; padding:4px 10px; border-radius:12px; background:#10b981; color:#fff; font-weight:600; font-size:12px; }
.live-pill .dot { width:8px; height:8px; background:#fff; border-radius:50%; animation: pulse 2s infinite; }
.live-pill.stale { background:#e3413c; } .snap-pill { font-size:12px; color:var(--muted); }
@keyframes pulse { 0%,100% { opacity:1 } 50% { opacity:.4 } }
main { max-width: 1600px; margin: 0 auto; padding: 24px; }
.counts { display:grid; grid-template-columns: repeat(4, 1fr); gap:12px; margin-bottom:24px; }
.count { padding:14px; border-radius:8px; background:var(--card); border:1px solid var(--border); display:flex; justify-content:space-between; align-items:baseline; }
.count .n { font-size:28px; font-weight:700; } .count .l { color:var(--muted); }
.pipeline { display:grid; grid-template-columns: repeat(4, minmax(220px, 1fr)); gap:14px; margin-bottom:32px; }
@media (max-width:1100px) { .pipeline { grid-template-columns: repeat(2, 1fr); } } @media (max-width:680px) { .pipeline { grid-template-columns: 1fr; } }
.lane { background:var(--card); border:1px solid var(--border); border-radius:8px; display:flex; flex-direction:column; min-height:200px; }
.lane > header { display:flex; align-items:center; gap:8px; padding:12px 14px; border-bottom:1px solid var(--border); }
.lane > header h2 { font-size:13px; font-weight:600; text-transform:uppercase; letter-spacing:.5px; margin:0; flex:1; }
.lane-count { background:var(--bg); border:1px solid var(--border); padding:1px 8px; border-radius:10px; font-size:11px; font-weight:600; }
.lane-body { padding:8px; display:flex; flex-direction:column; gap:8px; flex:1; }
.lane-backlog > header { color:#7a8497; } .lane-working > header { color:#3b6ef0; }
.lane-testing > header { color:#f59e0b; } .lane-conclusion > header { color:#10b981; }
.card { background:var(--bg); border:1px solid var(--border); border-radius:6px; padding:10px; transition: transform .1s ease, box-shadow .1s ease; }
.card:hover { transform: translateY(-1px); box-shadow: 0 2px 8px rgba(0,0,0,.08); border-color:var(--accent); }
.card header { display:flex; gap:6px; align-items:center; margin-bottom:6px; }
.card .tid { font:11px/1 ui-monospace,Menlo,monospace; color:var(--muted); margin-right:auto; }
.card h3 { font-size:13px; font-weight:600; margin:0; line-height:1.35; }
.card footer { display:flex; flex-direction:column; gap:2px; margin-top:6px; font-size:11px; color:var(--muted); }
.badge { display:inline-block; padding:1px 7px; border-radius:8px; color:#fff; font-size:10px; font-weight:600; letter-spacing:.3px; text-transform:uppercase; }
.empty { color:var(--muted); font-style:italic; padding:12px; text-align:center; font-size:12px; }
.two-col { display:grid; grid-template-columns: 1fr 1fr; gap:24px; margin-bottom:24px; } @media (max-width:900px) { .two-col { grid-template-columns: 1fr; } }
.two-col h2 { font-size:14px; font-weight:600; text-transform:uppercase; letter-spacing:.5px; color:var(--muted); margin:0 0 10px; }
.adrs, .sessions { display:flex; flex-direction:column; gap:8px; }
.adr, .session { background:var(--card); border:1px solid var(--border); border-radius:6px; padding:10px 12px; }
.adr header, .session header { display:flex; gap:8px; align-items:center; margin-bottom:4px; }
.adr-num, .sess-num { font:11px/1 ui-monospace,Menlo,monospace; font-weight:600; }
.adr-date, .sess-date { font-size:11px; color:var(--muted); margin-left:auto; }
.adr h4, .session h4 { font-size:13px; margin:0; font-weight:500; line-height:1.35; }
.session footer { margin-top:4px; font-size:11px; }
.block { background:var(--card); border:1px solid var(--border); border-radius:8px; padding:0 16px; margin-bottom:16px; }
.block summary { cursor:pointer; padding:14px 0; list-style:none; }
.block summary h2 { display:inline; font-size:14px; font-weight:600; text-transform:uppercase; letter-spacing:.5px; color:var(--muted); margin:0; }
.block summary::before { content:'▸ '; color:var(--muted); } .block[open] summary::before { content:'▾ '; }
.md { padding-bottom:16px; } .md h3 { font-size:13px; text-transform:uppercase; letter-spacing:.5px; color:var(--muted); margin:14px 0 4px; }
.md ul { padding-left:20px; margin:6px 0; } .md code { background:var(--bg); border:1px solid var(--border); padding:1px 4px; border-radius:3px; font:12px ui-monospace,Menlo,monospace; }
.footnote { text-align:center; padding:24px; font-size:11px; color:var(--muted); }
`;

const CLIENT_JS = `
const pill = document.getElementById('live-pill');
const renderLane = (l, items) => items.length ? items.map(t => \`<article class="card"><header><span class="tid">#\${t.id}</span></header><h3>\${t.title}</h3></article>\`).join('') : '<div class="empty">— empty —</div>';
function applyData(d) {
  for (const lane of ['backlog','working','testing','conclusion']) {
    const sel = document.querySelector('.lane-' + lane + ' .lane-body');
    const cnt = document.querySelector('.lane-' + lane + ' .lane-count');
    if (sel && d.pipeline[lane]) sel.innerHTML = renderLane(lane, d.pipeline[lane]);
    if (cnt) cnt.textContent = d.pipeline[lane].length;
  }
  for (const [k, v] of Object.entries(d.counts || {})) {
    const el = document.querySelector('.count.lane-' + k + ' .n'); if (el) el.textContent = v;
  }
}
function connect() {
  const ev = new EventSource('/events');
  ev.onopen = () => { if (pill) { pill.classList.remove('stale'); } };
  ev.onerror = () => { if (pill) { pill.classList.add('stale'); } ev.close(); setTimeout(connect, 1500); };
  ev.onmessage = (e) => { try { applyData(JSON.parse(e.data)); } catch {} };
}
connect();
`;
