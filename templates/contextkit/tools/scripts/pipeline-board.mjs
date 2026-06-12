/**
 * DevPipeline board rendering — turns the task list into `devpipeline.md`.
 *
 * Pure (takes the task array), so `pipeline.mjs` (the CLI) stays lean. Shows the
 * WSJF priority + SLA, and flags overdue items (⏰).
 */
import { isOverdue } from './pipeline-prioritize.mjs';
import { blockedBy } from './pipeline-validate.mjs';

/**
 * @param {Array<object>} tasks
 * @param {Array<object>} allTasks
 * @param {Record<string,{startedAt:number,lastHeartbeat:number}>|null} ownerMap
 *   When non-null, an Owner column is appended showing session + live indicator.
 */
function table(tasks, allTasks, ownerMap = null) {
  if (tasks.length === 0) return '_(empty)_\n';
  const hasOwner = ownerMap !== null;
  const ownerHdr = hasOwner ? ' Owner |' : '';
  const ownerSep = hasOwner ? ' --- |' : '';
  const rows = [
    `| ID | Pri | WSJF | Type | Cx | Title | SLA | Roadmap | Workflow |${ownerHdr}`,
    `| --- | --- | --- | --- | --- | --- | --- | --- | --- |${ownerSep}`,
  ];
  for (const t of tasks) {
    const sla = t.sla ? (isOverdue(t) ? `⏰ ${t.sla}` : t.sla) : '—';
    const cx = t.complexity || '—';
    const n = blockedBy(t, allTasks);
    const title = n > 0 ? `${t.title} ↘ blocked by ${n}` : t.title;
    let ownerCell = '';
    if (hasOwner) {
      if (t.owner) {
        const ws = ownerMap[t.owner];
        if (ws?.lastHeartbeat) {
          const agoMin = Math.round((Date.now() - ws.lastHeartbeat) / 60000);
          ownerCell = ` | ${t.owner.slice(0, 8)} ${agoMin < 60 ? '🟢' : '⬜'}`;
        } else {
          ownerCell = ` | ${t.owner.slice(0, 8)}`;
        }
      } else {
        ownerCell = ' | —';
      }
    }
    rows.push(`| ${t.id} | ${t.priority} | ${t.wsjf || '—'} | ${t.type} | ${cx} | ${title} | ${sla} | ${t.roadmap || '—'} | ${t.workflow || '—'}${ownerCell} |`);
  }
  return rows.join('\n') + '\n';
}

/**
 * Full `devpipeline.md` markdown from the task list.
 * @param {Array<object>} tasks
 * @param {Record<string,{startedAt:number,lastHeartbeat:number}>|null} ownerMap
 *   Optional workspace data keyed by sessionId; when provided, working/testing
 *   sections show an Owner column with a live-session indicator (ADR-0015 §B).
 */
export function renderBoard(tasks, ownerMap = null) {
  const by = (s) => tasks.filter((t) => t.stage === s);
  const overdue = tasks.filter(isOverdue);
  const out = [];
  out.push('# DevPipeline — execution board');
  out.push('');
  out.push('> ⚠️  **AUTO-GENERATED** by `pipeline.mjs sync` (also on pre-commit). Do not hand-edit.');
  out.push('> Product/business plan is `contextkit/memory/roadmap.md`. THIS is execution control:');
  out.push('> bugs / increments / chores with **WSJF** priority + **SLA** (⏰ = overdue).');
  out.push('');
  out.push(`Backlog **${by('backlog').length}** · Working **${by('working').length}** · Testing **${by('testing').length}** · Concluded **${by('conclusion').length}** · ⏰ Overdue **${overdue.length}**`);
  out.push('');
  out.push('## 🔵 Working (active, owned by a session)');
  out.push('');
  out.push(table(by('working'), tasks, ownerMap));
  out.push('## 🟡 In testing (code written, awaiting QA)');
  out.push('');
  out.push(table(by('testing'), tasks, ownerMap));
  out.push('## 📋 Backlog (by priority)');
  out.push('');
  out.push(table(by('backlog'), tasks));
  out.push('## ✅ Concluded (recent)');
  out.push('');
  out.push(table(by('conclusion').slice(-15), tasks));
  return out.join('\n');
}

