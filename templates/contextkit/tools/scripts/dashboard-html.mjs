/**
 * Pure HTML renderer for the v4 governance dashboard.
 *
 * Task columns are projections of canonical JSON statuses. The renderer never
 * reads the filesystem and exposes authority health when a canonical document is
 * missing, corrupt, or only partially readable.
 */

const TYPE_COLORS = {
  bug: '#e3413c', chore: '#7a8497', increment: '#3b6ef0',
  spike: '#8b5cf6', docs: '#10b981',
};
const PRIORITY_COLORS = {
  P0: '#991b1b', P1: '#e3413c', P2: '#f59e0b', P3: '#facc15', P4: '#9ca3af',
};
const ADR_STATUS_COLORS = {
  Accepted: '#10b981', Proposed: '#f59e0b', Superseded: '#9ca3af',
};
const STATUS_META = {
  backlog: { title: 'Backlog', icon: '📋', tone: 'status-backlog' },
  working: { title: 'Working', icon: '🔵', tone: 'status-working' },
  blocked: { title: 'Blocked', icon: '🔴', tone: 'status-blocked' },
  testing: { title: 'Testing', icon: '🟡', tone: 'status-testing' },
  done: { title: 'Done', icon: '✅', tone: 'status-done' },
  cancelled: { title: 'Cancelled', icon: '⏹', tone: 'status-cancelled' },
};

