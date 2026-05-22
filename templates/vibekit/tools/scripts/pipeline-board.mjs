/**
 * DevPipeline board rendering — turns the task list into `devpipeline.md`.
 *
 * Pure (takes the task array), so `pipeline.mjs` (the CLI) stays lean. Shows the
 * WSJF priority + SLA, and flags overdue items (⏰).
 */
import { isOverdue } from './pipeline-prioritize.mjs';

function table(tasks) {
  if (tasks.length === 0) return '_(empty)_\n';
  const rows = ['| ID | Pri | WSJF | Type | Title | SLA | Roadmap |', '| --- | --- | --- | --- | --- | --- | --- |'];
  for (const t of tasks) {
    const sla = t.sla ? (isOverdue(t) ? `⏰ ${t.sla}` : t.sla) : '—';
    rows.push(`| ${t.id} | ${t.priority} | ${t.wsjf || '—'} | ${t.type} | ${t.title} | ${sla} | ${t.roadmap || '—'} |`);
  }
  return rows.join('\n') + '\n';
}

/** Full `devpipeline.md` markdown from the task list. */
export function renderBoard(tasks) {
  const by = (s) => tasks.filter((t) => t.stage === s);
  const overdue = tasks.filter(isOverdue);
  const out = [];
  out.push('# DevPipeline — execution board');
  out.push('');
  out.push('> ⚠️  **AUTO-GENERATED** by `pipeline.mjs sync` (also on pre-commit). Do not hand-edit.');
  out.push('> Product/business plan is `vibekit/memory/roadmap.md`. THIS is execution control:');
  out.push('> bugs / increments / chores with **WSJF** priority + **SLA** (⏰ = overdue).');
  out.push('');
  out.push(`Backlog **${by('backlog').length}** · Testing **${by('testing').length}** · Concluded **${by('conclusion').length}** · ⏰ Overdue **${overdue.length}**`);
  out.push('');
  out.push('## 🟡 In testing / in progress');
  out.push('');
  out.push(table(by('testing')));
  out.push('## 📋 Backlog (by priority)');
  out.push('');
  out.push(table(by('backlog')));
  out.push('## ✅ Concluded (recent)');
  out.push('');
  out.push(table(by('conclusion').slice(-15)));
  return out.join('\n');
}