/** One compact task line for the digest. Bounded: title clipped at 60 chars. */
function digestLine(t) {
  // Defensive: a hand-edited/malformed card may lack a title — the digest is a
  // never-crash summary (ADR-0027 posture), so coerce instead of throwing.
  const raw = String(t.title || '(untitled)');
  const title = raw.length > 60 ? `${raw.slice(0, 57)}…` : raw;
  return `${t.id} ${t.priority}${isOverdue(t) ? ' ⏰' : ''} ${t.type} — ${title}`;
}

/**
 * Token-light lane summary (ADR-0047 A3, on ADR-0027's digest posture):
 * deterministic extraction so `/pipeline` and `/plan-week` reason over a few
 * lines instead of reading N task files. Active lanes in full (they are small
 * by design), backlog capped to the top entries in board order.
 * @param {Array<object>} tasks — the full task list (see pipeline-tasks.mjs)
 * @param {number} backlogCap — max backlog lines (default 8)
 */
export function renderDigest(tasks, backlogCap = 8) {
  const by = (s) => tasks.filter((t) => t.stage === s);
  const backlog = by('backlog');
  const out = [
    `📊 DevPipeline digest — Backlog **${backlog.length}** · Working **${by('working').length}** · Testing **${by('testing').length}** · Concluded **${by('conclusion').length}** · ⏰ Overdue **${tasks.filter(isOverdue).length}**`,
  ];
  for (const [label, lane] of [['Working', by('working')], ['Testing', by('testing')]]) {
    out.push(`${label}: ${lane.length ? lane.map(digestLine).join(' · ') : '(none)'}`);
  }
  out.push(`Backlog (top ${Math.min(backlogCap, backlog.length)}):`);
  for (const t of backlog.slice(0, backlogCap)) out.push(`  - ${digestLine(t)}`);
  if (backlog.length > backlogCap) out.push(`  … +${backlog.length - backlogCap} more (full board: contextkit/pipeline/devpipeline.md)`);
  return out.join('\n');
}

const SEV_ORDER = ['S1', 'S2', 'S3', 'S4', ''];
const SEV_LABEL = { S1: 'S1 · Critical', S2: 'S2 · High', S3: 'S3 · Medium', S4: 'S4 · Low', '': 'Unclassified' };

/** Known-bugs map: every `type: bug` task, grouped by severity, open vs resolved. */
export function renderKnownBugs(tasks) {
  const bugs = tasks.filter((t) => t.type === 'bug');
  const out = ['# Known Bugs — map', ''];
  out.push('> ⚠️ AUTO-GENERATED by `pipeline.mjs sync`. The bug registry, grouped by severity.');
  out.push(`> ${bugs.length} known · ${bugs.filter((b) => b.stage !== 'conclusion').length} open · ${bugs.filter(isOverdue).length} ⏰ overdue`);
  out.push('');
  if (bugs.length === 0) return out.concat(['✅ No bugs on record.', '']).join('\n');
  for (const sev of SEV_ORDER) {
    const inSev = bugs.filter((b) => (b.severity || '') === sev);
    if (inSev.length === 0) continue;
    out.push(`## ${SEV_LABEL[sev]} (${inSev.length})`, '', '| ID | Status | Bug type | Title | SLA |', '| --- | --- | --- | --- | --- |');
    for (const b of inSev) {
      const status = b.stage === 'conclusion' ? '✅ resolved' : b.stage === 'testing' ? '🟡 testing' : b.stage === 'working' ? '🔵 working' : '📋 open';
      const sla = b.sla ? (isOverdue(b) ? `⏰ ${b.sla}` : b.sla) : '—';
      out.push(`| ${b.id} | ${status} | ${b.bugType || '—'} | ${b.title} | ${sla} |`);
    }
    out.push('');
  }
  return out.join('\n');
}