const escapeHtml = (value) => String(value ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const formatTime = (milliseconds) => {
  const timestamp = new Date(milliseconds);
  const pad = (number) => String(number).padStart(2, '0');
  return `${timestamp.getFullYear()}-${pad(timestamp.getMonth() + 1)}-${pad(timestamp.getDate())} ${pad(timestamp.getHours())}:${pad(timestamp.getMinutes())}:${pad(timestamp.getSeconds())}`;
};

const renderBadge = (text, color) =>
  `<span class="badge" style="background:${color}">${escapeHtml(text)}</span>`;

const renderTask = (task) => {
  const typeBadge = task.type ? renderBadge(task.type, TYPE_COLORS[task.type] || '#7a8497') : '';
  const priorityBadge = task.priority ? renderBadge(task.priority, PRIORITY_COLORS[task.priority] || '#9ca3af') : '';
  const scope = task.scopeRef ? `<span class="scope">${escapeHtml(task.scopeRef)}</span>` : '';
  return `<article class="card" data-id="${escapeHtml(task.id)}">
    <header><span class="task-id">#${escapeHtml(task.id)}</span>${typeBadge}${priorityBadge}</header>
    <h3>${escapeHtml(task.title)}</h3>
    <footer>${scope}</footer>
  </article>`;
};

const renderTaskGroup = (status, tasks) => {
  const metadata = STATUS_META[status];
  const items = tasks.length
    ? tasks.map(renderTask).join('')
    : '<div class="empty">— empty —</div>';
  return `<section class="task-group ${metadata.tone}" data-status="${status}">
    <header><span>${metadata.icon}</span><h2>${metadata.title}</h2><span class="task-count">${tasks.length}</span></header>
    <div class="task-body">${items}</div>
  </section>`;
};

const renderAuthorityHealth = (authority) => {
  const status = authority?.status ?? 'unavailable';
  const diagnostics = Array.isArray(authority?.diagnostics) ? authority.diagnostics : [];
  const details = diagnostics.length
    ? `<details><summary>${diagnostics.length} diagnostic(s)</summary><ul>${diagnostics.map((entry) => `<li><code>${escapeHtml(entry.path)}</code> — ${escapeHtml(entry.kind)}: ${escapeHtml(entry.message)}</li>`).join('')}</ul></details>`
    : '';
  return `<section class="authority authority-${escapeHtml(status)}"><strong>Authority: v4 JSON</strong><span>${escapeHtml(status)}</span>${details}</section>`;
};

const renderGovernance = (governance) => {
  if (!governance || governance.status === 'unavailable') {
    return '<section class="authority authority-unavailable"><strong>Governance matrix</strong><span>unavailable · continue</span></section>';
  }
  const counts = governance.counts ?? {};
  return `<section class="authority"><strong>Governance ${escapeHtml(governance.policyVersion ?? '')}</strong><span>${escapeHtml(governance.policyHash ?? '')}</span><span>guarded ${Number(counts.guarded ?? 0)} · canary ${Number(counts.canary ?? 0)} · shadow ${Number(counts.shadow ?? 0)} · off ${Number(counts.off ?? 0)}</span></section>`;
};

const renderAdrs = (adrs) => {
  if (!adrs.length) return '<p class="empty">No ADRs yet.</p>';
  return adrs.slice(0, 12).map((adr) => {
    const statusColor = ADR_STATUS_COLORS[adr.status?.split(/[\s(]/)[0]] || '#9ca3af';
    return `<article class="adr"><header>
      <span class="adr-number">ADR-${escapeHtml(adr.number)}</span>
      ${renderBadge(adr.status?.split('(')[0].trim() || '?', statusColor)}
      <span class="adr-date">${escapeHtml(adr.date)}</span>
    </header><h4>${escapeHtml(adr.title)}</h4></article>`;
  }).join('');
};

const renderSessions = (sessions) => {
  if (!sessions.length) return '<p class="empty">No sessions logged yet.</p>';
  return sessions.map((session) => `<article class="session">
    <header><span class="session-number">Session ${escapeHtml(session.number)}</span><span class="session-date">${escapeHtml(session.date)}</span></header>
    <h4>${escapeHtml(session.title)}</h4>
    <footer>${session.branch ? `<code>${escapeHtml(session.branch)}</code>` : ''}</footer>
  </article>`).join('');
};

const renderMarkdownLight = (markdown) => {
  if (!markdown) return '';
  return escapeHtml(markdown)
    .replace(/^### (.+)$/gm, '<h4>$1</h4>')
    .replace(/^## (.+)$/gm, '<h3>$1</h3>')
    .replace(/^# (.+)$/gm, '<h2>$1</h2>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/^- (.+)$/gm, '<li>$1</li>')
    .replace(/(<li>.*?<\/li>\n?)+/gs, (items) => `<ul>${items}</ul>`)
    .replace(/\n\n/g, '</p><p>')
    .replace(/^(?!<)/gm, '');
};

/**
 * Renders the full self-contained dashboard document.
 *
 * @param {object} dashboardData result of `buildDashboardData`
 * @param {{ live?: boolean }} [options]
 * @returns {string}
 */
export function renderDashboardHTML(dashboardData, options = {}) {
  const live = options.live === true;
  const indicator = live
    ? '<span class="live-pill" id="live-pill"><span class="dot"></span>live</span>'
    : `<span class="snapshot-pill">snapshot · ${formatTime(dashboardData.meta.generatedAt)}</span>`;
  const liveScript = live ? `<script>${CLIENT_JS}</script>` : '';
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(dashboardData.meta.project)} — ContextDevKit dashboard</title>
<style>${CSS}</style>
</head><body>
<header class="topbar">
  <div class="brand"><strong>${escapeHtml(dashboardData.meta.project)}</strong><span class="muted">·</span><code>${escapeHtml(dashboardData.meta.branch || 'non-git')}</code><span class="muted">·</span>L${dashboardData.meta.level ?? '?'}</div>
  ${indicator}
</header>
<main>
  <section class="authority-row">
    ${renderAuthorityHealth(dashboardData.authority)}
    ${renderGovernance(dashboardData.governance)}
  </section>
  <section class="counts">
    ${Object.entries(dashboardData.counts).map(([status, count]) => `<div class="count ${STATUS_META[status].tone}" data-status="${status}"><span class="number">${count}</span><span class="label">${STATUS_META[status].title}</span></div>`).join('')}
  </section>
  <section class="task-board" id="task-board">
    ${Object.keys(STATUS_META).map((status) => renderTaskGroup(status, dashboardData.tasks[status] ?? [])).join('')}
  </section>
  <section class="two-column">
    <div><h2>Recent ADRs</h2><div class="adrs" id="adrs">${renderAdrs(dashboardData.adrs)}</div></div>
    <div><h2>Recent sessions</h2><div class="sessions" id="sessions">${renderSessions(dashboardData.sessions)}</div></div>
  </section>
  <details class="block"><summary><h2>CHANGELOG · [Unreleased]</h2></summary><div class="markdown" id="changelog">${renderMarkdownLight(dashboardData.changelogUnreleased)}</div></details>
  ${dashboardData.roadmap.exists ? `<details class="block"><summary><h2>Roadmap</h2></summary><div class="markdown" id="roadmap">${renderMarkdownLight(dashboardData.roadmap.markdown)}</div></details>` : ''}
</main>
<footer class="footnote">ContextDevKit · ${escapeHtml(dashboardData.meta.platformDir)}/ · generated ${formatTime(dashboardData.meta.generatedAt)}</footer>
${liveScript}
</body></html>`;
}

const CSS = `
:root { color-scheme:light dark; --bg:#fff; --fg:#1f2328; --muted:#7a8497; --card:#f6f7f9; --border:#e1e4e8; --accent:#5046e5; }
@media (prefers-color-scheme:dark) { :root { --bg:#0c0c10; --fg:#e4e6eb; --muted:#9ca3af; --card:#16161c; --border:#2a2a33; } }
* { box-sizing:border-box; } body { margin:0; font:14px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif; background:var(--bg); color:var(--fg); }
.topbar { display:flex; align-items:center; justify-content:space-between; padding:14px 24px; border-bottom:1px solid var(--border); position:sticky; top:0; background:var(--bg); z-index:10; }
.brand { display:flex; gap:8px; align-items:center; } .brand code { font:12px/1 ui-monospace,Menlo,monospace; padding:3px 6px; border:1px solid var(--border); border-radius:4px; }
.muted { color:var(--muted); } .live-pill { display:inline-flex; align-items:center; gap:6px; padding:4px 10px; border-radius:12px; background:#10b981; color:#fff; font-weight:600; font-size:12px; }
.live-pill .dot { width:8px; height:8px; background:#fff; border-radius:50%; animation:pulse 2s infinite; } .live-pill.stale { background:#e3413c; }
.snapshot-pill { font-size:12px; color:var(--muted); } @keyframes pulse { 0%,100% { opacity:1 } 50% { opacity:.4 } }
main { max-width:1600px; margin:0 auto; padding:24px; }
.authority-row { display:grid; grid-template-columns:1fr 1fr; gap:12px; margin-bottom:16px; }
.authority { padding:12px 14px; border:1px solid var(--border); border-left:4px solid #10b981; border-radius:8px; background:var(--card); display:flex; flex-wrap:wrap; gap:8px 14px; align-items:center; }
.authority strong { margin-right:auto; } .authority span { color:var(--muted); font-size:12px; } .authority details { width:100%; } .authority ul { margin:6px 0 0; }
.authority-partial { border-left-color:#f59e0b; } .authority-corrupt,.authority-unavailable { border-left-color:#e3413c; }
.counts { display:grid; grid-template-columns:repeat(6,1fr); gap:12px; margin-bottom:24px; }
.count { padding:14px; border-radius:8px; background:var(--card); border:1px solid var(--border); display:flex; justify-content:space-between; align-items:baseline; }
.count .number { font-size:28px; font-weight:700; } .count .label { color:var(--muted); }
.task-board { display:grid; grid-template-columns:repeat(3,minmax(220px,1fr)); gap:14px; margin-bottom:32px; }
.task-group { background:var(--card); border:1px solid var(--border); border-radius:8px; display:flex; flex-direction:column; min-height:200px; }
.task-group > header { display:flex; align-items:center; gap:8px; padding:12px 14px; border-bottom:1px solid var(--border); }
.task-group > header h2 { font-size:13px; font-weight:600; text-transform:uppercase; letter-spacing:.5px; margin:0; flex:1; }
.task-count { background:var(--bg); border:1px solid var(--border); padding:1px 8px; border-radius:10px; font-size:11px; font-weight:600; }
.task-body { padding:8px; display:flex; flex-direction:column; gap:8px; flex:1; }
.status-backlog > header { color:#7a8497; } .status-working > header { color:#3b6ef0; } .status-blocked > header { color:#e3413c; }
.status-testing > header { color:#f59e0b; } .status-done > header { color:#10b981; } .status-cancelled > header { color:#9ca3af; }
.card { background:var(--bg); border:1px solid var(--border); border-radius:6px; padding:10px; transition:transform .1s ease,box-shadow .1s ease; }
.card:hover { transform:translateY(-1px); box-shadow:0 2px 8px rgba(0,0,0,.08); border-color:var(--accent); }
.card header { display:flex; gap:6px; align-items:center; margin-bottom:6px; } .card .task-id { font:11px/1 ui-monospace,Menlo,monospace; color:var(--muted); margin-right:auto; }
.card h3 { font-size:13px; font-weight:600; margin:0; line-height:1.35; } .card footer { margin-top:6px; font-size:11px; color:var(--muted); }
.badge { display:inline-block; padding:1px 7px; border-radius:8px; color:#fff; font-size:10px; font-weight:600; letter-spacing:.3px; text-transform:uppercase; }
.empty { color:var(--muted); font-style:italic; padding:12px; text-align:center; font-size:12px; }
.two-column { display:grid; grid-template-columns:1fr 1fr; gap:24px; margin-bottom:24px; } .two-column h2 { font-size:14px; font-weight:600; text-transform:uppercase; letter-spacing:.5px; color:var(--muted); margin:0 0 10px; }
.adrs,.sessions { display:flex; flex-direction:column; gap:8px; } .adr,.session { background:var(--card); border:1px solid var(--border); border-radius:6px; padding:10px 12px; }
.adr header,.session header { display:flex; gap:8px; align-items:center; margin-bottom:4px; } .adr-number,.session-number { font:11px/1 ui-monospace,Menlo,monospace; font-weight:600; }
.adr-date,.session-date { font-size:11px; color:var(--muted); margin-left:auto; } .adr h4,.session h4 { font-size:13px; margin:0; font-weight:500; line-height:1.35; }
.block { background:var(--card); border:1px solid var(--border); border-radius:8px; padding:0 16px; margin-bottom:16px; } .block summary { cursor:pointer; padding:14px 0; list-style:none; }
.block summary h2 { display:inline; font-size:14px; font-weight:600; text-transform:uppercase; letter-spacing:.5px; color:var(--muted); margin:0; }
.markdown { padding-bottom:16px; } .markdown code { background:var(--bg); border:1px solid var(--border); padding:1px 4px; border-radius:3px; font:12px ui-monospace,Menlo,monospace; }
.footnote { text-align:center; padding:24px; font-size:11px; color:var(--muted); }
@media (max-width:1100px) { .task-board { grid-template-columns:repeat(2,1fr); } .counts { grid-template-columns:repeat(3,1fr); } }
@media (max-width:680px) { .task-board,.counts,.authority-row,.two-column { grid-template-columns:1fr; } }
`;

const CLIENT_JS = `
const pill = document.getElementById('live-pill');
const safe = (value) => String(value ?? '').replace(/[&<>"']/g, (character) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character]));
const renderTasks = (items) => items.length ? items.map((task) => \`<article class="card"><header><span class="task-id">#\${safe(task.id)}</span></header><h3>\${safe(task.title)}</h3></article>\`).join('') : '<div class="empty">— empty —</div>';
function applyDashboardData(dashboardData) {
  for (const status of ['backlog','working','blocked','testing','done','cancelled']) {
    const group = document.querySelector('.task-group[data-status="' + status + '"]');
    const body = group?.querySelector('.task-body');
    const count = group?.querySelector('.task-count');
    if (body && dashboardData.tasks[status]) body.innerHTML = renderTasks(dashboardData.tasks[status]);
    if (count) count.textContent = dashboardData.tasks[status]?.length ?? 0;
  }
  for (const [status, value] of Object.entries(dashboardData.counts || {})) {
    const element = document.querySelector('.count[data-status="' + status + '"] .number');
    if (element) element.textContent = value;
  }
}
function connect() {
  const events = new EventSource('/events');
  events.onopen = () => { if (pill) pill.classList.remove('stale'); };
  events.onerror = () => { if (pill) pill.classList.add('stale'); events.close(); setTimeout(connect,1500); };
  events.onmessage = (event) => { try { applyDashboardData(JSON.parse(event.data)); } catch {} };
}
connect();
`;
